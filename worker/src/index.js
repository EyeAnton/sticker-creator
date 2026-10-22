import { EMOTION_IDS, createJob, advance, retryEmotion, logEvent, publicJob, spend, runsLeft, today } from "./pipeline.js";
import { fetchImage } from "./provider.js";
import { gate } from "./gate.js";
export { Gate } from "./gate.js";

const MAX_PHOTO = 1.5 * 1024 * 1024;
const JOB_TTL = 7 * 86400; // страница показывает пак сутки, остальное время задача нужна как журнал (job_report)

const TEXT = {
  bad_input: "Не удалось разобрать запрос. Обновите страницу и попробуйте ещё раз.",
  captcha: "Не прошла проверка «я не робот». Попробуйте ещё раз.",
  origin: "Запрос с этого адреса не разрешён.",
  too_large: "Фото слишком большое.",
  rejected: "Это фото уже не подошло. Выберите другое.",
  busy: "Пак уже делается.",
  closed: "На сегодня лимит генераций исчерпан. Загляните завтра.",
  upstream: "Сервис генерации сейчас недоступен. Попробуйте чуть позже.",
  not_found: "Задача не найдена или устарела.",
  not_ready: "Этот стикер сейчас нельзя перерисовать.",
  job_busy: "Задача занята, повторите через секунду.",
};

function allowedOrigins(env) {
  return env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const h = { Vary: "Origin" };
  if (origin && allowedOrigins(env).includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request, env) },
  });
}

function err(request, env, status, code, extra = {}) {
  return json(request, env, { error: code, message: TEXT[code], ...extra }, status);
}

async function sha256Hex(data) {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const DEVICE_RE = /^[\w-]{16,64}$/;
const RESERVE_TTL = 2 * 86400;
const IP_TTL = 2 * 86400;
const RESERVE_GRACE_MS = 120 * 1000; // между бронью и записью задачи в KV
const LOCK_MS = 60 * 1000; // блокировка задачи/IP на время шага; падение Worker'а — снимется сама

async function deviceKey(env, device) {
  return "dev:" + (await sha256Hex(device + env.IP_SALT));
}

// IPv6 — по сети /64: у одного абонента их миллиарды адресов, иначе страховка по IP обходится сменой адреса.
function ipNet(ip) {
  if (!ip.includes(":")) return ip;
  let [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => x.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

async function ipKey(request, env) {
  const ip = ipNet(request.headers.get("CF-Connecting-IP") || "local");
  return `ip:${await sha256Hex(ip + env.IP_SALT)}:${today()}`;
}

async function readList(env, key) {
  const raw = await env.JOBS.get(key);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [v];
  } catch {
    return [];
  }
}

// Пак закончился (любым исходом)? Тогда бронь снимается: новых паков с устройства можно делать сколько угодно,
// но по одному за раз (на устройство и на IP), плюс потолки GLOBAL_DAY и RUNS_DAY.
function finished(job) {
  return job.stage === "done" || job.stage === "rejected" || job.stage === "failed";
}

// Бронь → "busy" (пак идёт) или "free" (закончился / пропал из KV).
async function resolveEntry(env, e) {
  const job = await loadJob(env, e.jobId);
  if (!job) return Date.now() - e.t < RESERVE_GRACE_MS ? "busy" : "free"; // льгота между бронью и записью задачи
  return finished(job) ? "free" : "busy";
}

// Что мешает новому паку: "busy" | null. Заодно чистит снятые брони.
async function blocker(env, devKey, ipK) {
  let busy = false;
  const dev = await readList(env, devKey);
  if (dev.length) {
    if ((await resolveEntry(env, dev[0])) === "busy") busy = true;
    else await env.JOBS.delete(devKey);
  }
  const ips = await readList(env, ipK);
  const kept = [];
  for (const e of ips) {
    if ((await resolveEntry(env, e)) === "free") continue;
    kept.push(e);
    busy = true;
  }
  if (kept.length !== ips.length) await env.JOBS.put(ipK, JSON.stringify(kept), { expirationTtl: IP_TTL });
  return busy ? "busy" : null;
}

async function reserve(env, jobId, devKey, ipK) {
  const e = { state: "reserved", jobId, t: Date.now() };
  await env.JOBS.put(devKey, JSON.stringify([e]), { expirationTtl: RESERVE_TTL });
  const ips = await readList(env, ipK);
  await env.JOBS.put(ipK, JSON.stringify([...ips, e]), { expirationTtl: IP_TTL });
}

async function release(env, jobId, devKey, ipK) {
  const dev = await readList(env, devKey);
  if (dev.some((e) => e.jobId === jobId)) await env.JOBS.delete(devKey);
  const ips = await readList(env, ipK);
  const kept = ips.filter((e) => e.jobId !== jobId);
  if (kept.length !== ips.length) await env.JOBS.put(ipK, JSON.stringify(kept), { expirationTtl: IP_TTL });
}

// Фиксирует конец пака (один раз): бронь снимается.
async function settle(env, jobId, job) {
  if (!finished(job) || job.settled || !job.devKey) return false;
  job.settled = true;
  await release(env, jobId, job.devKey, job.ipKey);
  return true;
}

async function turnstileOk(env, token, ip) {
  try {
    const body = new FormData();
    body.set("secret", env.TURNSTILE_SECRET);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return (await r.json()).success === true;
  } catch {
    return false;
  }
}

async function isOpen(env) {
  return (await gate(env, "global:" + today()).value()) < Number(env.GLOBAL_DAY) && (await runsLeft(env));
}

async function handleConfig(request, env) {
  const device = new URL(request.url).searchParams.get("device") || "";
  const devKey = DEVICE_RE.test(device) ? await deviceKey(env, device) : "dev:none";
  const block = await blocker(env, devKey, await ipKey(request, env));
  return json(request, env, {
    emotions: EMOTION_IDS,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    open: await isOpen(env),
    canCreate: !block,
    ...(block ? { reason: block } : {}),
  });
}

async function handleCreate(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return err(request, env, 403, "origin");

  // без Content-Length (chunked) тело не читаем: иначе formData() глотает сколько угодно
  const len = Number(request.headers.get("Content-Length"));
  if (!len) return err(request, env, 400, "bad_input");
  if (len > MAX_PHOTO + 64 * 1024) return err(request, env, 413, "too_large");

  let form;
  try {
    form = await request.formData();
  } catch {
    return err(request, env, 400, "bad_input");
  }
  const device = String(form.get("device") || "");
  if (!DEVICE_RE.test(device)) return err(request, env, 400, "bad_input");
  const photo = form.get("photo");
  if (!photo || typeof photo === "string") return err(request, env, 400, "bad_input");
  if (photo.size > MAX_PHOTO) return err(request, env, 413, "too_large");

  // Выбора эмоций в интерфейсе нет: всегда все. Необязательное поле emotions — только подмножество (дешёвый тестовый прогон,
  // например ?only=wink на странице): удорожить пак им нельзя.
  const asked = String(form.get("emotions") || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (asked.length && (new Set(asked).size !== asked.length || !asked.every((e) => EMOTION_IDS.includes(e)))) return err(request, env, 400, "bad_input");
  const emotions = asked.length ? asked : EMOTION_IDS;

  // "stub-reject" / "stub-base-qa" — только для проверки веток в stub-режиме (отказ validate / брак QA базы)
  const gender = String(form.get("gender") || "");
  const genders = env.PROVIDER_MODE === "live" ? ["", "male", "female"] : ["", "male", "female", "stub-reject", "stub-base-qa"];
  if (!genders.includes(gender)) return err(request, env, 400, "bad_input");

  const bytes = await photo.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return err(request, env, 400, "bad_input");

  const token = String(form.get("turnstile") || "");
  if (!token || !(await turnstileOk(env, token, request.headers.get("CF-Connecting-IP")))) return err(request, env, 403, "captcha");

  const photoHash = await sha256Hex(bytes);
  if (await env.JOBS.get("rejected:" + photoHash)) return err(request, env, 422, "rejected");

  if (!(await isOpen(env))) return err(request, env, 503, "closed");

  const devKey = await deviceKey(env, device);
  const ipK = await ipKey(request, env);
  // параллельные POST с одного IP/устройства: иначе оба проходят blocker до записи брони
  const locks = [gate(env, ipK), gate(env, devKey)];
  const got = [];
  try {
    for (const g of locks) {
      if ((await g.lock(LOCK_MS)) === null) return err(request, env, 429, "busy");
      got.push(g);
    }
    return await createLocked(request, env, { bytes, photoHash, gender, emotions, devKey, ipK });
  } finally {
    for (const g of got) await g.unlock().catch(() => {});
  }
}

async function createLocked(request, env, { bytes, photoHash, gender, emotions, devKey, ipK }) {
  const block = await blocker(env, devKey, ipK);
  if (block) return err(request, env, 429, block);

  const global = gate(env, "global:" + today());
  if (!(await global.take(Number(env.GLOBAL_DAY)))) return err(request, env, 503, "closed");
  if (!(await spend(env))) {
    await global.give();
    return err(request, env, 503, "closed");
  }
  const jobId = crypto.randomUUID();
  await reserve(env, jobId, devKey, ipK);
  let job;
  try {
    job = await createJob(env, { photo: bytes, photoHash, gender, emotions });
  } catch {
    await release(env, jobId, devKey, ipK);
    await global.give(); // пак не начался — место в дневном лимите возвращаем (вызов провайдера уже засчитан в runs)
    return err(request, env, 502, "upstream");
  }
  job.devKey = devKey;
  job.ipKey = ipK;

  await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
  const { stage, stickers } = publicJob(jobId, job);
  return json(request, env, { jobId, stage, stickers }, 201);
}

async function loadJob(env, jobId) {
  const raw = await env.JOBS.get("job:" + jobId);
  return raw ? JSON.parse(raw) : null;
}

// Шаг двигает только тот, кто взял блокировку задачи; параллельные GET получают текущее состояние без шага —
// иначе каждый из них запускал бы те же задачи у провайдера (платно). seq отсекает отставшую копию из KV.
async function handleStatus(request, env, jobId) {
  const g = gate(env, "job:" + jobId);
  const seq = await g.lock(LOCK_MS);
  let next;
  try {
    const job = await loadJob(env, jobId);
    if (!job) return err(request, env, 404, "not_found");
    if (seq === null || (job.seq || 0) < seq) return json(request, env, publicJob(jobId, job));
    const before = JSON.stringify(job);
    try {
      await advance(env, job);
      await settle(env, jobId, job);
    } catch {
      // ошибка провайдера на этом шаге — сохраняем то, что успели (уже запущенные задачи), клиент опросит ещё раз
    }
    if (JSON.stringify(job) !== before) {
      job.seq = Math.max(seq, job.seq || 0) + 1;
      await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
      next = job.seq;
    }
    return json(request, env, publicJob(jobId, job));
  } finally {
    if (seq !== null) await g.unlock(next).catch(() => {});
  }
}

// Брак стикера по проверке заливки в браузере → ещё одна попытка той же моделью (не больше MAX_ATTEMPTS на эмоцию).
async function handleRetry(request, env, jobId, sid) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return err(request, env, 403, "origin");
  if (Number(request.headers.get("Content-Length")) > 1024) return err(request, env, 413, "too_large");
  let reason;
  try {
    reason = JSON.parse(await request.text()).reason;
  } catch {
    return err(request, env, 400, "bad_input");
  }
  if (sid === "base" || (reason !== "leak" && reason !== "nobg")) return err(request, env, 400, "bad_input");

  const g = gate(env, "job:" + jobId);
  const seq = await g.lock(LOCK_MS);
  if (seq === null) return err(request, env, 409, "job_busy");
  let next;
  try {
    const job = await loadJob(env, jobId);
    if (!job) return err(request, env, 404, "not_found");
    if ((job.seq || 0) < seq) return err(request, env, 409, "job_busy"); // отставшая копия из KV
    const s = job.stickers[sid];
    if (!s) return err(request, env, 404, "not_found");
    if (s.state !== "done") return err(request, env, 409, "not_ready");
    try {
      await retryEmotion(env, job, sid, reason);
      await settle(env, jobId, job);
    } catch {
      return err(request, env, 502, "upstream");
    }
    job.seq = Math.max(seq, job.seq || 0) + 1;
    await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
    next = job.seq;
    return json(request, env, publicJob(jobId, job));
  } finally {
    await g.unlock(next).catch(() => {});
  }
}

// Результат проверки заливки в браузере (для журнала): {id, attempt, verdict, removed, leak}. Ничего не двигает.
async function handleReport(request, env, jobId) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return err(request, env, 403, "origin");
  if (Number(request.headers.get("Content-Length")) > 1024) return err(request, env, 413, "too_large");
  let b;
  try {
    b = JSON.parse(await request.text());
  } catch {
    return err(request, env, 400, "bad_input");
  }
  const num = (v) => (typeof v === "number" && isFinite(v) ? Math.round(v * 1000) / 1000 : null);
  if (!b || typeof b.id !== "string" || !/^[a-z_]{1,32}$/.test(b.id) || !["ok", "leak", "nobg", "error"].includes(b.verdict)) return err(request, env, 400, "bad_input");
  const g = gate(env, "job:" + jobId);
  const seq = await g.lock(LOCK_MS);
  if (seq === null) return err(request, env, 409, "job_busy");
  let next;
  try {
    const job = await loadJob(env, jobId);
    if (!job || !job.stickers[b.id]) return err(request, env, 404, "not_found");
    if ((job.seq || 0) < seq) return err(request, env, 409, "job_busy");
    if ((job.log || []).filter((e) => e.ev === "fill").length >= 100) return json(request, env, { ok: true });
    logEvent(job, "fill", { id: b.id, attempt: num(b.attempt), verdict: b.verdict, removed: num(b.removed), leak: num(b.leak) });
    job.seq = Math.max(seq, job.seq || 0) + 1;
    await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
    next = job.seq;
    return json(request, env, { ok: true });
  } finally {
    await g.unlock(next).catch(() => {});
  }
}

async function handleImage(request, env, jobId, sid) {
  const job = await loadJob(env, jobId);
  const s = job && job.stickers[sid];
  if (!s || s.state !== "done" || !s.url) return err(request, env, 404, "not_found");
  let up;
  try {
    up = await fetchImage(env, s.url);
  } catch {
    return err(request, env, 502, "upstream");
  }
  return new Response(up.body, {
    headers: {
      "Content-Type": up.headers.get("Content-Type"),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
      ...corsHeaders(request, env),
    },
  });
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    try {
      if (request.method === "GET" && path === "/api/config") return await handleConfig(request, env);
      if (request.method === "POST" && path === "/api/jobs") return await handleCreate(request, env);
      let m;
      if (request.method === "GET" && (m = path.match(/^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/))) return await handleStatus(request, env, m[1]);
      if (request.method === "POST" && (m = path.match(/^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/report$/))) return await handleReport(request, env, m[1]);
      if (request.method === "POST" && (m = path.match(/^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/retry\/([a-z_]{1,32})$/))) return await handleRetry(request, env, m[1], m[2]);
      if (request.method === "GET" && (m = path.match(/^\/api\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/img\/([a-z_]{1,32})$/))) return await handleImage(request, env, m[1], m[2]);
      return err(request, env, 404, "not_found");
    } catch {
      return err(request, env, 502, "upstream");
    }
  },
};
