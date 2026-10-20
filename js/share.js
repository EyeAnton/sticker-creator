// «Поделиться», ZIP, скачивание, определение встроенных браузеров.
import { LIBS, FORCE_INAPP } from './config.js';

export const isInApp = () => FORCE_INAPP ||
  /Telegram|Instagram|FBAN|FBAV|FB_IAB|Line\/|VKClient|MicroMessenger|; wv\)|Snapchat|TikTok|Twitter/i.test(navigator.userAgent);

export const asFiles = items => items.map(s => new File([s.blob], `${s.id}.png`, { type: 'image/png' }));

export function canShareFiles(files) {
  try { return !!navigator.canShare && navigator.canShare({ files }); } catch { return false; }
}

// → 'shared' | 'cancel'; бросает при реальной ошибке
export async function shareFiles(files) {
  try { await navigator.share({ files, title: 'Мои стикеры' }); return 'shared'; }
  catch (e) { if (e.name === 'AbortError') return 'cancel'; throw e; }
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

let zipLib = null;
function loadJSZip() {
  zipLib ||= new Promise((res, rej) => {
    if (window.JSZip) return res(window.JSZip);
    const s = document.createElement('script');
    s.src = LIBS.jszip; s.onload = () => res(window.JSZip); s.onerror = () => { zipLib = null; rej(new Error('JSZip')); };
    document.head.append(s);
  });
  return zipLib;
}

export async function zipAll(items) {
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  for (const s of items) zip.file(`${s.id}.png`, s.blob);
  return zip.generateAsync({ type: 'blob' });
}
