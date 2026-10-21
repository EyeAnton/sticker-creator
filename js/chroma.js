// Фон → альфа заливкой от краёв до белой обводки (годится для любого фона: зелёного, серого, текстурного).
// Алгоритм перенесён 1:1 из проверенного теста (lib.py fill_cut); работа в 512×512.
export const STICKER = 512;

const WMIN = 200, WSAT = 40;  // «белое»: min(r,g,b) ≥ 200 и max−min ≤ 40
const BAND = 2;               // пояс у границы фона, px: альфа по проекции «фон → белый», цвет белый (он же despill)
const FAR = 6;                // для оценки цвета фона берём пиксели не ближе FAR px к фигуре
const EDGE0 = 0.15, EDGE1 = 0.85;
// зона лица: квадрат 20% стороны, центр (50%, 45%)
const FACE = Math.floor(STICKER * 20 / 100);
const FACE_X = (STICKER - FACE) >> 1, FACE_Y = Math.floor(STICKER * 0.45) - (FACE >> 1);
// пороги брака
const LEAK_MAX = 0.05, REMOVED_MAX = 0.85, REMOVED_MIN = 0.12;

// 4-соседняя дилатация маски (за краем картинки — пусто)
function dilate(m, w, h, n) {
  let cur = m;
  for (let k = 0; k < n; k++) {
    const nx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        nx[i] = cur[i] | (y > 0 ? cur[i - w] : 0) | (y < h - 1 ? cur[i + w] : 0) | (x > 0 ? cur[i - 1] : 0) | (x < w - 1 ? cur[i + 1] : 0);
      }
    }
    cur = nx;
  }
  return cur;
}

// медиана по каналу через гистограмму (чётное число — среднее двух средних, как np.median)
function median(hist, n) {
  const at = k => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > k) return v; } return 255; };
  return n % 2 ? at(n >> 1) : (at(n / 2 - 1) + at(n / 2)) / 2;
}

// Заливка на месте: data — RGBA 512×512 (ImageData.data). Возвращает статистику и вердикт.
// Обводка, упирающаяся в край кадра, ничем не особенна: белые пиксели края не засеиваются, а фон по обе стороны от
// касания засеивается со своих краевых пикселей; фон, целиком отрезанный обводкой от краёв, остаётся (это не фон).
export function fillCut(data, w = STICKER, h = STICKER) {
  const n = w * h;
  const white = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    white[i] = mn >= WMIN && mx - mn <= WSAT ? 1 : 0;
  }

  // BFS (4-соседство) от небелых пикселей края
  const bg = new Uint8Array(n), q = new Int32Array(n);
  let qh = 0, qt = 0;
  const seed = i => { if (!white[i] && !bg[i]) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    if (y > 0) seed(i - w);
    if (y < h - 1) seed(i + w);
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
  }

  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = bg[i] ? 0 : 1;

  if (qt > 0) {
    const fg = new Uint8Array(n);
    for (let i = 0; i < n; i++) fg[i] = bg[i] ? 0 : 1;
    const near2 = dilate(fg, w, h, BAND), near6 = dilate(near2, w, h, FAR - BAND);
    const band = new Uint8Array(n);
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let nfar = 0;
    for (let i = 0; i < n; i++) {
      band[i] = bg[i] & near2[i];
      if (bg[i] && !near6[i]) { nfar++; for (let c = 0; c < 3; c++) hist[c][data[i * 4 + c]]++; }
    }
    if (!nfar) {
      for (let i = 0; i < n; i++) if (bg[i]) { nfar++; for (let c = 0; c < 3; c++) hist[c][data[i * 4 + c]]++; }
    }
    const bgc = hist.map(hh => median(hh, nfar));
    const d = bgc.map(v => 255 - v), dd = Math.max(d[0] * d[0] + d[1] * d[1] + d[2] * d[2], 1);
    for (let i = 0; i < n; i++) {
      if (!band[i]) continue;
      const o = i * 4;
      let t = ((data[o] - bgc[0]) * d[0] + (data[o + 1] - bgc[1]) * d[1] + (data[o + 2] - bgc[2]) * d[2]) / dd;
      t = Math.min(1, Math.max(0, t));
      alpha[i] = Math.min(1, Math.max(0, (t - EDGE0) / (EDGE1 - EDGE0)));
      data[o] = data[o + 1] = data[o + 2] = 255;
    }
  }
  for (let i = 0; i < n; i++) data[i * 4 + 3] = Math.round(alpha[i] * 255);

  // статистика и проверка брака
  let removed = 0;
  for (let i = 0; i < n; i++) if (alpha[i] < 0.5) removed++;
  let leaked = 0;
  for (let y = FACE_Y; y < FACE_Y + FACE; y++) for (let x = FACE_X; x < FACE_X + FACE; x++) leaked += bg[y * w + x];
  const stats = { removed: removed / n, leak: leaked / (FACE * FACE) };
  return { ...stats, verdict: verdict(stats) };
}

// "leak" — залив прорвался внутрь фигуры или убрано почти всё; "nobg" — фон не убран; "ok"
export function verdict({ removed, leak }) {
  if (leak > LEAK_MAX || removed > REMOVED_MAX) return 'leak';
  if (removed < REMOVED_MIN) return 'nobg';
  return 'ok';
}

// Картинка (blob) → { blob: PNG 512×512 с прозрачным фоном, removed, leak, verdict }
export async function toSticker(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = STICKER;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, STICKER, STICKER);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, STICKER, STICKER);
  const res = fillCut(img.data);
  ctx.putImageData(img, 0, 0);
  const png = await new Promise((ok, rej) => c.toBlob(b => (b ? ok(b) : rej(new Error('toBlob'))), 'image/png'));
  return { blob: png, ...res };
}
