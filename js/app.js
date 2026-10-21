import { MOCK, API_BASE, LIBS, POLL_MS, JOB_KEY, JOB_TTL_MS, DEVICE_KEY, mockFetch } from './config.js';
import { detectFaces, loadDetector } from './face.js';
import { loadScaled, faceSquare, renderRect, toJpeg, ManualCrop, OUT } from './crop.js';
import { toSticker } from './chroma.js';
import { isInApp, asFiles, canShareFiles, shareFiles, download, zipAll } from './share.js';

const $ = id => document.getElementById(id);
const LABELS = { base: 'Базовый', wink: 'Подмигивание', kiss_heart: 'Поцелуй', heart_eyes: 'Влюблённый', hearts_around: 'Сердечки', halo: 'Ангел', laughing: 'Смех', tears: 'Слёзы', smile: 'Улыбка', demon: 'Чертёнок', blush: 'Смущение' };
const label = id => LABELS[id] || id;
const STAGES = { validate: 'Проверяем фото', restyle: 'Рисуем базовый стикер', emotions: 'Рисуем эмоции', done: 'Готово' };

const st = { memDevice: '', cfg: null, cfgErr: null, src: null, autoRect: null, emotions: new Set(), gender: '', token: '', turnstileId: null, job: null, timer: null, polling: false, fails: 0, results: [], urls: [], crop: null, proc: {}, redraw: new Set() };

/* ---------- API ---------- */
const imgUrl = p => (MOCK || /^assets\//.test(p) ? p : API_BASE + p);
// картинка эмоции после перерисовки лежит по тому же адресу — номер попытки сбивает кэш браузера
const stickerUrl = s => { const u = imgUrl(s.image); return u + (u.includes('?') ? '&' : '?') + 'v=' + (s.attempt || 0); };
async function api(path, opts) {
  const res = await (MOCK ? mockFetch(path, opts) : fetch(API_BASE + path, opts));
  let body = null;
  try { body = await res.json(); } catch { /* не JSON */ }
  if (!res.ok) {
    const e = new Error(body?.message || 'Сервис временно недоступен. Попробуйте позже.');
    e.status = res.status; e.body = body; throw e;
  }
  return body;
}

/* ---------- экраны ---------- */
const SCREENS = ['s-photo', 's-prep', 's-gen', 's-result'];
function show(id) {
  for (const s of SCREENS) $(s).hidden = s !== id;
  $('lead').hidden = id !== 's-photo';
  window.scrollTo(0, 0);
}
const warn = (el, text) => { el.textContent = text || ''; el.hidden = !text; };

/* ---------- старт ---------- */
if (!window.createImageBitmap || !window.fetch || !Promise.allSettled) {
  $('unsupported').hidden = false;
  for (const s of SCREENS) $(s).hidden = true;
} else init();

function init() {
  $('inapp').hidden = !isInApp();
  st.crop = new ManualCrop($('crop-view'), $('crop-canvas'), $('zoom'));
  $('file').addEventListener('change', onFile);
  $('prep-back').onclick = $('gen-again').onclick = $('again-btn').onclick = reset;
  $('manual-btn').onclick = toggleManual;
  $('go').onclick = submit;
  $('share-btn').onclick = onShare;
  $('zip-btn').onclick = onZip;
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.job && !$('s-gen').hidden) poll(); });
  for (const b of $('gender').children) b.onclick = () => {
    st.gender = b.dataset.v;
    for (const x of $('gender').children) { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }
  };
  const saved = readJob();
  if (saved) { st.job = saved; startGen(); } else show('s-photo');
  loadConfig().then(() => { if (!st.job) loadDetector(); }); // прогрев модели, пока человек выбирает фото
}

function readJob() {
  try {
    const j = JSON.parse(localStorage.getItem(JOB_KEY));
    if (j && j.jobId && Date.now() - j.t < JOB_TTL_MS) return j;
  } catch { /* пусто */ }
  return null;
}
const writeJob = j => { try { localStorage.setItem(JOB_KEY, JSON.stringify(j)); } catch { /* приватный режим */ } };
function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch { return st.memDevice || (st.memDevice = crypto.randomUUID()); } // приватный режим без хранилища
}
const clearJob = () => { try { localStorage.removeItem(JOB_KEY); } catch { /* ок */ } };
// последний пак: показывается на экране «пак уже готов» (сам sc.job очищается после результата)
const LAST_KEY = 'sc.last';
const readLast = () => { try { const j = JSON.parse(localStorage.getItem(LAST_KEY)); return j && j.jobId && Date.now() - j.t < JOB_TTL_MS ? j : null; } catch { return null; } };
const writeLast = j => { try { localStorage.setItem(LAST_KEY, JSON.stringify(j)); } catch { /* ок */ } };

async function loadConfig() {
  try { st.cfg = await api('/api/config?device=' + encodeURIComponent(deviceId())); st.cfgErr = null; } catch (e) { st.cfgErr = e; return; }
  const can = st.cfg.canCreate !== false;
  $('closed').hidden = st.cfg.open || !can;
  $('pick').hidden = !(st.cfg.open && can);
  $('blocked').hidden = can;
  if (!can) {
    const last = readLast();
    $('blocked-title').textContent = st.cfg.reason === 'busy' ? 'Пак уже делается' : 'Ваш пак уже готов';
    $('blocked-msg').textContent = last ? '' : st.cfg.reason === 'busy' ? 'Дождитесь, пока он будет готов.' : 'С этого устройства пак уже сделан.';
    $('open-last').hidden = !last;
    $('open-last').onclick = () => { st.job = last; startGen(); };
  }
}

function reset() {
  clearTimeout(st.timer); st.timer = null;
  clearJob(); st.job = null; st.src = null; st.token = MOCK ? 'mock' : '';
  for (const u of st.urls) URL.revokeObjectURL(u);
  st.urls = []; st.results = []; st.proc = {}; st.redraw = new Set();
  $('file').value = '';
  $('gen-grid').textContent = '';
  if (st.turnstileId != null) window.turnstile?.reset(st.turnstileId);
  warn($('submit-err'), '');
  $('lead').textContent = 'Загрузите портрет, выберите эмоции — через пару минут стикеры готовы для Telegram и мессенджеров.';
  show('s-photo');
  loadConfig();
}

/* ---------- 2. подготовка ---------- */
async function onFile() {
  const file = $('file').files[0];
  if (!file) return;
  show('s-prep');
  $('prep-body').hidden = true;
  setPrep('Проверяем фото…');
  try {
    if (!st.cfg) await loadConfig();
    if (!st.cfg) { setPrep(st.cfgErr?.message || 'Сервис недоступен. Попробуйте позже.', true); return; }
    if (!st.cfg.open) { reset(); return; }
    st.src = await loadScaled(file);
  } catch (e) {
    console.warn('open failed', e);
    setPrep('Не удалось открыть файл. Попробуйте другое фото (JPEG или PNG).', true); return;
  }
  const res = await detectFaces(st.src);
  if (res.ok && res.boxes.length === 0) { setPrep('Лицо не найдено. Нужен портрет, где лицо хорошо видно и не закрыто.', true); return; }
  if (res.ok && res.boxes.length > 1) { setPrep(`На фото лиц: ${res.boxes.length}. Нужен снимок, где человек один.`, true); return; }
  const W = st.src.width, H = st.src.height;
  if (res.ok) {
    st.autoRect = faceSquare(res.boxes[0], W, H);
    $('crop-hint').textContent = 'Кадр подобран по лицу. Можно подправить.';
  } else {
    const s = Math.min(W, H);
    st.autoRect = { x: (W - s) / 2, y: (H - s) / 2, s };
    $('crop-hint').textContent = 'Не удалось проверить лицо автоматически — выберите кадр сами: перетащите фото и приблизьте.';
  }
  $('manual-btn').hidden = !res.ok;
  $('manual-btn').textContent = 'Подправить кадр';
  st.crop.set(st.src, st.autoRect);
  st.crop.enable(!res.ok);
  $('zoom-row').hidden = res.ok;
  $('prep-msg').hidden = true; $('prep-back').hidden = true;
  $('prep-body').hidden = false;
  buildOptions();
  initTurnstile();
  updateGo();
}

function setPrep(text, back) {
  const m = $('prep-msg');
  m.hidden = false; m.textContent = text;
  m.classList.toggle('warn', !!back);
  $('prep-back').hidden = !back;
}

function toggleManual() {
  const on = !st.crop.on;
  st.crop.enable(on); $('zoom-row').hidden = !on;
  $('manual-btn').textContent = on ? 'Вернуть автокадр' : 'Подправить кадр';
  $('crop-hint').textContent = on ? 'Перетащите фото, масштаб — ползунком или щипком.' : 'Кадр подобран по лицу. Можно подправить.';
  if (!on) st.crop.set(st.src, st.autoRect);
}

function buildOptions() {
  const box = $('emotions'); box.textContent = '';
  const max = st.cfg.maxEmotions;
  if (!st.emotions.size) st.cfg.emotions.forEach(i => st.emotions.add(i));
  for (const id of st.cfg.emotions) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.id = id; b.textContent = label(id);
    b.onclick = () => {
      if (st.emotions.has(id)) st.emotions.delete(id); else if (st.emotions.size < max) st.emotions.add(id);
      syncChips(); updateGo();
    };
    box.append(b);
  }
  syncChips();
}
function syncChips() {
  const max = st.cfg.maxEmotions;
  for (const b of $('emotions').children) {
    const on = st.emotions.has(b.dataset.id);
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    b.disabled = !on && st.emotions.size >= max;
  }
  $('emo-count').textContent = `${st.emotions.size} из ${max}`;
}

function initTurnstile() {
  if (MOCK) { st.token = 'mock'; return; }
  const render = () => {
    if (st.turnstileId != null) { window.turnstile.reset(st.turnstileId); return; }
    st.turnstileId = window.turnstile.render('#captcha', {
      sitekey: st.cfg.turnstileSiteKey, theme: 'dark',
      callback: t => { st.token = t; updateGo(); },
      'expired-callback': () => { st.token = ''; updateGo(); },
      'error-callback': () => { st.token = ''; updateGo(); warn($('submit-err'), 'Проверка «я не робот» не прошла. Обновите страницу или откройте её в другом браузере.'); },
    });
  };
  if (typeof window.turnstile?.render === 'function') return render();
  const s = document.createElement('script');
  s.src = LIBS.turnstile; s.async = true; s.onload = render;
  s.onerror = () => warn($('submit-err'), 'Не загрузилась проверка «я не робот». Отключите блокировщик или обновите страницу.');
  document.head.append(s);
}

const updateGo = () => { $('go').disabled = !(st.emotions.size >= 1 && st.token); };

/* ---------- отправка ---------- */
async function submit() {
  warn($('submit-err'), '');
  $('go').disabled = true;
  try {
    const blob = await toJpeg(renderRect(st.src, st.crop.rect, OUT));
    const f = new FormData();
    f.append('photo', blob, 'photo.jpg');
    f.append('emotions', [...st.emotions].join(','));
    f.append('gender', st.gender);
    f.append('device', deviceId());
    f.append('turnstile', st.token);
    const r = await api('/api/jobs', { method: 'POST', body: f });
    st.job = { jobId: r.jobId, t: Date.now(), emotions: [...st.emotions] };
    writeJob(st.job); writeLast(st.job);
    startGen(r);
  } catch (e) {
    let msg = e.message;
    if (e.body?.retryAfter) msg += ` Повторите через ${Math.ceil(e.body.retryAfter / 60)} мин.`;
    // токен Turnstile одноразовый: сервер мог уже проверить его (ошибка после капчи) — нужен новый
    if (e.status) { st.token = ''; if (st.turnstileId != null) window.turnstile?.reset(st.turnstileId); }
    warn($('submit-err'), msg);
  } finally { updateGo(); }
}

/* ---------- 3. генерация ---------- */
function startGen(first) {
  show('s-gen');
  $('gen-end').hidden = true; $('gen-keep').hidden = false; warn($('net'), '');
  $('gen-grid').textContent = '';
  st.fails = 0; st.proc = {}; st.redraw = new Set();
  renderGen(first || { stage: 'validate', stickers: [{ id: 'base', state: 'queued' }, ...(st.job.emotions || []).map(id => ({ id, state: 'queued' }))] });
  poll();
}

function schedule() {
  clearTimeout(st.timer);
  st.timer = setTimeout(poll, POLL_MS);
}

async function poll() {
  if (!st.job || st.polling) return; // опрос последовательный
  clearTimeout(st.timer);
  st.polling = true;
  const id = st.job.jobId;
  try {
    let j = await api(`/api/jobs/${id}`);
    if (!st.job || st.job.jobId !== id) return;
    st.fails = 0; warn($('net'), '');
    j = await inspect(j, id);
    if (!st.job || st.job.jobId !== id) return;
    if (j.stage === 'done' && !awaitingRetry(j)) { st.polling = false; return await finish(j); }
    renderGen(j);
    if (j.stage === 'rejected' || j.stage === 'failed') return endGen(j);
    schedule();
  } catch (e) {
    if (e.status === 404) { reset(); $('lead').textContent = 'Прошлая задача устарела — загрузите фото ещё раз.'; return; }
    if (++st.fails >= 3) warn($('net'), 'Связь пропала, пробуем ещё раз…');
    schedule();
  } finally { st.polling = false; }
}

/* ---------- проверка заливки: каждый готовый стикер → заливка фона → брак эмоции уходит на перерисовку ---------- */
function stale(s) { return !st.proc[s.id] || st.proc[s.id].attempt !== (s.attempt || 0); }
function bad(id) { const p = st.proc[id]; return !p || p.failed || p.verdict !== 'ok'; }
function isDone(s) { return s.state === 'done' && s.image; }

// эмоция с браком, которую ещё не удалось отправить на перерисовку (сеть / задача занята) — пак не завершаем
function awaitingRetry(j) { return j.stickers.some(s => isDone(s) && s.id !== 'base' && !stale(s) && st.proc[s.id].verdict && st.proc[s.id].verdict !== 'ok' && !st.proc[s.id].retried && !st.proc[s.id].giveUp); }

async function inspect(j, jobId) {
  for (const s of j.stickers) {
    if (!isDone(s) || !stale(s)) continue;
    const attempt = s.attempt || 0;
    let p;
    try {
      const r = await fetch(stickerUrl(s));
      if (!r.ok) throw new Error('img');
      p = { attempt, ...await toSticker(await r.blob()) };
    } catch { p = { attempt, failed: true }; }
    st.proc[s.id] = p;
    st.redraw.delete(s.id);
    if (!st.job || st.job.jobId !== jobId) return j;
  }
  for (const s of j.stickers) {
    const p = st.proc[s.id];
    if (!isDone(s) || s.id === 'base' || !p || stale(s) || !p.verdict || p.verdict === 'ok' || p.retried || p.giveUp) continue;
    try {
      j = await api(`/api/jobs/${jobId}/retry/${s.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: p.verdict }) });
      p.retried = true; st.redraw.add(s.id);
    } catch (e) {
      // 409 (задача занята) и сеть — повторим на следующем опросе; остальное (400/404/…) — перерисовки не будет
      p.tries = (p.tries || 0) + 1;
      if ((e.status && e.status !== 409) || p.tries >= 3) p.giveUp = true;
    }
    if (!st.job || st.job.jobId !== jobId) return j;
  }
  return j;
}

function renderGen(j) {
  const list = j.stickers || [];
  $('stage').textContent = STAGES[j.stage] || 'Работаем…';
  const done = list.filter(s => s.state === 'done' || s.state === 'failed').length;
  const pct = list.length ? Math.round(done / list.length * 100) : 0;
  $('bar').setAttribute('aria-valuenow', String(pct)); $('bar-fill').style.width = pct + '%';
  $('bar-text').textContent = `Готово ${done} из ${list.length}`;
  const grid = $('gen-grid');
  for (const s of list) {
    let c = grid.querySelector(`[data-id="${s.id}"]`);
    if (!c) {
      c = document.createElement('div'); c.dataset.id = s.id;
      c.innerHTML = '<div class="pic"></div><div class="cap"><span></span><small></small></div>';
      c.querySelector('span').textContent = label(s.id);
      grid.append(c);
    }
    c.className = `card ${s.state}`;
    const pic = c.querySelector('.pic');
    const redraw = st.redraw.has(s.id), p = st.proc[s.id];
    c.querySelector('small').textContent = redraw ? 'перерисовываем' : s.state === 'running' && s.attempt > 1 ? `попытка ${s.attempt}` : s.id === 'base' && isDone(s) && p && bad('base') ? 'не войдёт в пак' : '';
    if (isDone(s)) {
      const im0 = pic.querySelector('img');
      if (!im0 || im0.dataset.v !== String(s.attempt || 0)) {
        pic.textContent = ''; const im = new Image(); im.alt = label(s.id); im.dataset.v = String(s.attempt || 0); im.src = stickerUrl(s); pic.append(im);
      }
    } else {
      pic.textContent = redraw && s.state === 'running' ? 'Перерисовываем…' : { queued: 'В очереди', running: 'Рисуем…', failed: 'Не получилось' }[s.state] || '';
    }
  }
}

function endGen(j) {
  const rejected = j.stage === 'rejected';
  $('gen-end').hidden = false; $('gen-keep').hidden = true;
  $('gen-end-msg').textContent = j.message || (rejected ? 'Это фото не подошло. Попробуйте другое.' : 'Что-то пошло не так. Попробуйте ещё раз.');
  $('gen-again').textContent = rejected ? 'Выбрать другое фото' : 'Попробовать снова';
  $('stage').textContent = rejected ? 'Фото не подошло' : 'Не получилось';
  clearJob();
  try { localStorage.removeItem(LAST_KEY); } catch { /* ок */ }
}

/* ---------- 4. результат ---------- */
async function finish(j) {
  renderGen(j);
  $('stage').textContent = 'Готовим прозрачные PNG…';
  // в пак — только стикеры, у которых заливка прошла проверку; базовый с браком просто не включается
  st.results = j.stickers.filter(s => isDone(s) && !stale(s) && !bad(s.id)).map(s => ({ id: s.id, blob: st.proc[s.id].blob }));
  if (!st.results.length) {
    endGen({ stage: 'failed', message: 'Не удалось получить чистые картинки. Попробуйте сделать стикеры заново.' });
    return;
  }
  showResult(j.stickers.length - st.results.length, j.stickers.some(s => s.id === 'base' && isDone(s) && bad('base')));
}

function showResult(lost, baseOut) {
  show('s-result');
  clearJob();
  for (const u of st.urls) URL.revokeObjectURL(u);
  st.urls = [];
  const grid = $('res-grid'); grid.textContent = '';
  for (const s of st.results) {
    const url = URL.createObjectURL(s.blob); st.urls.push(url);
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = '<div class="pic"><img alt=""></div><div class="cap"><span></span><a download>Скачать</a></div>';
    const im = c.querySelector('img'); im.src = url; im.alt = label(s.id);
    c.querySelector('span').textContent = label(s.id);
    const a = c.querySelector('a'); a.href = url; a.download = `${s.id}.png`;
    grid.append(c);
  }
  const note = $('res-note');
  note.hidden = !lost;
  note.textContent = lost ? `Не получилось: ${lost}. Остальные готовы.${baseOut ? ' Базовый стикер в пак не вошёл: фон на нём не удалось убрать чисто.' : ''}` : '';
  $('inapp').hidden = !isInApp();
  const canShare = canShareFiles(asFiles(st.results));
  $('share-btn').hidden = !canShare;
  $('zip-btn').hidden = false;
  warn($('res-err'), '');
}

async function onShare() {
  try { await shareFiles(asFiles(st.results)); }
  catch { warn($('res-err'), 'Не получилось открыть «Поделиться». Скачайте стикеры по одному или ZIP-архивом.'); }
}
async function onZip() {
  try { download(await zipAll(st.results), 'stickers.zip'); warn($('res-err'), ''); }
  catch { warn($('res-err'), 'Не удалось собрать архив. Скачайте стикеры по одному.'); }
}
