// Юнит-тест вырезки фона и белой обводки на синтетике (картинки строятся в тесте): node tools/chroma.test.mjs
import assert from "node:assert/strict";
import { cutSticker as fillCut, STICKER as S } from "../js/chroma.js";

// фигура — эллипс (кожа, глаза), вокруг — белая обводка 10 px; bg(x, y) → [r, g, b]
function scene({ bg, cx = 256, cy = 256, rx = 150, ry = 190, hole = null, outline = [255, 255, 255], skin = [196, 140, 110] }) {
  const d = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const e = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const eo = Math.hypot((x - cx) / (rx + 10), (y - cy) / (ry + 10));
      let c;
      if (e <= 1) c = Math.hypot(x - cx, y - (cy - 10)) < 12 ? [30, 20, 20] : skin;
      else if (eo <= 1) c = outline;
      else c = bg(x, y);
      // дырка в обводке: полоса 6 px слева от фигуры
      if (hole && e > 1 && eo <= 1 && Math.abs(y - cy) <= 3 && x < cx) c = bg(x, y);
      d.set([c[0], c[1], c[2], 255], (y * S + x) * 4);
    }
  }
  return d;
}
// фигура с плечами, обрезанная нижним краем кадра: внизу обводки нет, на краю — кожа и тёмная одежда (небелые пиксели тела)
function bust({ bg, outline = true }) {
  const d = new Uint8ClampedArray(S * S * 4);
  const inFig = (x, y, g) => Math.hypot((x - 256) / (130 + g), (y - 200) / (160 + g)) <= 1 || (x >= 120 - g && x <= 392 + g && y >= 330 - g);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let c;
      if (inFig(x, y, 0)) c = y > 400 ? ((x >> 4) % 2 ? [40, 45, 60] : [200, 150, 120]) : [196, 140, 110];
      else if (outline && inFig(x, y, 10)) c = [255, 255, 255];
      else c = bg(x, y);
      d.set([c[0], c[1], c[2], 255], (y * S + x) * 4);
    }
  }
  return d;
}
const noise = (x, y) => ((x * 7919 + y * 104729) % 41) - 20; // детерминированный «текстурный» шум ±20
const green = () => [0, 255, 0];
const grayFlat = () => [128, 128, 128];
const grayTex = (x, y) => { const v = 120 + noise(x, y) + ((x >> 5) + (y >> 5)) % 2 * 20; return [v, v, v]; };
const white = () => [255, 255, 255];

const cases = [
  ["зелёный фон", scene({ bg: green }), "ok"],
  ["серый фон", scene({ bg: grayFlat }), "ok"],
  ["серый текстурный фон", scene({ bg: grayTex }), "ok"],
  ["дырка в обводке модели (не мешает)", scene({ bg: green, hole: true }), "ok"],
  ["лицо цвета фона (съедено)", scene({ bg: green, skin: [8, 250, 8] }), "leak"],
  ["белый фон", scene({ bg: white }), "nobg"],
  ["обводка касается края", scene({ bg: grayTex, cx: 256, rx: 246, ry: 190 }), "ok"],
  ["обводка в углу (фон в кармане)", scene({ bg: green, cx: 256, cy: 256, rx: 246, ry: 246 }), "ok"],
  ["плечи обрезаны краем, зелёный", bust({ bg: green }), "ok"],
  ["плечи обрезаны краем, серый текстурный", bust({ bg: grayTex }), "ok"],
  ["нет обводки совсем (брак модели)", bust({ bg: green, outline: false }), "ok"],
  ["нет обводки совсем, серый текстурный", bust({ bg: grayTex, outline: false }), "ok"],
];

console.log("случай".padEnd(34), "убрано  лицо-протечка  вердикт");
for (const [name, data, want] of cases) {
  const r = fillCut(data);
  console.log(name.padEnd(34), (r.removed * 100).toFixed(1).padStart(5) + "%", (r.leak * 100).toFixed(1).padStart(9) + "%      ", r.verdict);
  assert.equal(r.verdict, want, name);
  if (want !== "ok") continue;
  const px = (x, y) => [...data.slice((y * S + x) * 4, (y * S + x) * 4 + 4)];
  assert.equal(px(2, 2)[3], 0, name + ": фон прозрачен");
  assert.equal(px(256, 256)[3], 255, name + ": фигура непрозрачна");
  assert.deepEqual(px(256, 256).slice(0, 3).length, 3);
  // у границы нет цветной каймы: всё, что осталось видимым вне фигуры, — белое
  let fringe = 0;
  for (let i = 0; i < S * S; i++) {
    const [r, g, b, a] = data.slice(i * 4, i * 4 + 4);
    if (a > 0 && a < 255 && (r < 250 || g < 250 || b < 250)) fringe++;
  }
  assert.equal(fringe, 0, name + ": полупрозрачные пиксели только белые");
}

// обводка снизу гарантирована: плечи обрезаны краем кадра, под срезом — белая полоса, дальше прозрачно
for (const [name, bgf, ol] of [["с обводкой модели", green, true], ["без обводки модели", grayTex, false]]) {
  const data = bust({ bg: bgf, outline: ol });
  fillCut(data);
  const at = (x, y) => [...data.slice((y * S + x) * 4, (y * S + x) * 4 + 4)];
  const band = at(256, S - 8);   // внутри полосы обводки под срезом
  assert.deepEqual(band, [255, 255, 255, 255], name + ": белая обводка снизу");
  assert.equal(at(256, S - 1)[3], 0, name + ": ниже полосы прозрачно");
  assert.equal(at(256, 200)[3], 255, name + ": фигура на месте");
  console.log(`  обводка снизу ${name}: ok`);
}

// фон «карман» между обводкой и краем кадра (угол) тоже убран, а не остался зелёным
{
  const data = scene({ bg: green, rx: 246, ry: 246 });
  fillCut(data);
  assert.equal(data[(2 * S + 2) * 4 + 3], 0, "угол кадра прозрачен");
}
console.log("OK");
