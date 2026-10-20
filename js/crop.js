// Уменьшение фото, квадратный кроп по лицу, ручной кроп. Выход — JPEG 1024×1024 (EXIF пропадает).
export const OUT = 1024;
const MAX_SIDE = 2048;
// рамка MediaPipe уже, чем у Google Vision (только лицо без волос/плеч): сторона кропа = K × большая сторона рамки
const FACE_K = 2.1;
const FACE_DOWN = 0.12; // центр кропа ниже центра рамки (плечи)

// Файл → canvas ≤ 2048 по длинной стороне, с учётом EXIF-ориентации
export async function loadScaled(file) {
  const opt = { imageOrientation: 'from-image' };
  let bmp = await createImageBitmap(file, opt);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  if (k < 1) {
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    bmp.close?.();
    bmp = await createImageBitmap(file, { ...opt, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

// Рамка лица → квадрат {x,y,s} внутри картинки W×H
export function faceSquare(box, W, H) {
  const s = Math.min(Math.max(box.w, box.h) * FACE_K, W, H);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2 + box.h * FACE_DOWN;
  return {
    x: Math.max(0, Math.min(W - s, cx - s / 2)),
    y: Math.max(0, Math.min(H - s, cy - s / 2)),
    s,
  };
}

export function renderRect(src, r, size = OUT) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, r.x, r.y, r.s, r.s, 0, 0, size, size);
  return c;
}

export const toJpeg = canvas => new Promise((res, rej) =>
  canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9));

// Ручной кроп: квадрат на canvas, картинку тянут пальцем/мышью, масштаб — ползунком (1 = вся короткая сторона)
export class ManualCrop {
  constructor(view, canvas, zoomInput, onChange) {
    this.view = view; this.cv = canvas; this.zoomEl = zoomInput; this.onChange = onChange;
    this.src = null; this.rect = null; this.on = false; this.ptrs = new Map();
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) canvas.addEventListener(t, e => this.ptrs.delete(e.pointerId));
    canvas.addEventListener('wheel', e => { if (!this.on) return; e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); }, { passive: false });
    zoomInput.addEventListener('input', () => { if (this.on) this.setZoom(parseFloat(zoomInput.value)); });
  }
  set(src, rect) {
    this.src = src;
    this.base = Math.min(src.width, src.height);
    this.rect = { ...rect };
    this.syncZoom(); this.draw();
  }
  enable(on) { this.on = on; this.view.classList.toggle('manual', on); }
  syncZoom() { this.zoomEl.value = String(Math.min(4, Math.max(1, this.base / this.rect.s))); }
  clamp() {
    const r = this.rect, S = this.src;
    r.s = Math.max(this.base / 4, Math.min(this.base, r.s));
    r.x = Math.max(0, Math.min(S.width - r.s, r.x));
    r.y = Math.max(0, Math.min(S.height - r.s, r.y));
  }
  setZoom(z) {
    const r = this.rect, cx = r.x + r.s / 2, cy = r.y + r.s / 2;
    r.s = this.base / z; r.x = cx - r.s / 2; r.y = cy - r.s / 2;
    this.clamp(); this.draw(); this.onChange?.();
  }
  zoomBy(f) { this.setZoom(Math.min(4, Math.max(1, this.base / this.rect.s * f))); this.syncZoom(); }
  down(e) {
    if (!this.on) return;
    this.cv.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  move(e) {
    const p = this.ptrs.get(e.pointerId);
    if (!p || !this.on) return;
    if (this.ptrs.size === 1) {
      const k = this.rect.s / this.cv.getBoundingClientRect().width; // экранные px → px источника
      this.rect.x -= (e.clientX - p.x) * k; this.rect.y -= (e.clientY - p.y) * k;
      this.clamp(); this.draw(); this.onChange?.();
    } else if (this.ptrs.size === 2) { // щипок
      const [a, b] = [...this.ptrs.values()];
      const d0 = Math.hypot(a.x - b.x, a.y - b.y);
      const other = [...this.ptrs.entries()].find(([id]) => id !== e.pointerId)[1];
      const d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (d0 > 0) { this.zoomBy(d1 / d0); }
    }
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  draw() {
    const c = this.cv, ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.src, this.rect.x, this.rect.y, this.rect.s, this.rect.s, 0, 0, c.width, c.height);
  }
}
