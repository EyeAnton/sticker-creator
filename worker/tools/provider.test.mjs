// Проверка live-провайдера RunningHub на подменённом fetch: node worker/tools/provider.test.mjs
import assert from "node:assert/strict";

const calls = [];
let handler;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return handler(String(url), init);
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const { uploadImage, startTask, getTask, fetchImage } = await import("../src/provider.js");
const kv = new Map();
const env = {
  PROVIDER_MODE: "live",
  RH_API_BASE_URL: "https://www.runninghub.ai/openapi/v2/",
  RUNNINGHUB_API_KEY: "h-secret",
  RH_VALIDATE: "v/val", RH_RESTYLE: "r/restyle", RH_EMOTION_FAST: "e/fast", RH_EMOTION_PRO: "e/pro", RH_QA: "q/qa", RH_RESOLUTION: "1k",
  JOBS: { put: async (k, v) => void kv.set(k, v), get: async (k) => kv.get(k) },
};
const body = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]).buffer;

// stub-режим целиком
assert.match(await startTask({ PROVIDER_MODE: "stub" }, "validate", { image: "x" }), /^stub\./);

// upload: поле file, Bearer, без повторов при бизнес-ошибке
handler = () => J({ code: 0, data: { download_url: "https://rh.example/in/1.jpg" } });
assert.equal(await uploadImage(env, body, "photo.jpg"), "https://rh.example/in/1.jpg");
assert.equal(calls[0].url, "https://www.runninghub.ai/openapi/v2/media/upload/binary");
assert.equal(calls[0].init.headers.Authorization, "Bearer h-secret");
assert.ok(calls[0].init.body.get("file"));
calls.length = 0;
handler = () => J({ code: 1602, msg: "HEADER_API_KEY_NOT_FOUND" });
await assert.rejects(uploadImage(env, body), /1602/);
assert.equal(calls.length, 1);

// submit: endpoints и поля
const url = "https://rh.example/in/1.jpg";
handler = () => J({ taskId: "T1" });
const sent = () => JSON.parse(calls.at(-1).init.body);
const tid = await startTask(env, "validate", { image: url });
assert.match(tid, /^rh:\d+:T1$/);
assert.match(calls.at(-1).url, /\/openapi\/v2\/v\/val$/);
assert.deepEqual(Object.keys(sent()).sort(), ["imageUrl", "prompt"]);
assert.ok(sent().prompt.length > 100 && sent().imageUrl === url);
await startTask(env, "restyle", { image: url, prompt: "p" });
assert.deepEqual(sent(), { imageUrls: [url], prompt: "p", resolution: "1k", aspectRatio: "1:1" });
assert.match(calls.at(-1).url, /r\/restyle$/);
await startTask(env, "emotion", { image: url, prompt: "p", model: "fast" });
assert.match(calls.at(-1).url, /e\/fast$/);
await startTask(env, "emotion", { image: url, prompt: "p", model: "pro" });
assert.match(calls.at(-1).url, /e\/pro$/);
await startTask(env, "qa", { image1: "https://a/1.png", image2: "https://a/2.png" });
assert.match(calls.at(-1).url, /q\/qa$/);
assert.equal(sent().imageUrl, "https://a/2.png");
assert.ok(!("imageUrls" in sent()) && !/Image 1/.test(sent().prompt));
assert.ok(sent().prompt.length > 100);

// submit: code≠0 с HTTP 200 → ошибка, без повтора; errorCode/errorMessage тоже
calls.length = 0;
handler = () => J({ code: 1007, msg: "bad param" });
await assert.rejects(startTask(env, "validate", { image: url }), /1007/);
handler = () => J({ errorCode: "1007", errorMessage: "must be greater than 0", taskId: "" });
await assert.rejects(startTask(env, "validate", { image: url }), /must be greater/);
assert.equal(calls.length, 2);

// повторы: 5xx и сеть → до 3, затем успех/ошибка; 429 тоже
calls.length = 0;
let n = 0;
handler = () => (++n < 3 ? J({}, 503) : J({ taskId: "T2" }));
assert.match(await startTask(env, "validate", { image: url }), /T2$/);
assert.equal(calls.length, 3);
calls.length = 0;
handler = () => { throw new TypeError("net down"); };
await assert.rejects(startTask(env, "validate", { image: url }), /network/);
assert.equal(calls.length, 3);
calls.length = 0;
handler = () => J({}, 400);
await assert.rejects(startTask(env, "validate", { image: url }), /HTTP 400/);
assert.equal(calls.length, 1);

// query: статусы
const T = `rh:${Date.now()}:T1`;
const q = (o) => { handler = () => J(o); return getTask(env, T); };
assert.equal((await q({ status: "CREATE" })).state, "queued");
assert.equal((await q({ status: "QUEUED" })).state, "queued");
assert.equal((await q({ status: "RUNNING" })).state, "running");
assert.deepEqual(await q({ status: "SUCCESS", results: [{ url: "https://x.runninghub.ai/o.png", outputType: "image" }] }), { state: "done", url: "https://x.runninghub.ai/o.png" });
assert.deepEqual(await q({ status: "SUCCESS", results: [{ outputUrl: "https://x.runninghub.ai/o2.png" }] }), { state: "done", url: "https://x.runninghub.ai/o2.png" });
assert.deepEqual(await q({ status: "SUCCESS", results: [{ text: '{"status":0}' }] }), { state: "done", text: '{"status":0}' });
assert.deepEqual(await q({ status: "SUCCESS", results: [{ content: "c" }] }), { state: "done", text: "c" });
assert.equal((await q({ status: "SUCCESS", results: [] })).state, "failed");

// FAILED/CANCEL: policy → refused; сбой канала → error без refused; текст — в KV, не в ответе
let r = await q({ status: "FAILED", errorCode: "805", errorMessage: "content violates policy", failedReason: {} });
assert.equal(r.state, "failed"); assert.equal(r.refused, true);
assert.ok(!JSON.stringify(r).includes("policy"));
assert.match(kv.get("taskerr:T1"), /policy/);
r = await q({ status: "FAILED", errorCode: "500", errorMessage: "channel upstream error", failedReason: {} });
assert.equal(r.state, "failed"); assert.equal(r.refused, false);
assert.match(kv.get("taskerr:T1"), /channel upstream/);
assert.ok(JSON.parse(kv.get("taskerr:T1")).error.length <= 300);
r = await q({ status: "CANCEL", errorMessage: "NSFW detected" });
assert.equal(r.refused, true);
r = await q({ status: "CANCEL" });
assert.equal(r.refused, false);
r = await q({ status: "WAT" });
assert.equal(r.state, "failed");
// code≠0 в ответе /query → failed (не бросает)
r = await q({ code: 1602, msg: "HEADER_API_KEY_NOT_FOUND" });
assert.equal(r.state, "failed"); assert.equal(r.refused, false);
// длинная ошибка обрезается
await q({ status: "FAILED", errorMessage: "x".repeat(900) });
assert.equal(JSON.parse(kv.get("taskerr:T1")).error.length, 300);
// 5xx на /query — исключение (клиент опросит ещё раз), после 3 попыток
calls.length = 0;
handler = () => J({}, 502);
await assert.rejects(getTask(env, T), /HTTP 502/);
assert.equal(calls.length, 3);

// таймаут 10 минут
r = await (async () => { handler = () => J({ status: "RUNNING" }); return getTask(env, `rh:${Date.now() - 11 * 60 * 1000}:T9`); })();
assert.equal(r.state, "failed"); assert.equal(r.refused, undefined);
assert.match(kv.get("taskerr:T9"), /timeout/);
r = await (async () => { handler = () => J({ status: "RUNNING" }); return getTask(env, `rh:${Date.now() - 5 * 60 * 1000}:T9`); })();
assert.equal(r.state, "running");

// fetchImage: белый список
await assert.rejects(fetchImage(env, "https://evil.example/x.png"), /not allowed/);
await assert.rejects(fetchImage(env, "http://rh.runninghub.ai/x.png"), /not allowed/);
await assert.rejects(fetchImage(env, "https://runninghub.ai.evil.com/x.png"), /not allowed/);
handler = () => new Response("png", { headers: { "Content-Type": "image/png" } });
assert.equal((await fetchImage(env, "https://rh.runninghub.ai/a.png")).status, 200);
assert.equal((await fetchImage({ ...env, RH_IMG_HOSTS: "cdn.example" }, "https://x.cdn.example/a.png")).status, 200);
assert.equal((await fetchImage({ ...env, RH_IMG_HOSTS: "rh-hk-images-1.cos.ap-hongkong.myqcloud.com" }, "https://rh-hk-images-1.cos.ap-hongkong.myqcloud.com/a.jpg")).status, 200);
await assert.rejects(fetchImage({ ...env, RH_IMG_HOSTS: "rh-hk-images-1.cos.ap-hongkong.myqcloud.com" }, "https://other-bucket.cos.ap-hongkong.myqcloud.com/a.jpg"), /not allowed/);
handler = () => new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } });
await assert.rejects(fetchImage(env, "https://rh.runninghub.ai/a.png"), /not allowed/);

// ключ не попадает в ошибки
handler = () => new Response("secret h-secret", { status: 400 });
await assert.rejects(startTask(env, "validate", { image: url }), (e) => !/secret/.test(e.message));

console.log("provider tests ok");
