// Предпроверка лица: MediaPipe Face Detector (грузится лениво; не загрузился → null → ручной кроп).
import { LIBS } from './config.js';

let detectorPromise = null;

export function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FaceDetector, FilesetResolver } = await import(`${LIBS.mediapipe}/vision_bundle.mjs`);
      const files = await FilesetResolver.forVisionTasks(`${LIBS.mediapipe}/wasm`);
      const opts = { baseOptions: { modelAssetPath: LIBS.faceModel }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 };
      try {
        return await FaceDetector.createFromOptions(files, { ...opts, baseOptions: { ...opts.baseOptions, delegate: 'GPU' } });
      } catch {
        return await FaceDetector.createFromOptions(files, opts);
      }
    })().catch(e => { console.warn('MediaPipe не загрузился', e); return null; });
  }
  return detectorPromise;
}

// → { ok: false } если модель недоступна, иначе { ok: true, boxes: [{x,y,w,h}] }
export async function detectFaces(canvas) {
  const det = await loadDetector();
  if (!det) return { ok: false, boxes: [] };
  try {
    const res = det.detect(canvas);
    const boxes = res.detections.map(d => d.boundingBox).filter(Boolean)
      .map(b => ({ x: b.originX, y: b.originY, w: b.width, h: b.height }));
    return { ok: true, boxes };
  } catch (e) {
    console.warn('detect failed', e);
    return { ok: false, boxes: [] };
  }
}
