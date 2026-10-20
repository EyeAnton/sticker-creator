// Проверка live-провайдеров на подменённом fetch: node worker/tools/provider.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const calls = [];
let handler;
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  return handler(String(url), init);
};
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

const { uploadImage, startTask, getTask, fetchImage } = await import("../src/provider.js");
const env = { PROVIDER_MODE: "live", ROUTES: "validate=replicate,qa=replicate,restyle=runninghub,emotion=runninghub", REPLICATE_API_TOKEN: "r-secret", RUNNINGHUB_API_KEY: "h-secret" };
const body = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]).buffer;

// stub-режим целиком
assert.match(await startTask({ PROVIDER_MODE: "stub" }, "validate", { image: "x" }), /^stub\./);

// upload в оба провайдера → составной ref
handler = (url) => url.includes("replicate.com") ? J({ urls: { get: "https://api.replicate.com/v1/files/abc" } }) : J({ code: 0, data: { fileName: "api/x.jpg" } });
const ref = await uploadImage(env, body, "photo.jpg");
assert.deepEqual(JSON.parse(ref), { replicate: "https://api.replicate.com/v1/files/abc", runninghub: "api/x.jpg" });
assert.equal(calls[0].init.headers.Authorization, "Bearer r-secret");

// validate → Replicate
calls.length = 0;
handler = () => J({ id: "p1", status: "starting" });
assert.equal(await startTask(env, "validate", { image: ref }), "rep:p1");
const sent = JSON.parse(calls[0].init.body).input;
assert.deepEqual(sent.images, ["https://api.replicate.com/v1/files/abc"]);
assert.ok(sent.system_instruction.length > 100);
assert.match(calls[0].url, /\/models\/google\/gemini-2\.5-flash\/predictions$/);

// qa: temperature 0.2, две картинки
await startTask(env, "qa", { image1: "https://replicate.delivery/a.png", image2: "https://replicate.delivery/b.png" });
const qa = JSON.parse(calls.at(-1).init.body).input;
assert.equal(qa.temperature, 0.2);
assert.equal(qa.images.length, 2);

// getTask replicate
handler = () => J({ status: "processing" });
assert.equal((await getTask(env, "rep:p1")).state, "running");
handler = () => J({ status: "succeeded", output: ['{"status"', ":0}"] });
assert.deepEqual(await getTask(env, "rep:p1"), { state: "done", text: '{"status":0}' });
handler = () => J({ status: "succeeded", output: [] });
assert.equal((await getTask(env, "rep:p1")).refused, true);
handler = () => J({ status: "failed", error: "blocked by safety policy" });
assert.equal((await getTask(env, "rep:p1")).refused, true);
handler = () => J({ status: "failed", error: "out of memory" });
const f = await getTask(env, "rep:p1");
assert.equal(f.refused, false);
assert.ok(!JSON.stringify(f).includes("memory"));

// RunningHub не настроен (null в config.json) → понятная ошибка
const cfg = JSON.parse(readFileSync(new URL("../rh/config.json", import.meta.url)));
if (!cfg.stages.restyle.workflowId) {
  await assert.rejects(startTask(env, "restyle", { image: ref, prompt: "p" }), /not configured/);
}

// RunningHub status/outputs
handler = (url) => url.endsWith("/status") ? J({ code: 0, data: "RUNNING" }) : J({ code: 0, data: [] });
assert.equal((await getTask(env, "rh:7")).state, "running");
handler = (url) => url.endsWith("/status") ? J({ code: 0, data: "SUCCESS" }) : J({ code: 0, data: [{ fileUrl: "https://www.runninghub.ai/o/1.png", fileType: "png", nodeId: "9" }] });
assert.deepEqual(await getTask(env, "rh:7"), { state: "done", url: "https://www.runninghub.ai/o/1.png" });
handler = (url) => url.endsWith("/status") ? J({ code: 0, data: "SUCCESS" }) : J({ code: 0, data: [] });
assert.equal((await getTask(env, "rh:7")).refused, true);
handler = (url) => url.endsWith("/status") ? J({ code: 0, data: "FAILED" }) : J({ code: 0, msg: "node error: blocked by safety" });
assert.equal((await getTask(env, "rh:7")).refused, true);

// fetchImage: белый список
await assert.rejects(fetchImage(env, "https://evil.example/x.png"), /not allowed/);
await assert.rejects(fetchImage(env, "http://replicate.delivery/x.png"), /not allowed/);
await assert.rejects(fetchImage(env, "https://replicate.delivery.evil.com/x.png"), /not allowed/);
handler = () => new Response("png", { headers: { "Content-Type": "image/png" } });
assert.equal((await fetchImage(env, "https://x.replicate.delivery/a.png")).status, 200);
handler = () => new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } });
await assert.rejects(fetchImage(env, "https://replicate.delivery/a.png"), /not allowed/);

// тело ответа провайдера не попадает в ошибку
handler = () => new Response("secret r-secret", { status: 500 });
await assert.rejects(startTask(env, "validate", { image: ref }), (e) => !/secret/.test(e.message));

console.log("provider tests ok");
