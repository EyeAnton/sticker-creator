// Провайдер: интерфейс из SPEC.md, детали — PROVIDER.md. PROVIDER_MODE=stub → всё в stub;
// иначе этап идёт по env.ROUTES (replicate | runninghub | stub).
// Необязательное поле input.meta — подсказка только для stub (ветки stub-reject / demon), live его игнорирует.

import prompts from "../prompts.json" with { type: "json" };
import rhConfig from "../rh/config.json" with { type: "json" };

const STUB_MS = 6000;
const STUB_PNG_B64 = "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/gEAG0AGgAEAAGAAyAAwAAAADAAZAK5/AAAbQAaAAQAAYAAYAHL9AwDYAAaADAAAAAPAAJABAABgABgAcv0DADaADAAZAACAASADQK5/AMAGkAEgAwAAMABkABgAAAAGgAwA1z8AgA0gA8AAAAAwAGQAuP4BAGwAA0AGAACAAWAAyAAAADAADAC5/gEAbAADQAYAAIABYADIAAAADAAZAHL9AwA2gAwAAwAAwACQAWAAAAAYADIAXP8AADaADAADAADAAJABYAAAABgABoBc/wAANoABIAMAAMAAMABkAAAAGAAGgFz/AAA2gAEgAwAAMABkAMgAAAAMABkArn8AABtABoABAABgAMgAMAAAAAwAGQCufwAAG0AGgAEAAGAAGAAyAAAADAADQK5/AAAbwACQAQAAYAAYADIAAAAMAANArn8AABvAAJABAAAYADIADAAAAANABoABAABgAMgAcP0DANgAMgAMAAAAA0AGgAEAAGAAyBO4/gEAbAADQAYAAIABYADIAAAAMAAMABkAAAAGgAEg1z8AgA1gAMgAAAAwAAwAAwAAwACQAWAAAAAYADIAXP8AADaADAADAADAAJABYAAAABgAMgAMAAAAA8AAkOsfAMAGMABkAAAAGAAGgAwAAAADwACQAQAAYAAYAHL9AwDYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAGQAuP4BAGwAGQAGAACAAWAAyAAAADAADAAZAAAABoABINc/AIANYADIAAAAMAAMABkAAAAGgAFgAAAAYAAYAAYAAIABIAPA9Q8AYAPIADAAAAAMABkABgAAgAEgA8AAAAAwAAwAGQAAAAaAASADAADAADAA5PoHALABDAAZAAAABoABIL9kAAADwAAwAAAAMAAMAAMAAMAAkAHg+gcAsAFkABgAAAAGgAwAAwAAwACQAWAAAAAYAAaADAAAAAPAAJABAABgABgAMgAAAAwAA0CufwAAG8AAMAAAADAADAADAAAAA8AAMAAAADAADAADAADAAJABYAAAABgAMgAMAAAAA0AGgOsfAMAGkAFgAAAAGAAGgAwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgALj+AQBsABkABgAAgAEgA8AAAAAwAGQAGAAAAAaADAADAADAADAAZAAAABgABoAMAAAAA8AAkAEAAGAAGAAyAAAADAADwAAAAMAAMAAMAAAADAADwPUPAIDD0gAwAAAADAAZAAYAAIABIAPAAAAAMABkABgAAAAGgAEgAwAAwAAwAGQAAAAYAAaADAAAAAPAAJABAABgABgABgAAAAaAAWAAAABgABgABgAAAAaAAWAAAAAYADIADAAAAANABoABAABgAMgAMAAAAAwAA0CufwAAG8AAkAEAAGAAGAAyAAAADAADQAYAAIABYAAYAAAAGAAGgAEAAIABYAAYAAAAGAAGgAEAAGAAyAAwAAAADAAZAAYAAIABIAPAAAAAMADkCQwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAGQAGAAAAAaAASADAADAADAAZAAAABgABoAMAAAAA8AAMAAAADAADAADAAAAA8AAMAAAADAADAADAAAA56UBYAAAABgAMgAMAAAAA0AGgAEAAGAAyACwAQAAXP8GgAwAAAADwACQAQAAYAAYADIAAAAMAANABgAAgAFgABgAAAAYAAaAAQAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkABgAAgAEgA8AAAAAwAAwAGQAAAAaAASADAADAADAAZAAAABgABoAMAAAAA8AAsAEAAHD9GwAGAAAABoABYAAAAGAAGAAGAACAASADwAAAADAAZAAYAAAABoAMAAMAAMAAMABkAAAAGAAGgAwAAAADwACQAQAAYAAYADIAAAAMAAPABgAAwPVvABgAAAAYAAaAAQAAgAFgABgAAAAGgAwAAwAAwACQAWAAAAAYADIADAAAAANABoABAABgABgAsgEAAFz/BoAMAAAAA8AAkAEAAGAAGAAyAAAADAADwAAAAMAAMAAMAAAADAADwAAAADAAZADYAAAArn8ZAAYAAIABIAPAAAAAMABkABgAAAAGgAEgAwAAwAAwAGQAAAAYAAaADAAAAAPAAJANAADg+jcADAAAAAwAA8AAAADAADAADAAAAANABoABAABgAMgAsAEAAFz/MgAMAAAAA0AGgAEAAGAAGAAyAAAADAADQAYAAIABYADIAAAAMAAMANkAAACufwNABgAAgAFgABgAAAAYAAaAAQAAYADIADAAAAAMABkANgAAgOtfBoABAABgAMgAMAAAAAwAA0AGAACAAWAAyAYAAHD9GwAyAAAADAADQAYAAIABYADIAAAAMAAMAAMAAAADwACwAQAAXP8yAAwAAAADQAaAAQAAYADIADAAAAAMABkANgAAgOvfAPAEBgAAgAFgAMgAAAAwAAwAGQAAAAaAASAbAADA9W8AyAAAADAADAAZAAAABoABYAAAABgAMgBsAAAA178MAAMAAMAAkAFgAAAAGAAyAAwAAAADQAaADQAA4Po3AGQAAAAYAAaADAAAAAPAAJANAADg+jcAZAAAABgABoAMAADAAJABYAAAABgAMgBsAAAA178MAAMAAMAAkAFgAAAAGAAyAGwAAADXvwwAAwAAwAAwAGQAAAAYAAaAbAAAANe/ASADAADAADAAZAAAABgABoBsAADA9S8DQAYAAGAAyAAwAAAADAAZADYAAIDrXwaAAQAAYADIADAAAAAMABkANgAAgOvfAJABAABgABgAMgAAAAwAA0A2AACA698AkAEAAGAAGAAyAAAAA0AGgGwAAMD1LwNABgAAYADIADAAAAAMABkANgAAgOtfBoABAABgAMgAMAAAAAwAA0A2AACA698AkAEAAGAAGACyAQAAXP8GgAwAAAADwACQAQAAGAAyAGQDAACufxkAMgAAAANABoBsAADA9S8DwAAAADAAZAAYAAAABoAMABsAAMD1L09gAAAAGAAGgGwAAADXvwEgAwAAwAAwAGQAAAAGgAwA2QAAgOtfBoAMAADAAJABIBsAAHD9ywCQAQAAGAAyAORzAwC4/mUAGAAAAAaADAADAADAAJABYAMAALj+DQAZAAAABoABIBsAAMD1bwDIAAAADAAZALIBAADXvwwAGQAAgAEgA0A2AADg+pcBIAMAADAAZADIBgAAXP8yAAwAAAADQAaADQAA4PqXAWAAAAAYAAaAbAAAANe/ASADAAAwANxaBoBsAADA9S8DQAYAAGAAyACQDQAAuP5lAMgAAAAMABkAsgEAANe/DAAZAACAASADQDYAAOD6lwFgAAAAGAAyAGwAAADXvwEgAwAAwAAwAGQDAACufxkAMgAAAANABoBsAADA9S8DQAYAAGAAyACQDQAAuP5lAMgAAAAMABkAsgEAANe/DAAZAACAASADQDYAAOD6lwEgnzYAwPVvAMgAAAAMAJeSASAbAABw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AEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJBoAkSZIkA0CSJEmSASBJkiTJAJAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJBkAkiRJkgwASZIkSQaAJEmSJANAkiRJkgEgSZIkyQCQJEmSZABIkiRJMgAkSZIkGQCSJEmSDABJkiRJBoAkSZJkAEiSJEkyACRJkiQZAJIkSZIMAEmSJEkGgCRJkiQDQJIkSZIBIEmSJMkAkCRJkmQASJIkSTIAJEmSJBkAkiRJkjyBJEmS9KcGrZCTi4xvIPkAAAAASUVORK5CYII=";

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

// ---------- общее для live ----------

const REP_API = "https://api.replicate.com/v1";
const REP_MODEL = "google/gemini-2.5-flash"; // vision-LLM; env.REPLICATE_MODEL переопределяет (напр. google/gemini-2.5-pro)
const REFUSAL_RE = /safety|policy|blocked|prohibited|sensitive|moderat|inappropriate|harm|violat|nsfw/i;

// Хосты результатов провайдеров (поддомены включены). Дополнить можно var IMG_HOSTS="a.com,b.com".
const IMG_HOSTS = ["replicate.delivery", "api.replicate.com", "runninghub.ai", "runninghub.cn"];

function hostAllowed(env, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const extra = String(env.IMG_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...IMG_HOSTS, ...extra].some((h) => u.hostname === h || u.hostname.endsWith("." + h));
}

function parseRef(ref) {
  try {
    const r = JSON.parse(ref);
    if (r && typeof r === "object") return r;
  } catch {}
  throw new Error("bad image ref");
}

// kind → провайдер. emotion fast/pro — один kind.
function routeOf(env, kind) {
  const m = {};
  for (const part of String(env.ROUTES || "").split(",")) {
    const [k, v] = part.split("=").map((s) => s.trim());
    if (k && v) m[k] = v;
  }
  const r = m[kind];
  if (r !== "replicate" && r !== "runninghub" && r !== "stub") throw new Error("no route for " + kind);
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchOk(url, init, what) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}`); // тело не включаем: может содержать лишнее
  return res;
}

// ---------- Replicate (validate, qa) ----------

const rep = {
  headers(env, extra) {
    if (!env.REPLICATE_API_TOKEN) throw new Error("REPLICATE_API_TOKEN not set");
    return { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`, ...extra };
  },

  async upload(env, body, filename) {
    const form = new FormData();
    form.append("content", new Blob([body], { type: "image/jpeg" }), filename || "photo.jpg");
    const res = await fetchOk(`${REP_API}/files`, { method: "POST", headers: this.headers(env), body: form }, "replicate upload");
    const j = await res.json();
    const url = j && j.urls && j.urls.get;
    if (!url) throw new Error("replicate upload: no url");
    return url;
  },

  // Картинка для входа: из ссылки пары, либо по URL результата (если открывается без ключа), либо перекладываем стримом.
  async imageInput(env, img) {
    if (typeof img === "string" && img.startsWith("{")) {
      const r = parseRef(img);
      if (!r.replicate) throw new Error("ref has no replicate part");
      return r.replicate;
    }
    if (rhConfig.publicOutputUrls !== false || !/runninghub/.test(new URL(img).hostname)) return img;
    const src = await live.fetchImage(env, img);
    return this.upload(env, await src.arrayBuffer(), "image.png");
  },

  async start(env, kind, input) {
    const model = env.REPLICATE_MODEL || REP_MODEL;
    let body;
    if (kind === "validate") {
      body = {
        prompt: "Analyze the attached image and output the JSON result.",
        system_instruction: prompts.validate,
        images: [await this.imageInput(env, input.image)],
      };
    } else {
      body = {
        prompt: "Image 1 is the source reference photo, Image 2 is the generated sticker. Output the JSON result.",
        system_instruction: prompts.qa,
        images: [await this.imageInput(env, input.image1), await this.imageInput(env, input.image2)],
        temperature: 0.2,
      };
    }
    const res = await fetchOk(`${REP_API}/models/${model}/predictions`, {
      method: "POST",
      headers: this.headers(env, { "Content-Type": "application/json" }),
      body: JSON.stringify({ input: body }),
    }, "replicate start");
    const j = await res.json();
    if (!j.id) throw new Error("replicate start: no id");
    return "rep:" + j.id;
  },

  async get(env, id) {
    const res = await fetchOk(`${REP_API}/predictions/${encodeURIComponent(id)}`, { headers: this.headers(env) }, "replicate get");
    const j = await res.json();
    switch (j.status) {
      case "starting":
        return { state: "queued" };
      case "processing":
        return { state: "running" };
      case "succeeded": {
        const text = Array.isArray(j.output) ? j.output.join("") : typeof j.output === "string" ? j.output : "";
        if (!text.trim()) return { state: "failed", refused: true };
        return { state: "done", text };
      }
      case "failed":
        return { state: "failed", refused: REFUSAL_RE.test(String(j.error || "")), error: "replicate failed" };
      default: // canceled и пр.
        return { state: "failed", error: "replicate " + j.status };
    }
  },
};

// ---------- RunningHub (restyle, emotion) ----------

const rh = {
  base() {
    return rhConfig.host || "https://www.runninghub.ai";
  },
  key(env) {
    if (!env.RUNNINGHUB_API_KEY) throw new Error("RUNNINGHUB_API_KEY not set");
    return env.RUNNINGHUB_API_KEY;
  },
  async call(env, path, payload, what) {
    const res = await fetchOk(this.base() + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key(env)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: this.key(env), ...payload }),
    }, what);
    const j = await res.json();
    if (j.code !== 0) throw new Error(`${what}: code ${j.code}`);
    return j;
  },

  async upload(env, body, filename) {
    const form = new FormData();
    form.append("apiKey", this.key(env));
    form.append("fileType", "input");
    form.append("file", new Blob([body], { type: "image/jpeg" }), filename || "photo.jpg");
    const res = await fetchOk(this.base() + "/task/openapi/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key(env)}` },
      body: form,
    }, "runninghub upload");
    const j = await res.json();
    if (j.code !== 0 || !j.data || !j.data.fileName) throw new Error("runninghub upload: code " + j.code);
    return j.data.fileName;
  },

  async imageInput(env, img) {
    if (typeof img === "string" && img.startsWith("{")) {
      const r = parseRef(img);
      if (!r.runninghub) throw new Error("ref has no runninghub part");
      return r.runninghub;
    }
    // URL результата (base-стикер): RunningHub читает только свои загрузки → перекладываем стримом
    const src = await live.fetchImage(env, img);
    return this.upload(env, await src.arrayBuffer(), "base.png");
  },

  stageName(kind, input) {
    return kind === "restyle" ? "restyle" : input.model === "pro" ? "emotion_pro" : "emotion_fast";
  },

  async start(env, kind, input) {
    const st = rhConfig.stages && rhConfig.stages[this.stageName(kind, input)];
    if (!st || !st.workflowId || !st.image || !st.prompt) throw new Error("runninghub stage not configured: " + this.stageName(kind, input));
    const nodeInfoList = [
      { nodeId: st.image.nodeId, fieldName: st.image.fieldName, fieldValue: await this.imageInput(env, input.image) },
      { nodeId: st.prompt.nodeId, fieldName: st.prompt.fieldName, fieldValue: input.prompt },
      ...(st.extra || []),
    ];
    const j = await this.call(env, "/task/openapi/create", { workflowId: st.workflowId, nodeInfoList }, "runninghub start");
    if (!j.data || !j.data.taskId) throw new Error("runninghub start: no taskId");
    return "rh:" + j.data.taskId;
  },

  async get(env, id) {
    const s = await this.call(env, "/task/openapi/status", { taskId: id }, "runninghub status");
    if (s.data === "QUEUED") return { state: "queued" };
    if (s.data === "RUNNING" || s.data === "CREATE") return { state: "running" };
    if (s.data === "FAILED") {
      // причина (если API её отдаёт) — только чтобы отличить отказ модели от сбоя; наружу не уходит
      let refused = false;
      try {
        const o = await fetch(this.base() + "/task/openapi/outputs", {
          method: "POST",
          headers: { Authorization: `Bearer ${this.key(env)}`, "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: this.key(env), taskId: id }),
        });
        refused = REFUSAL_RE.test(JSON.stringify(await o.json()));
      } catch {}
      return { state: "failed", refused, error: "runninghub failed" };
    }
    if (s.data !== "SUCCESS") return { state: "failed", error: "runninghub " + s.data };
    const o = await this.call(env, "/task/openapi/outputs", { taskId: id }, "runninghub outputs");
    const items = Array.isArray(o.data) ? o.data : [];
    const wanted = Object.values(rhConfig.stages || {}).map((st) => st.output && st.output.nodeId).filter(Boolean).map(String);
    const img = items.find((it) => it.fileUrl && (!wanted.length || wanted.includes(String(it.nodeId))) && /^(png|jpe?g|webp)$/i.test(it.fileType || "png"));
    if (!img) return { state: "failed", refused: true }; // успех без картинки = отказ модели
    return { state: "done", url: img.fileUrl };
  },
};

// ---------- роутер ----------

const live = {
  async uploadImage(env, body, filename) {
    const used = new Set(["validate", "restyle"].map((k) => routeOf(env, k)));
    const ref = {};
    if (used.has("replicate")) ref.replicate = await rep.upload(env, body, filename);
    if (used.has("runninghub")) ref.runninghub = await rh.upload(env, body, filename);
    if (!Object.keys(ref).length) return stub.uploadImage(env, body, filename);
    return JSON.stringify(ref);
  },

  async startTask(env, kind, input) {
    const r = routeOf(env, kind);
    if (r === "replicate") return rep.start(env, kind, input);
    if (r === "runninghub") return rh.start(env, kind, input);
    return stub.startTask(env, kind, input);
  },

  async getTask(env, taskId) {
    if (taskId.startsWith("rep:")) return rep.get(env, taskId.slice(4));
    if (taskId.startsWith("rh:")) return rh.get(env, taskId.slice(3));
    return stub.getTask(env, taskId);
  },

  async fetchImage(env, url) {
    if (url.startsWith("stub://")) return stub.fetchImage(env, url);
    if (!hostAllowed(env, url)) throw new Error("host not allowed");
    const headers = new URL(url).hostname.endsWith("api.replicate.com") ? rep.headers(env) : {};
    // редиректы вручную и только на хосты из белого списка; Response со стримом, без декодирования
    let res = await fetch(url, { headers, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const next = new URL(res.headers.get("Location") || "", url).href;
      if (!hostAllowed(env, next)) throw new Error("redirect host not allowed");
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
