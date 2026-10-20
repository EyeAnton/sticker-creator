// Этапы пака: validate → restyle → emotions (+qa). Двигаются при GET, состояние — в задаче (KV).
import prompts from "../prompts.json";
import { uploadImage, startTask, getTask } from "./provider.js";

export const EMOTION_IDS = prompts.emotions.map((e) => e.id);
const MAX_ATTEMPTS = 4;
const RESTYLE_PAUSE_MS = 5000;

const MSG = {
  upstream: "Сервис генерации сейчас недоступен. Попробуйте чуть позже.",
  closed: "На сегодня лимит генераций исчерпан. Загляните завтра.",
  refused: "Модель не смогла обработать это фото. Попробуйте другое.",
  validateFail: "Не удалось проверить фото. Попробуйте ещё раз.",
  restyleFail: "Не получилось нарисовать базовый стикер. Попробуйте ещё раз.",
};

// Порядок моделей для следующей попытки. prev: "fast"|"pro"|null, reason: "qa"|"refused"|"error".
export function nextModel(prev, reason) {
  if (!prev) return "fast";
  if (reason === "qa") return prev;
  return prev === "fast" ? "pro" : "fast";
}

export const today = () => new Date().toISOString().slice(0, 10);

// Жёсткий потолок вызовов провайдера в сутки. false — потолок достигнут.
export async function spend(env) {
  const key = "runs:" + today();
  const n = Number(await env.JOBS.get(key)) || 0;
  if (n >= Number(env.RUNS_DAY)) return false;
  await env.JOBS.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}

export async function runsLeft(env) {
  const n = Number(await env.JOBS.get("runs:" + today())) || 0;
  return n < Number(env.RUNS_DAY);
}

// Ответ модерации/QA: JSON {"status": 0|1, "failureReason"?}; запасной формат — строка PASS / FAIL: <причина>.
function parseStatus(text) {
  const s = String(text || "");
  try {
    const m = s.match(/\{[\s\S]*\}/);
    const j = JSON.parse(m ? m[0] : s);
    if (typeof j.status === "number") return j;
  } catch {}
  if (/^\s*PASS\b/i.test(s)) return { status: 0 };
  const f = s.match(/^\s*FAIL\b\s*:?\s*(.*)/i);
  if (f) return { status: 1, failureReason: f[1].trim() };
  return null;
}

async function reject(env, job, message) {
  job.stage = "rejected";
  job.message = message;
  await env.JOBS.put("rejected:" + job.photoHash, "1", { expirationTtl: 30 * 86400 });
}

function fail(job, message) {
  job.stage = "failed";
  job.message = message;
}

// Создание пака: загрузка фото, старт validate. Бросает при ошибке провайдера (→ 502 upstream).
export async function createJob(env, { photo, photoHash, gender, emotions }) {
  const ref = await uploadImage(env, photo, "photo.jpg");
  const task = await startTask(env, "validate", { image: ref, meta: gender });
  const stickers = { base: { state: "queued" } };
  for (const id of emotions) stickers[id] = { state: "queued" };
  return {
    created: Math.floor(Date.now() / 1000),
    gender,
    photoHash,
    photoRef: ref,
    stage: "validate",
    validate: { task },
    restyleRetry: 0,
    stickers,
  };
}

// Статус для клиента.
export function publicJob(jobId, job) {
  const stickers = Object.entries(job.stickers).map(([id, s]) => {
    const o = { id, state: s.state };
    if (s.state === "done") o.image = `/api/jobs/${jobId}/img/${id}`;
    if (s.state === "running" && s.attempt) o.attempt = s.attempt;
    return o;
  });
  const out = { jobId, stage: job.stage, stickers };
  if (job.message) out.message = job.message;
  return out;
}

function genderWord(g) {
  return g === "male" ? "male " : g === "female" ? "female " : "";
}

async function stepValidate(env, job) {
  const t = await getTask(env, job.validate.task);
  if (t.state === "queued" || t.state === "running") return;
  if (t.state === "failed") return fail(job, MSG.validateFail);
  const r = parseStatus(t.text);
  if (!r) return fail(job, MSG.validateFail);
  if (r.status !== 0) {
    const reason = String(r.failureReason || "Фото не подходит.").slice(0, 200);
    return reject(env, job, reason);
  }
  await startRestyle(env, job);
}

async function startRestyle(env, job) {
  if (!(await spend(env))) return fail(job, MSG.closed);
  const prompt = prompts.restyle.replace("{gender}", genderWord(job.gender));
  const task = await startTask(env, "restyle", { image: job.photoRef, prompt });
  job.stage = "restyle";
  job.stickers.base = { state: "running", task };
}

async function stepRestyle(env, job) {
  const base = job.stickers.base;
  if (base.retryAt) {
    if (Date.now() < base.retryAt) return;
    base.retryAt = 0;
    job.restyleRetry = 1;
    return startRestyle(env, job);
  }
  const t = await getTask(env, base.task);
  if (t.state === "queued" || t.state === "running") return;
  if (t.refused) return reject(env, job, MSG.refused);
  if (t.state === "failed" || !t.url) {
    if (job.restyleRetry === 0) {
      base.retryAt = Date.now() + RESTYLE_PAUSE_MS;
      return;
    }
    base.state = "failed";
    return fail(job, MSG.restyleFail);
  }
  base.state = "done";
  base.url = t.url;
  job.stage = "emotions";
  for (const [id, s] of Object.entries(job.stickers)) {
    if (id === "base") continue;
    Object.assign(s, { state: "running", attempt: 0, model: null, lastFail: null });
    await startAttempt(env, job, id, s);
  }
}

async function startAttempt(env, job, id, s, reason) {
  if (s.attempt >= MAX_ATTEMPTS) {
    s.state = "failed";
    return;
  }
  if (!(await spend(env))) {
    s.state = "failed";
    return;
  }
  s.attempt += 1;
  s.model = nextModel(s.model, reason);
  const prompt = prompts.emotions.find((e) => e.id === id).prompt;
  s.genTask = await startTask(env, "emotion", {
    image: job.stickers.base.url, prompt, model: s.model, meta: `${id}#${s.attempt}`,
  });
  s.qaTask = null;
  s.url = null;
  s.phase = "gen";
}

async function stepEmotion(env, job, id, s) {
  if (s.phase === "gen") {
    const t = await getTask(env, s.genTask);
    if (t.state === "queued" || t.state === "running") return;
    if (t.refused) return startAttempt(env, job, id, s, "refused");
    if (t.state === "failed" || !t.url) return startAttempt(env, job, id, s, "error");
    if (!(await spend(env))) {
      s.state = "failed";
      return;
    }
    s.url = t.url;
    s.qaTask = await startTask(env, "qa", {
      image1: job.stickers.base.url, image2: t.url, meta: `${id}#${s.attempt}`,
    });
    s.phase = "qa";
    return;
  }
  const t = await getTask(env, s.qaTask);
  if (t.state === "queued" || t.state === "running") return;
  const r = t.state === "done" ? parseStatus(t.text) : null;
  if (r && r.status === 0) {
    s.state = "done";
    return;
  }
  s.lastFail = "qa";
  return startAttempt(env, job, id, s, "qa");
}

// Один шаг. Возвращает true, если задачу надо сохранить.
export async function advance(env, job) {
  const before = JSON.stringify(job);
  if (job.stage === "validate") await stepValidate(env, job);
  else if (job.stage === "restyle") await stepRestyle(env, job);
  else if (job.stage === "emotions") {
    const pending = Object.entries(job.stickers).filter(([id, s]) => id !== "base" && s.state === "running");
    // последовательно: счётчик runs в KV не атомарный
    for (const [id, s] of pending) await stepEmotion(env, job, id, s);
    if (!Object.entries(job.stickers).some(([id, s]) => id !== "base" && s.state === "running")) job.stage = "done";
  }
  return JSON.stringify(job) !== before;
}
