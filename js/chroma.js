// Вырезка стикера: фон → прозрачность, вокруг фигуры — наша белая обводка (как у наклейки на белом), по всему контуру, включая низ.
// Обводка рисуется здесь, а не берётся из модели: модель её иногда не рисует вовсе, а у фигуры, обрезанной краем кадра (плечи), внизу её нет.
// Работа в 512×512.
export const STICKER = 512;

const WMIN = 200, WSAT = 40;        // «белое»: min(r,g,b) ≥ 200 и max−min ≤ 40
const OUTLINE = 10;                 // ширина белой обводки, px
const PAD = OUTLINE + 3;            // поля при вписывании кадра: под обрезанным низом остаётся место для обводки
const ERODE = 2;                    // срезаем кайму на границе фигуры (смесь с фоном, тёмно-зелёная тень)
const STRIP = 12;                   // белое у границы фона (обводка модели) срезаем и рисуем свою — одинаковой ширины везде
const HOLE_MIN = 200;               // замкнутый участок цвета фона не меньше этого (px) — тоже фон (внутри нимба, между рукой и телом)
const MIN_BLOB = 150;               // острова фигуры меньше этого (px) — шум фона (сердечки и нимб больше)
const SEED_MIN = 35, SEED_MAX = 70; // «похоже на фон»: расстояние в RGB от цвета фона; порог — от разброса фона
// зона лица: квадрат 20% стороны, центр (50%, 45%)
const FACE = Math.floor(STICKER * 20 / 100);
const FACE_X = (STICKER - FACE) >> 1, FACE_Y = Math.floor(STICKER * 0.45) - (FACE >> 1);
// пороги брака
const LEAK_MAX = 0.05, REMOVED_MAX = 0.85, REMOVED_MIN = 0.12;

// медиана по каналу через гистограмму (чётное число — среднее двух средних)
function median(hist, n) {
  const at = k => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > k) return v; } return 255; };
  return n % 2 ? at(n >> 1) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

function isWhite(data, i) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
  return mn >= WMIN && mx - mn <= WSAT;
}

function borderIndexes(w, h) {
  const out = [];
  for (let x = 0; x < w; x++) out.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) out.push(y * w, y * w + w - 1);
  return out;
}

// Цвет фона по краю кадра (медиана небелых пикселей) и порог «похоже на фон». null — края почти целиком белые/не фон.
export function estimateBg(data, w = STICKER, h = STICKER) {
  const cand = borderIndexes(w, h).filter(i => !isWhite(data, i));
  if (cand.length < (2 * (w + h)) * 0.2) return null;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (const i of cand) for (let c = 0; c < 3; c++) hist[c][data[i * 4 + c]]++;
  const ref = hist.map(hh => median(hh, cand.length));
  const dist = Float32Array.from(cand, i => Math.hypot(data[i * 4] - ref[0], data[i * 4 + 1] - ref[1], data[i * 4 + 2] - ref[2]));
  dist.sort();
  // фон занимает бо́льшую часть края: разброс фона — по 60-му перцентилю (ровный зелёный: малый, серая текстура: больше)
  const T = Math.min(SEED_MAX, Math.max(SEED_MIN, 2.2 * dist[Math.floor(dist.length * 0.6)]));
  return { ref, T };
}

// Вписывает кадр в центр с полями PAD, поля — цвет фона. Билинейно.
function padScale(data, w, h, ref) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([ref[0], ref[1], ref[2], 255], i * 4);
  const iw = w - 2 * PAD, ih = h - 2 * PAD;
  for (let y = 0; y < ih; y++) {
    const sy = Math.min(h - 1, (y + 0.5) * h / ih - 0.5), y0 = Math.max(0, Math.floor(sy)), y1 = Math.min(h - 1, y0 + 1), fy = Math.max(0, sy - y0);
    for (let x = 0; x < iw; x++) {
      const sx = Math.min(w - 1, (x + 0.5) * w / iw - 0.5), x0 = Math.max(0, Math.floor(sx)), x1 = Math.min(w - 1, x0 + 1), fx = Math.max(0, sx - x0);
      const o = ((y + PAD) * w + x + PAD) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[(y0 * w + x0) * 4 + c] * (1 - fx) + data[(y0 * w + x1) * 4 + c] * fx;
        const bot = data[(y1 * w + x0) * 4 + c] * (1 - fx) + data[(y1 * w + x1) * 4 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

// Расстояние до ближайшего пикселя маски (хэмфер 1 / √2), 0 на самой маске
function distFrom(mask, w, h) {
  const R2 = Math.SQRT2, d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : 1e9;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + R2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + R2);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + R2);
        if (x > 0) v = Math.min(v, d[i + w - 1] + R2);
      }
      d[i] = v;
    }
  }
  return d;
}

// Вырезка на месте: data — RGBA 512×512 (ImageData.data). Возвращает { removed, leak, verdict }.
//  1. кадр вписывается с полями (цвет фона), чтобы фигура, обрезанная краем, оказалась со всех сторон окружена фоном;
//  2. фон = заливка от края по пикселям, ПОХОЖИМ НА ЦВЕТ ФОНА (а не «до белого»): не зависит от обводки модели;
//  3. граница фигуры срезается на ERODE px (кайма), белое у границы на STRIP px (обводка модели) — вместо неё рисуется своя;
//  4. вокруг оставшейся фигуры — белое кольцо OUTLINE px с мягким краем: замкнутое, по всему контуру, включая низ.
export function cutSticker(data, w = STICKER, h = STICKER) {
  const n = w * h;
  const bgc = estimateBg(data, w, h);
  if (!bgc) return { removed: 0, leak: 0, verdict: 'nobg' }; // края белые/нет фона — резать нечего
  const px = padScale(data, w, h, bgc.ref);
  const { ref, T } = bgc;
  const white = new Uint8Array(n), like = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    white[i] = isWhite(px, i) ? 1 : 0;
    like[i] = !white[i] && Math.hypot(px[i * 4] - ref[0], px[i * 4 + 1] - ref[1], px[i * 4 + 2] - ref[2]) <= T ? 1 : 0;
  }

  // фон: заливка (4-соседство) от краёв по «похожим на фон»
  const bg = new Uint8Array(n), q = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = i => { if (like[i] && !bg[i]) { bg[i] = 1; q[qt++] = i; } };
  for (const i of borderIndexes(w, h)) seed(i);
  while (qh < qt) {
    const i = q[qh++], x = i % w;
    if (i >= w) seed(i - w);
    if (i < n - w) seed(i + w);
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
  }

  // замкнутые участки цвета фона (дыра нимба, просвет между рукой и телом): заливка до них не доходит
  const hole = new Uint8Array(n);
  for (let s0 = 0; s0 < n; s0++) {
    if (!like[s0] || bg[s0] || hole[s0]) continue;
    let a = 0, b = 0;
    q[b++] = s0; hole[s0] = 1;
    while (a < b) {
      const i = q[a++], x = i % w;
      for (const j of [i >= w ? i - w : -1, i < n - w ? i + w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && like[j] && !bg[j] && !hole[j]) { hole[j] = 1; q[b++] = j; }
      }
    }
    if (b >= HOLE_MIN) for (let k = 0; k < b; k++) bg[q[k]] = 1;
    else for (let k = 0; k < b; k++) hole[q[k]] = 2; // мелкое — оставляем фигурой; 2 — чтобы не обходить заново
  }

  // срез каймы и белой обводки модели
  const dBg = distFrom(bg, w, h);
  const bg1 = new Uint8Array(n);
  for (let i = 0; i < n; i++) bg1[i] = dBg[i] <= ERODE ? 1 : 0;
  const dBg1 = distFrom(bg1, w, h);
  const gone = new Uint8Array(n);
  for (let i = 0; i < n; i++) gone[i] = bg1[i] || (white[i] && dBg1[i] <= STRIP) ? 1 : 0;

  // мелкие острова фигуры — шум фона
  const seen = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (gone[s] || seen[s]) continue;
    let a = 0, b = 0;
    q[b++] = s; seen[s] = 1;
    while (a < b) {
      const i = q[a++], x = i % w;
      for (const j of [i >= w ? i - w : -1, i < n - w ? i + w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && !gone[j] && !seen[j]) { seen[j] = 1; q[b++] = j; }
      }
    }
    if (b < MIN_BLOB) for (let k = 0; k < b; k++) gone[q[k]] = 1;
  }

  // белое кольцо вокруг фигуры
  const fig = new Uint8Array(n);
  for (let i = 0; i < n; i++) fig[i] = gone[i] ? 0 : 1;
  const dFig = distFrom(fig, w, h);
  let removed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (fig[i]) { data[o] = px[o]; data[o + 1] = px[o + 1]; data[o + 2] = px[o + 2]; data[o + 3] = 255; continue; }
    const a = Math.min(1, Math.max(0, OUTLINE + 0.5 - dFig[i]));
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = Math.round(a * 255);
    if (a < 0.5) removed++;
  }

  let leaked = 0;
  for (let y = FACE_Y; y < FACE_Y + FACE; y++) for (let x = FACE_X; x < FACE_X + FACE; x++) leaked += gone[y * w + x];
  const stats = { removed: removed / n, leak: leaked / (FACE * FACE) };
  return { ...stats, verdict: verdict(stats) };
}

// "leak" — вырезка съела лицо или почти всё; "nobg" — фон не найден; "ok"
export function verdict({ removed, leak }) {
  if (leak > LEAK_MAX || removed > REMOVED_MAX) return 'leak';
  if (removed < REMOVED_MIN) return 'nobg';
  return 'ok';
}

// Картинка (blob) → { blob: PNG 512×512 с прозрачным фоном и белой обводкой, removed, leak, verdict }
export async function toSticker(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = STICKER;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, STICKER, STICKER);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, STICKER, STICKER);
  const res = cutSticker(img.data);
  ctx.putImageData(img, 0, 0);
  const png = await new Promise((ok, rej) => c.toBlob(b => (b ? ok(b) : rej(new Error('toBlob'))), 'image/png'));
  return { blob: png, ...res };
}
