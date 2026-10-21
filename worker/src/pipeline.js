// Этапы пака: validate → restyle → emotions (+qa). Двигаются при GET, состояние — в задаче (KV).
import prompts from "../prompts.json";
import { uploadImage, startTask, getTask } from "./provider.js";
import { gate } from "./gate.js";

export const EMOTION_IDS = prompts.emotions.map((e) => e.id);
const MAX_ATTEMPTS = 4;
const MAX_BASE_QA = 2; // генераций базового стикера из-за QA (плюс один повтор при ошибке запроса — restyleRetry)
const RESTYLE_PAUSE_MS = 5000;

const MSG = {
  upstream: "Сервис генерации сейчас недоступен. Попробуйте чуть позже.",
  closed: "На сегодня лимит генераций исчерпан. Загляните завтра.",
  refused: "Модель не смогла обработать это фото. Попробуйте другое.",
  validateFail: "Не удалось проверить фото. Попробуйте ещё раз.",
  notFit: "Фото не подходит. Попробуйте другое.",
  restyleFail: "Не получилось нарисовать базовый стикер. Попробуйте ещё раз.",
  baseQaFail: "Базовый стикер получился неаккуратным. Попробуйте ещё раз или выберите другое фото.",
};

// Порядок моделей для следующей попытки. prev: "fast"|"pro"|null, reason: "qa"|"refused"|"error".
export function nextModel(prev, reason) {
  if (!prev) return "fast";
  if (reason === "qa") return prev;
  return prev === "fast" ? "pro" : "fast";
}

export const today = () => new Date().toISOString().slice(0, 10);

// Жёсткий потолок вызовов провайдера в сутки (счётчик в Durable Object — атомарный). false — потолок достигнут.
export const spend = (env) => gate(env, "runs:" + today()).take(Number(env.RUNS_DAY));

export async function runsLeft(env) {
  return (await gate(env, "runs:" + today()).value()) < Number(env.RUNS_DAY);
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

// текст промпта validate без образцов причин ("failureReason": "…") — образцы модель повторяет законно
const PROMPT_TEXT = prompts.validate.replace(/"failureReason"\s*:\s*"[^"]*"/g, " ").toLowerCase().replace(/\s+/g, " ");

// failureReason идёт пользователю: без управляющих символов, ≤200, и не пересказ промпта (инъекция текстом на фото).
function cleanReason(v) {
  const s = String(v || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const low = s.toLowerCase();
  let hits = 0; // окна по 24 символа, совпавшие с промптом; ≥8 (~70 символов) — пересказ, а не причина
  for (let i = 0; i + 24 <= low.length; i += 6) if (PROMPT_TEXT.includes(low.slice(i, i + 24))) hits++;
  if (hits >= 8) return MSG.notFit;
  return s || MSG.notFit;
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
    if ((s.state === "running" || s.state === "done") && s.attempt) o.attempt = s.attempt;
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
    const reason = cleanReason(r.failureReason);
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
  if (base.qaTask) return stepBaseQa(env, job, base);
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
  if (!(await spend(env))) {
    base.state = "failed";
    return fail(job, MSG.closed);
  }
  // QA базового стикера (в блюпринте его нет): тот же qa_single, что у эмоций
  base.url = t.url;
  base.qaTask = await startTask(env, "qa", {
    image1: job.photoRef, image2: t.url, meta: `base#${(job.baseQaFails || 0) + 1}#${job.gender}`,
  });
}

async function stepBaseQa(env, job, base) {
  const t = await getTask(env, base.qaTask);
  if (t.state === "queued" || t.state === "running") return;
  const r = t.state === "done" ? parseStatus(t.text) : null;
  if (!(r && r.status === 0)) {
    job.baseQaFails = (job.baseQaFails || 0) + 1;
    if (job.baseQaFails >= MAX_BASE_QA) {
      base.state = "failed";
      return fail(job, MSG.baseQaFail);
    }
    return startRestyle(env, job);
  }
  base.state = "done";
  base.qaTask = null;
  job.stage = "emotions";
  for (const [id, s] of Object.entries(job.stickers)) {
    if (id === "base") continue;
    Object.assign(s, { state: "running", attempt: 0, model: null, lastFail: null });
    await startAttempt(env, job, id, s);
  }
}

export async function startAttempt(env, job, id, s, reason) {
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

// Брак эмоции, найденный в браузере после заливки: стикер обратно в работу (та же модель, как брак QA).
// Бросает при ошибке провайдера — стикер остаётся как был. Лимит попыток и RUNS_DAY — внутри startAttempt.
export async function retryEmotion(env, job, id, reason) {
  const s = job.stickers[id];
  const prev = { ...s };
  Object.assign(s, { state: "running", lastFail: reason });
  try {
    await startAttempt(env, job, id, s, "qa");
  } catch (e) {
    Object.keys(s).forEach((k) => delete s[k]);
    Object.assign(s, prev);
    throw e;
  }
  if (s.state === "running") job.stage = "emotions";
  job.settled = false; // исход пака мог измениться — зафиксировать заново
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
