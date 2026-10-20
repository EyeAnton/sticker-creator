// Провайдер: интерфейс из SPEC.md, детали — PROVIDER.md. PROVIDER_MODE=stub → всё в stub;
// иначе все этапы идут на RunningHub Standard Model API (контракт: developer-kit/rh-api-contract.md).
// Необязательное поле input.meta — подсказка только для stub (ветки stub-reject / demon), live его игнорирует.

import prompts from "../prompts.json" with { type: "json" };

const STUB_MS = 6000;
const STUB_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAABAAAAAQACAIAAADwf7zUAAAd50lEQVR42u3XwQ0DQQgEwck/aYiCB1CljmAln5mkIkmSJOlLnkCSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSTIAJEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkmQAeAJJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJOlONc8jS5IBIElafNAbDJJkAEiS3PcWgiQZAJIkh75hIEkGgCTJrW8VSJIBIElufawCSTIAJMnFjz0gSQaAJDn3MQkkyQCQJBc/9oAkGQCS5OjHGJAkA0CSXPzYA5JkAEiSox9jQJIMAEmOfjAGJBkAkuToB2NAkgEgSY5+MAYkGQCS5O4HS0CSASBJjn6MAUkyACTJ3Y8lIEkGgCS5+7EEJMkAkOTuB0tAkgwASe5+sAQkyQCQ5O4HS0CSDABJ7n6wBCTJAJDk7gdLQJIBIEnufrAEJBkAkuTuB0tAkgEgSU5/MAMkGQCS3P2AJSDJAJDk9AfMAEkGgCR3P2AJSDIAJDn9ATNAkgEgyd0PWAKSDABJTn/ADJBkAEhy+oMZ4AsmyQCQ5O4HS0CSPIEkpz+YAZIMAElOf8AMkGQASHL6A2aAJANAktMfMAMkGQCSnP6AGSDJAJDk9AfMAEkGgCSnP2AGSDIAJDn9ATNAkgEgyekPmAGSDABJTn/ADJBkAEhOfwAzQJIBIDn9AcwAyQCQ5PQHMAMkA0CS0x/ADJAMAElOf8AMkGQASHL6A2aAJANAkusfsAEkGQCSnP6AGSDJAJDk9AfMAEkGgOT0BzADJBkAkusfwAaQZABITn8AM0CSASA5/QHMAMkAkOT6B7ABJANAktMfwAyQDABJTn8AM0AyACS5/gFsAMkAkOT0BzADJANAcv0D2ACSDADJ6Q9gBkgyACTXP4ANIMkAkJz+AGaAJANAcv0D2ACSDADJ6Q9gBkgGgCTXP4ANIBkAkpz+AGaAZABIcv0D2ACSASA5/QEwAyQDQHL9A2ADSAaA5PQHwAyQDADJ9Q+ADSAZAJLrHwAbQDIAJKc/gBkgyQCQXP8ANoAkA0By/QPYAJIBIMnpD2AGSAaAJNc/gA0gGQCS6x8AG0AyACSnPwBmgGQASK5/AGwAyQCQXP8A2ACSASA5/QEwAyQDQHL9A2ADSAaA5PoHwAaQDADJ9Q+ADSAZAJLrH8AG8H8nGQCS0x/ADJAMAMn1D4ANIBkAkusfABtAMgAk1z8ANoBkAEiufwBsAMkAkJz+AJgBkgEguf4BsAEkA0By/QNgA0gGgOT6B8AGkAwAyfUPgA0gGQBy/QOADSAZAHL9A4ANIANAcvoDgBkgA0By/QNgA0gGgOT6B8AGkAwAyfUPgA0gGQCS6x8AG0AyACTXPwA2gGQASK5/AGwAyQCQXP8A2ACSASDXPwDYAJIBINc/ANgAkgEg1z8A2AAyACTXPwDYADIAJNc/ANgAMgAk1z8A2AAyACTXPwA2gGQASK5/AGwAyQCQXP8A2ACSASC5/gGwASQDQK5/ALABJANArn8AsAEkA0CufwCwASQDQK5/ALABZABIrn8AsAFkAEiufwCwAWQASK5/ALABZABIrn8AsAFkAEiufwCwAWQASK5/AGwAyQCQ6x8AbADJAJABAAAGgGQAyPUPADaAZADI9Q8ANoBkAMj1DwA2gOQJ5PoHABtABoDk+gcAG0AGgOT6BwAbQAaA5PoHABtABoBkAACAASADQK5/AMAGkAEg1z8A2ACSASDXPwDYAJIBINc/ANgAkgEg1z8A2ACSASADAAAMAMkAkOsfAGwAGQCS6x8AbAAZAJLrHwBsABkAkusfAGwAGQBy/QMANoAMABkAAIABIANArn8AwAaQASDXPwBgA8gAkOsfAGwAyQCQAQAABoBkAMj1DwA2gGQAyPUPADaADADJ9Q8ANoAMAMkAAAADQAaA5PoHABtABoBc/wCADSADQK5/AMAGkAEgAwAAMABkAMj1DwDYADIA5PoHAGwAGQBy/QOADSAZADIAAMAAkAwAuf4BwAaQASC5/gHABpABIBkAAGAAyACQ6x8AsAFkAMj1DwDYADIAZAAAAAaADAC5/gEAG0AGgFz/AIANIANABgAAYADIAJDrHwCwAWQAyPUPANgAMgBkAACAASADQHL9A4ANIANArn8AwAaQASADAAAwAGQAyPUPANgAMgDk+gcAbAAZADIAAAADQAaAXP8AgA0gA0CufwDABpABIAMAADAAZADI9Q8A2AAyAGQAAAAGgAwA1z8AYAPIAJDrHwCwAWQAyAAAAAwAGQBy/QMANoAMABkAAIABIANArn8AwAaQASDXPwBgA8gAkAEAABgAMgDk+gcAbAAZADIAAAADQAaAXP8AgA0gA8AAAAAwAAwAuf4BABtABoBc/wCADSADQAYAAGAAyACQ6x8AsAFkAMgAAAAMABkAcv0DADaADAAZAACAASADQK5/AMAGkAEgAwAAMABkALj+AQBsABkABgAAgAFgAMj1DwBgAxgAMgAAAANABoBc/wCADSADQAYAAGAAyACQ6x8AsAFkAMgAAAAMABkAcv0DADaADAAZAACAASADQK5/AMAGkAFgAAAAGAAyAFz/AAA2gAEgAwAAwAAwAOT6BwCwAQwAGQAAgAEgA0CufwDABpABIAMAADAAZADI9Q8A2AAyAGQAAAAGgAwAuf4BABtABoABAABgAMgAcP0DANgAMgAMAAAAA8AA8ASufwAAG8AAkAEAAGAAGAAyAAAADAADQK5/AMAGkAEgAwAAMABkAMj1DwDYADIAZAAAAAaADAC5/gEAG0AGgAEAAGAAyAAwAAAADAAZAK5/AAAbQAaAAQAAYAAYAHL9AwDYAAaADAAAAAPAAJABAABgABgAcv0DADaADAAZAACAASADQK5/AMAGkAEgAwAAMABkABgAAAAGgAwA1z8AgA0gA8AAAAAwAGQAuP4BAGwAA0AGAACAAWAAyAAAADAADAC5/gEAbAADQAYAAIABYADIAAAADAAZAHL9AwA2gAwAAwAAwACQAWAAAAAYADIAXP8AADaADAADAADAAJABYAAAABgABoBc/wAANoABIAMAAMAAMABkAAAAGAAGgFz/AAA2gAEgAwAAMABkAMgAAAAMABkArn8AABtABoABAABgAMgAMAAAAAwAGQCufwAAG0AGgAEAAGAAGAAyAAAADAADQK5/AAAbwACQAQAAYAAYADIAAAAMAANArn8AABvAAJABAAAYADIADAAAAANABoABAABgAMgAcP0DANgAMgAMAAAAA0AGgAEAAGAAyBO4/gEAbAADQAYAAIABYADIAAAAMAAMABkAAAAGgAEg1z8AgA1gAMgAAAAwAAwAAwAAwACQAWAAAAAYADIAXP8AADaADAADAADAAJABYAAAABgAMgAMAAAAA8AAkOsfAMAGMABkAAAAGAAGgAwAAAADwACQAQAAYAAYAHL9AwDYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAGQAuP4BAGwAGQAGAACAAWAAyAAAADAADAAZAAAABoABINc/AIANYADIAAAAMAAMABkAAAAGgAFgAAAAYAAYAAYAAIABIAPA9Q8AYAPIADAAAAAMABkABgAAgAEgA8AAAAAwAAwAGQAAAAaAASADAADAADAA5PoHALABDAAZAAAABoABIL9kAAADwAAwAAAAMAAMAAMAAMAAkAHg+gcAsAFkABgAAAAGgAwAAwAAwACQAWAAAAAYAAaADAAAAAPAAJABAABgABgAMgAAAAwAA0CufwAAG8AAMAAAADAADAADAAAAA8AAMAAAADAADAADAADAAJABYAAAABgAMgAMAAAAA0AGgOsfAMAGkAFgAAAAGAAGgAwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgALj+AQBsABkABgAAgAEgA8AAAAAwAGQAGAAAAAaADAADAADAADAAZAAAABgABoAMAAAAA8AAkAEAAGAAGAAyAAAADAADwAAAAMAAMAAMAAAADAADwPUPAIDD0gAwAAAADAAZAAYAAIABIAPAAAAAMABkABgAAAAGgAEgAwAAwAAwAGQAAAAYAAaADAAAAAPAAJABAABgABgABgAAAAaAAWAAAABgABgABgAAAAaAAWAAAAAYADIADAAAAANABoABAABgAMgAMAAAAAwAA0CufwAAG8AAkAEAAGAAGAAyAAAADAADQAYAAIABYAAYAAAAGAAGgAEAAIABYAAYAAAAGAAGgAEAAGAAyAAwAAAADAAZAAYAAIABIAPAAAAAMADkCQwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAGQAGAAAAAaAASADAADAADAAZAAAABgABoAMAAAAA8AAMAAAADAADAADAAAAA8AAMAAAADAADAADAAAA56UBYAAAABgAMgAMAAAAA0AGgAEAAGAAyACwAQAAXP8GgAwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAAwAGQAAAAaAASADAADAADAAZAAAABgABoAMAAAAA8AAsAEAAHD9GwAGAAAABoABYAAAAGAAGAAGAACAASADwAAAADAAZAAYAAAABoAMAAMAAMAAMABkAAAAGAAGgAwAAAADwACQAQAAYAAYADIAAAAMAAPABgAAwPVvABgAAAAYAAaAAQAAgAFgABgAAAAGgAwAAwAAwACQAWAAAAAYADIADAAAAANABoABAABgABgAsgEAAFz/BoAMAAAAA8AAkAEAAGAAGAAyAAAADAADwAAAAMAAMAAMAAAADAADwAAAADAAZADYAAAArn8ZAAYAAIABIAPAAAAAMABkABgAAAAGgAEgAwAAwAAwAGQAAAAYAAaADAAAAAPAAJANAADg+jcADAAAAAwAA8AAAADAADAADAAAAANABoABAABgAMgAsAEAAFz/MgAMAAAAA0AGgAEAAGAAGAAyAAAADAADQAYAAIABYADIAAAAMAAMANkAAACufwNABgAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkANgAAgOtfBoABAABgAMgAMAAAAAwAA0AGAACAAWAAyAYAAHD9GwAyAAAADAADQAYAAIABYADIAAAAMAAMAAMAAAADwACwAQAAXP8yAAwAAAADQAaAAQAAYADIADAAAAAMABkANgAAgOvfAPAEBgAAgAFgAMgAAAAwAAwAGQAAAAaAASAbAADA9W8AyAAAADAADAAZAAAABoABYAAAABgAMgBsAAAA178MAAMAAMAAkAFgAAAAGAAyAAwAAAADQAaADQAA4Po3AGQAAAAYAAaADAAAAAPAAJANAADg+jcAZAAAABgABoAMAADAAJABYAAAABgAMgBsAAAA178MAAMAAMAAkAFgAAAAGAAyAGwAAADXvwwAAwAAwAAwAGQAAAAYAAaAbAAAANe/ASADAADAADAAZAAAABgABoBsAADA9S8DQAYAAGAAyAAwAAAADAAZADYAAIDrXwaAAQAAYADIADAAAAAMABkANgAAgOvfAJABAABgABgAMgAAAAwAA0A2AACA698AkAEAAGAAGAAyAAAAA0AGgGwAAMD1LwNABgAAYADIADAAAAAMABkANgAAgOtfBoABAABgAMgAMAAAAAwAA0A2AACA698AkAEAAGAAGACyAQAAXP8GgAwAAAADwACQAQAAGAAyAGQDAACufxkAMgAAAANABoBsAADA9S8DwAAAADAAZAAYAAAABoAMABsAAMD1L09gAAAAGAAGgGwAAADXvwEgAwAAwAAwAGQAAAAGgAwA2QAAgOtfBoAMAADAAJABIBsAAHD9ywCQAQAAGAAyAORzAwC4/mUAGAAAAAaADAADAADAAJABYAMAALj+DQAZAAAABoABIBsAAMD1bwDIAAAADAAZALIBAADXvwwAGQAAgAEgA0A2AADg+pcBIAMAADAAZADIBgAAXP8yAAwAAAADQAaADQAA4PqXAWAAAAAYAAaAbAAAANe/ASADAAAwANxaBoBsAADA9S8DQAYAAGAAyACQDQAAuP5lAMgAAAAMABkAsgEAANe/DAAZAACAASADQDYAAOD6lwFgAAAAGAAyAGwAAADXvwEgAwAAwAAwAGQDAACufxkAMgAAAANABoBsAADA9S8DQAYAAGAAyACQDQAAuP5lAMgAAAAMABkAsgEAANe/DAAZAACAASADQDYAAOD6lwEgnzYAwPVvAMgAAAAMAJeSASAbAABw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AEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkjyBJEmS9KcGrZCTi4xvIPkAAAAASUVORK5CYII=";

let stubPng;
function stubBytes() {
  if (!stubPng) stubPng = Uint8Array.from(atob(STUB_PNG_B64), (c) => c.charCodeAt(0));
  return stubPng;
}

const stub = {
  async uploadImage(env, body, filename) {
    return "stub://photo/" + encodeURIComponent(filename || "photo.jpg");
  },

  async startTask(env, kind, input) {
    const meta = input.meta || "";
    return ["stub", kind, Date.now(), encodeURIComponent(meta)].join(".");
  },

  async getTask(env, taskId) {
    const [, kind, started, meta = ""] = taskId.split(".");
    if (Date.now() - Number(started) < STUB_MS) return { state: "running" };
    const tag = decodeURIComponent(meta);
    if (kind === "validate") {
      const text = tag === "stub-reject"
        ? JSON.stringify({ status: 1, boundingBox: null, failureReason: "Тестовый отказ: фото не прошло проверку." })
        : JSON.stringify({ status: 0 });
      return { state: "done", text };
    }
    if (kind === "qa") {
      // tag = "<emotion>#<attempt>"; demon: первые 2 попытки QA отклоняет
      const [emotion, attempt] = tag.split("#");
      const bad = emotion === "demon" && Number(attempt) <= 2;
      return { state: "done", text: JSON.stringify(bad ? { status: 1, failureReason: "stub qa" } : { status: 0 }) };
    }
    return { state: "done", url: "stub://img/" + encodeURIComponent(tag || kind) };
  },

  async fetchImage(env, url) {
    return new Response(stubBytes(), { headers: { "Content-Type": "image/png" } });
  },
};

// ---------- RunningHub Standard Model API ----------

const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const RETRIES = 3;
const ERR_TTL = 2 * 86400;
const REFUSAL_RE = /policy|moderat|safety|nsfw|violat|forbidden/i;
const DEFAULT_IMG_HOSTS = ["runninghub.ai", "runninghub.cn"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function base(env) {
  if (!env.RH_API_BASE_URL) throw new Error("RH_API_BASE_URL not set");
  return env.RH_API_BASE_URL.replace(/\/+$/, "");
}

function auth(env) {
  if (!env.RUNNINGHUB_API_KEY) throw new Error("RUNNINGHUB_API_KEY not set");
  return { Authorization: `Bearer ${env.RUNNINGHUB_API_KEY}` };
}

function endpointOf(env, kind, input) {
  const v = kind === "validate" ? env.RH_VALIDATE
    : kind === "restyle" ? env.RH_RESTYLE
    : kind === "qa" ? env.RH_QA
    : input.model === "pro" ? env.RH_EMOTION_PRO : env.RH_EMOTION_FAST;
  if (!v) throw new Error("no endpoint for " + kind);
  return v;
}

// Ошибка бизнес-уровня: приходит с HTTP 200 — либо {code≠0,msg}, либо {errorCode,errorMessage,failedReason}.
function bizError(j) {
  if (!j || typeof j !== "object") return "empty response";
  const hasCode = j.code !== undefined && j.code !== null && j.code !== 0 && j.code !== "0";
  if (!hasCode && !j.errorCode && !j.errorMessage) return null;
  const reason = j.failedReason && typeof j.failedReason === "object" && Object.keys(j.failedReason).length ? JSON.stringify(j.failedReason) : "";
  const parts = [j.code ?? j.errorCode, j.msg || j.message || j.errorMessage, reason].filter((x) => x !== undefined && x !== null && x !== "");
  return parts.join(" ").slice(0, 300) || "error";
}

class RhError extends Error {
  constructor(message, { refused } = {}) {
    super(message);
    this.refused = !!refused;
  }
}

// fetch с повтором только для сети / 429 / 5xx (до RETRIES попыток, экспоненциальная пауза).
async function rhFetch(url, init, what) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    if (i) await sleep(500 * 2 ** (i - 1));
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      last = new Error(`${what}: network error`);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = new Error(`${what}: HTTP ${res.status}`); // тело не включаем: может содержать лишнее
      continue;
    }
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`);
    let j;
    try {
      j = await res.json();
    } catch {
      last = new Error(`${what}: bad json`);
      continue;
    }
    const e = bizError(j);
    if (e) throw new RhError(`${what}: ${e}`, { refused: REFUSAL_RE.test(e) });
    return j;
  }
  throw last;
}

const postJson = (env, path, payload, what) =>
  rhFetch(`${base(env)}${path}`, {
    method: "POST",
    headers: { ...auth(env), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, what);

// Причину сбоя сохраняем в KV рядом с задачами (клиенту не отдаётся).
async function noteError(env, taskId, status, text) {
  console.log("rh error", taskId, status, String(text || "").slice(0, 300));
  if (!env.JOBS) return;
  try {
    await env.JOBS.put("taskerr:" + taskId, JSON.stringify({ status, error: String(text || "").slice(0, 300) }), { expirationTtl: ERR_TTL });
  } catch {}
}

// Поле file, тело как есть (ArrayBuffer без декодирования).
async function upload(env, body, filename) {
  const form = () => {
    const f = new FormData();
    f.append("file", new Blob([body], { type: "image/jpeg" }), filename || "photo.jpg");
    return f;
  };
  let last;
  for (let i = 0; i < RETRIES; i++) {
    if (i) await sleep(500 * 2 ** (i - 1));
    let res;
    try {
      res = await fetch(`${base(env)}/media/upload/binary`, { method: "POST", headers: auth(env), body: form() });
    } catch {
      last = new Error("rh upload: network error");
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = new Error("rh upload: HTTP " + res.status);
      continue;
    }
    if (!res.ok) throw new Error("rh upload: HTTP " + res.status);
    const j = await res.json().catch(() => null);
    const e = bizError(j);
    if (e) throw new Error("rh upload: " + e);
    const url = j && j.data && j.data.download_url;
    if (!url) throw new Error("rh upload: no download_url");
    return url;
  }
  throw last;
}

// text-модели RunningHub без схемы ответа отвечают прозой (на китайском): инструкция «только JSON» нужна короткой, в начале и в конце
// (проверено живыми пробами: с длинным промптом одной припиской в конце g-25-pro отвечал по-китайски).
const JSON_ONLY = "Reply with ONLY a raw JSON object, nothing else. English only. No prose, no markdown.";
const QA_FORMAT = 'Now evaluate the attached image. Your entire reply must be exactly one JSON object in English, either {"status": 0} or {"status": 1, "failureReason": "<short English reason>"}. Do not write anything else, no Chinese.';

function payloadOf(env, kind, input) {
  if (kind === "validate") return { prompt: `${JSON_ONLY}\n\n${prompts.validate}\n\n${JSON_ONLY}`, imageUrl: input.image };
  // QA по одной картинке (результат): сравнения с base нет
  if (kind === "qa") return { prompt: `You must answer in English with a single raw JSON object and nothing else.\n\n${prompts.qa_single}\n\n${QA_FORMAT}`, imageUrl: input.image2 };
  return { imageUrls: [input.image], prompt: input.prompt, resolution: env.RH_RESOLUTION || "1k", aspectRatio: "1:1" };
}

// taskId задачи: "rh:<время старта, мс>:<taskId RunningHub>" — время нужно для таймаута.
const live = {
  uploadImage: (env, body, filename) => upload(env, body, filename),

  async startTask(env, kind, input) {
    const j = await postJson(env, "/" + endpointOf(env, kind, input), payloadOf(env, kind, input), "rh submit");
    const id = j.taskId || j.task_id;
    if (!id) throw new Error("rh submit: no taskId");
    console.log("rh submit", endpointOf(env, kind, input), id);
    return `rh:${Date.now()}:${id}`;
  },

  async getTask(env, taskId) {
    if (!taskId.startsWith("rh:")) return stub.getTask(env, taskId);
    const m = /^rh:(\d+):(.+)$/.exec(taskId);
    if (!m) throw new Error("bad task id");
    const started = m[1], id = m[2];
    let j;
    try {
      j = await postJson(env, "/query", { taskId: id }, "rh query");
    } catch (e) {
      if (e instanceof RhError) {
        await noteError(env, id, "QUERY_ERROR", e.message);
        return { state: "failed", refused: e.refused, error: "rh query" };
      }
      throw e; // сеть/5xx после повторов — клиент опросит ещё раз
    }
    const status = String(j.status || "").toUpperCase();
    console.log("rh query", id, status);
    if (status === "CREATE" || status === "QUEUED" || status === "RUNNING") {
      if (Date.now() - Number(started) > TASK_TIMEOUT_MS) {
        await noteError(env, id, status, "timeout");
        return { state: "failed", error: "rh timeout" };
      }
      return { state: status === "RUNNING" ? "running" : "queued" };
    }
    if (status === "SUCCESS") {
      const items = Array.isArray(j.results) ? j.results : [];
      const url = items.map((r) => r && (r.url || r.outputUrl)).find(Boolean);
      const text = items.map((r) => r && (r.text || r.content || r.output)).find((t) => typeof t === "string" && t.trim());
      if (url) return { state: "done", url };
      if (text) return { state: "done", text };
      await noteError(env, id, status, "success without outputs");
      return { state: "failed", error: "rh empty" };
    }
    if (status === "FAILED" || status === "CANCEL") {
      const msg = bizError({ errorCode: j.errorCode, errorMessage: j.errorMessage, failedReason: j.failedReason }) || status;
      await noteError(env, id, status, msg);
      return { state: "failed", refused: REFUSAL_RE.test(msg), error: "rh " + status };
    }
    await noteError(env, id, status, "unknown status");
    return { state: "failed", error: "rh unknown status" };
  },

  async fetchImage(env, url) {
    if (url.startsWith("stub://")) return stub.fetchImage(env, url);
    const hosts = [...DEFAULT_IMG_HOSTS, ...String(env.RH_IMG_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)];
    const ok = (u) => {
      try {
        const x = new URL(u);
        return x.protocol === "https:" && hosts.some((h) => x.hostname === h || x.hostname.endsWith("." + h));
      } catch {
        return false;
      }
    };
    if (!ok(url)) throw new Error("host not allowed");
    // редиректы вручную и только на хосты из белого списка; Response со стримом, без декодирования
    let res = await fetch(url, { redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("Location") || "", url).href;
      if (!ok(next)) throw new Error("redirect host not allowed");
      res = await fetch(next, { redirect: "manual" });
    }
    if (!res.ok) throw new Error("fetch image: HTTP " + res.status);
    return res;
  },
};

function impl(env) {
  return env.PROVIDER_MODE === "stub" ? stub : live;
}

export const uploadImage = (env, body, filename) => impl(env).uploadImage(env, body, filename);
export const startTask = (env, kind, input) => impl(env).startTask(env, kind, input);
export const getTask = (env, taskId) => impl(env).getTask(env, taskId);
export const fetchImage = (env, url) => impl(env).fetchImage(env, url);
