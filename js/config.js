// Настройки страницы и подделка API для режима ?mock (без Worker'а).
const q = new URLSearchParams(location.search);

// ?mock — всё нормально; ?mock=reject — validate отклоняет фото
export const MOCK = q.has('mock');
export const MOCK_MODE = q.get('mock') || '';
export const FORCE_INAPP = q.has('inapp');

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_BASE = local
  ? 'http://localhost:8787'
  : 'https://sticker-creator.leritosha.workers.dev';

export const LIBS = {
  mediapipe: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14',
  // файл модели детектора лиц (данные, не код) — у MediaPipe он лежит только в их хранилище
  faceModel: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
  jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
};

export const POLL_MS = 4000;
export const JOB_KEY = 'sc.job';
export const DEVICE_KEY = 'sc.device';
export const JOB_TTL_MS = 24 * 3600 * 1000;

/* ---------------- подделка API по контракту SPEC ---------------- */
const EMOTIONS = ['wink', 'kiss_heart', 'heart_eyes', 'hearts_around', 'halo', 'laughing', 'tears', 'smile', 'demon', 'blush'];
const MOCK_STORE = 'sc.mock.jobs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => { try { return JSON.parse(localStorage.getItem(MOCK_STORE)) || {}; } catch { return {}; } };
const save = o => { try { localStorage.setItem(MOCK_STORE, JSON.stringify(o)); } catch {} };

// Время (с от старта): validate 0–3, restyle 3–7, эмоции с 7 (по 6 с, старт со сдвигом 1.5 с на каждую).
// Вторая эмоция идёт «попыткой 2», demon падает (failed).
function mockJob(id, j) {
  const t = (Date.now() - j.t0) / 1000;
  const stickers = [{ id: 'base', state: 'queued' }, ...j.emotions.map(e => ({ id: e, state: 'queued' }))];
  const img = sid => `assets/mock.png?s=${sid}`;
  let stage = 'validate';
  if (t >= 3) {
    if (j.mode === 'reject') return { jobId: id, stage: 'rejected', stickers, message: 'На фото плохо видно лицо: оно закрыто или слишком маленькое. Попробуйте другое фото.' };
    stage = 'restyle'; stickers[0].state = 'running';
  }
  if (t >= 7) { stage = 'emotions'; stickers[0] = { id: 'base', state: 'done', image: img('base') }; }
  if (t >= 7) {
    j.emotions.forEach((e, i) => {
      const s = stickers[i + 1], start = 7 + i * 1.5, end = start + 6;
      if (t < start) { s.state = 'queued'; return; }
      if (t < end) { s.state = 'running'; s.attempt = (i === 1 && t > start + 3) || e === 'demon' ? 2 : 1; return; }
      if (e === 'demon') { s.state = 'failed'; return; }
      s.state = 'done'; s.image = img(e);
    });
    if (stickers.every(s => s.state === 'done' || s.state === 'failed')) stage = 'done';
  }
  return { jobId: id, stage, stickers };
}

export async function mockFetch(path, opts = {}) {
  await sleep(150);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (path.split('?')[0] === '/api/config') {
    return json(200, { emotions: EMOTIONS, maxEmotions: 10, turnstileSiteKey: 'mock', open: true, canCreate: true });
  }
  if (path === '/api/jobs' && opts.method === 'POST') {
    const f = opts.body;
    const emotions = String(f.get('emotions') || '').split(',').filter(Boolean);
    const id = 'mock-' + Math.random().toString(36).slice(2, 10);
    const jobs = load(); jobs[id] = { t0: Date.now(), emotions, mode: MOCK_MODE }; save(jobs);
    return json(201, { jobId: id, stage: 'validate', stickers: [{ id: 'base', state: 'queued' }, ...emotions.map(e => ({ id: e, state: 'queued' }))] });
  }
  const m = path.match(/^\/api\/jobs\/([\w-]+)$/);
  if (m) {
    const j = load()[m[1]];
    return j ? json(200, mockJob(m[1], j)) : json(404, { error: 'not_found', message: 'Задача не найдена или устарела.' });
  }
  return json(404, { error: 'not_found', message: 'Нет такого метода.' });
}
