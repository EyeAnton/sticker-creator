import { EMOTION_IDS, createJob, advance, publicJob, spend, runsLeft, today } from "./pipeline.js";
import { fetchImage } from "./provider.js";

const MAX_PHOTO = 1.5 * 1024 * 1024;
const JOB_TTL = 24 * 3600;

const TEXT = {
  bad_input: "Не удалось разобрать запрос. Обновите страницу и попробуйте ещё раз.",
  captcha: "Не прошла проверка «я не робот». Попробуйте ещё раз.",
  origin: "Запрос с этого адреса не разрешён.",
  too_large: "Фото слишком большое.",
  rejected: "Это фото уже не подошло. Выберите другое.",
  limit: "На сегодня вы исчерпали лимит стикерпаков. Приходите завтра.",
  closed: "На сегодня лимит генераций исчерпан. Загляните завтра.",
  upstream: "Сервис генерации сейчас недоступен. Попробуйте чуть позже.",
  not_found: "Задача не найдена или устарела.",
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

function secondsToMidnight() {
  const n = new Date();
  const next = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1);
  return Math.max(60, Math.ceil((next - n.getTime()) / 1000));
}

async function ipKey(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return `ip:${await sha256Hex(ip + env.IP_SALT)}:${today()}`;
}

async function count(env, key) {
  return Number(await env.JOBS.get(key)) || 0;
}

async function bump(env, key) {
  await env.JOBS.put(key, String((await count(env, key)) + 1), { expirationTtl: 2 * 86400 });
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
  return (await count(env, "global:" + today())) < Number(env.GLOBAL_DAY) && (await runsLeft(env));
}

async function handleConfig(request, env) {
  const left = Math.max(0, Number(env.PER_IP_DAY) - (await count(env, await ipKey(request, env))));
  return json(request, env, {
    emotions: EMOTION_IDS,
    maxEmotions: Number(env.MAX_EMOTIONS),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
    open: await isOpen(env),
    leftToday: left,
  });
}

async function handleCreate(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin || !allowedOrigins(env).includes(origin)) return err(request, env, 403, "origin");

  const len = Number(request.headers.get("Content-Length"));
  if (len > MAX_PHOTO + 64 * 1024) return err(request, env, 413, "too_large");

  let form;
  try {
    form = await request.formData();
  } catch {
    return err(request, env, 400, "bad_input");
  }
  const photo = form.get("photo");
  if (!photo || typeof photo === "string") return err(request, env, 400, "bad_input");
  if (photo.size > MAX_PHOTO) return err(request, env, 413, "too_large");

  const emotions = String(form.get("emotions") || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (
    emotions.length < 1 || emotions.length > Number(env.MAX_EMOTIONS) ||
    new Set(emotions).size !== emotions.length ||
    !emotions.every((e) => EMOTION_IDS.includes(e))
  ) return err(request, env, 400, "bad_input");

  // "stub-reject" — только для проверки ветки отказа в stub-режиме
  const gender = String(form.get("gender") || "");
  const genders = env.PROVIDER_MODE === "live" ? ["", "male", "female"] : ["", "male", "female", "stub-reject"];
  if (!genders.includes(gender)) return err(request, env, 400, "bad_input");

  const bytes = await photo.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(3, bytes.byteLength));
  if (head.length < 3 || head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return err(request, env, 400, "bad_input");

  const token = String(form.get("turnstile") || "");
  if (!token || !(await turnstileOk(env, token, request.headers.get("CF-Connecting-IP")))) return err(request, env, 403, "captcha");

  const photoHash = await sha256Hex(bytes);
  if (await env.JOBS.get("rejected:" + photoHash)) return err(request, env, 422, "rejected");

  if (!(await isOpen(env))) return err(request, env, 503, "closed");

  const ipK = await ipKey(request, env);
  if ((await count(env, ipK)) >= Number(env.PER_IP_DAY)) return err(request, env, 429, "limit", { retryAfter: secondsToMidnight() });

  if (!(await spend(env))) return err(request, env, 503, "closed");
  let job;
  try {
    job = await createJob(env, { photo: bytes, photoHash, gender, emotions });
  } catch {
    return err(request, env, 502, "upstream");
  }
  await bump(env, ipK);
  await bump(env, "global:" + today());

  const jobId = crypto.randomUUID();
  await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
  const { stage, stickers } = publicJob(jobId, job);
  return json(request, env, { jobId, stage, stickers }, 201);
}

async function loadJob(env, jobId) {
  const raw = await env.JOBS.get("job:" + jobId);
  return raw ? JSON.parse(raw) : null;
}

async function handleStatus(request, env, jobId) {
  const job = await loadJob(env, jobId);
  if (!job) return err(request, env, 404, "not_found");
  try {
    if (await advance(env, job)) await env.JOBS.put("job:" + jobId, JSON.stringify(job), { expirationTtl: JOB_TTL });
  } catch {
    // ошибка провайдера на этом шаге — отдаём прежнее состояние, клиент опросит ещё раз
  }
  return json(request, env, publicJob(jobId, job));
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
      "Content-Type": up.headers.get("Content-Type") || "image/png",
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
      if (request.method === "GET" && (m = path.match(/^\/api\/jobs\/([\w-]+)$/))) return await handleStatus(request, env, m[1]);
      if (request.method === "GET" && (m = path.match(/^\/api\/jobs\/([\w-]+)\/img\/([\w-]+)$/))) return await handleImage(request, env, m[1], m[2]);
      return err(request, env, 404, "not_found");
    } catch {
      return err(request, env, 502, "upstream");
    }
  },
};
