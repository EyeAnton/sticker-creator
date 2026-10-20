// Зелёный фон (#00FF00) → альфа с подавлением зелёной каймы; результат 512×512 PNG.
export const STICKER = 512;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Работает на месте с ImageData. «Зелёность» k = (g - max(r,b)) / g: растёт и у чистого фона, и у тёмно-зелёной тени
// (там абсолютная разница мала, а доля большая). Почти чёрные пиксели (g ≤ 24) — обводка/глаза, не трогаем.
export function keyGreen(data) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const m = r > b ? r : b;
    if (g <= 24 || g <= m) continue;
    const k = (g - m) / g;
    const a = 1 - smooth(0.3, 0.72, k);
    if (a <= 0.02) { data[i + 3] = 0; continue; }
    if (a < 1) {
      // край смешан с фоном (0,255,0): вычитаем вклад фона
      const bg = (1 - a) * 255;
      data[i + 1] = Math.max(0, Math.min(255, (g - bg) / a));
      data[i] = Math.min(255, r / a); data[i + 2] = Math.min(255, b / a);
      data[i + 3] = Math.round(a * data[i + 3]);
    }
    // despill: зелёный не выше среднего красного и синего
    const g2 = data[i + 1], lim = (data[i] + data[i + 2]) / 2;
    if (g2 > lim) data[i + 1] = lim;
  }
}

// Картинка (blob) → PNG-blob 512×512 с прозрачным фоном
export async function toSticker(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = STICKER;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, STICKER, STICKER);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, STICKER, STICKER);
  keyGreen(img.data);
  ctx.putImageData(img, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}
