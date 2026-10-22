#!/usr/bin/env python3
"""Разбор задачи по id: python3 tools/job_report.py <jobId> [--out DIR] [--no-open]

Берёт задачу из прод-KV (wrangler, нужен вход в Cloudflare), качает все картинки (фото, базовый стикер, каждая попытка
каждой эмоции) и собирает один самодостаточный report.html: исходник / заливка на шахматке / маска, вердикт заливки (считается
тем же js/chroma.js, что и на странице), ответ QA, что сообщил браузер, журнал событий. Картинки RunningHub живут недолго —
отчёт лучше собирать сразу после прогона; сам отчёт хранит их внутри.

--local — читать из локального wrangler dev (для проверки).
Нужен Node в PATH (для wrangler). Свой запуск wrangler — переменная WRANGLER, например "npx --yes wrangler@4.151.2".
"""
import base64, json, os, re, shlex, subprocess, sys, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRANGLER = shlex.split(os.environ.get("WRANGLER", "npx --yes wrangler@4.151.2"))


def kv_get(key):
    r = subprocess.run(WRANGLER + ["kv", "key", "get", key, "--binding", "JOBS", "--local" if "--local" in sys.argv else "--remote", "--text"],
                       cwd=ROOT / "worker", capture_output=True, text=True)
    if r.returncode or not r.stdout.strip():
        sys.exit(f"Не удалось прочитать {key} из KV (нет такой задачи, срок 7 дней вышел или нет входа wrangler):\n{r.stderr[-500:]}")
    return r.stdout


def fetch(url):
    if not url or not url.startswith("https://"):
        return None
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "job-report"})
        with urllib.request.urlopen(req, timeout=60) as f:
            data, ct = f.read(), f.headers.get("Content-Type", "image/png")
        return f"data:{ct};base64,{base64.b64encode(data).decode()}"
    except Exception as e:  # картинка уже удалена у провайдера и т.п.
        print("  не скачалась:", url[:80], e, file=sys.stderr)
        return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    job_id = args[0].removeprefix("job:")
    if not re.fullmatch(r"[0-9a-f-]{36}", job_id):
        sys.exit("id задачи — UUID")
    out_dir = Path(sys.argv[sys.argv.index("--out") + 1]) if "--out" in sys.argv else Path.home() / "Downloads" / "sticker-jobs" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    job = json.loads(kv_get("job:" + job_id))
    log = job.get("log") or []
    t0 = job.get("created", 0)

    # картинки: все, что упоминается в журнале + итоговые адреса + фото
    urls = {}
    def want(u):
        if u and u not in urls:
            print("качаю", u[:70])
            urls[u] = fetch(u)
        return u
    want(job.get("photoRef"))
    for e in log:
        want(e.get("url")); want(e.get("photo"))
    for s in job["stickers"].values():
        want(s.get("url"))

    data = {
        "id": job_id, "stage": job["stage"], "message": job.get("message"), "gender": job.get("gender"),
        "created": t0, "baseQaFails": job.get("baseQaFails", 0), "photo": job.get("photoRef"),
        "stickers": {k: {kk: s.get(kk) for kk in ("state", "attempt", "model", "lastFail", "url")} for k, s in job["stickers"].items()},
        "log": log, "images": urls,
    }
    chroma = (ROOT / "js" / "chroma.js").read_text().replace("export ", "")
    html = TEMPLATE.replace("/*CHROMA*/", chroma).replace("/*DATA*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    out = out_dir / "report.html"
    out.write_text(html)
    print("готово:", out)
    if "--no-open" not in sys.argv:
        subprocess.run(["open", str(out)])


TEMPLATE = r"""<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Разбор задачи</title>
<style>
body{background:#0b0e1a;color:#dde;font:13px/1.45 system-ui,sans-serif;margin:0;padding:16px;max-width:1500px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px;border-top:1px solid #223;padding-top:12px}
code,.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
.meta{color:#99a}.ok{color:#6fe39a}.bad{color:#ff7a6b}.warn{color:#f3c969}
.att{display:grid;grid-template-columns:repeat(3,210px) minmax(220px,1fr);gap:8px;align-items:start;margin:0 0 10px;padding:8px;background:#11162a;border-radius:8px}
.att canvas,.att img{width:210px;height:210px;object-fit:contain;display:block;border-radius:6px}
.ck{background:conic-gradient(#2a3556 25%,#1b2440 0 50%,#2a3556 0 75%,#1b2440 0) 0 0/16px 16px}
.cap{font-size:11px;color:#889;margin-top:2px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #223;padding:3px 6px;text-align:left;vertical-align:top}
pre{white-space:pre-wrap;margin:4px 0;background:#0b0e1a;padding:6px;border-radius:6px;max-height:160px;overflow:auto}
@media(max-width:900px){.att{grid-template-columns:1fr 1fr}}
</style>
<h1 id=h></h1><div class=meta id=m></div>
<div id=o></div>
<h2>Журнал событий</h2><table id=log></table>
<script type=module>
/*CHROMA*/
const D = /*DATA*/;
const S = STICKER, $ = id => document.getElementById(id);
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = t => new Date(t * 1000).toLocaleTimeString('ru-RU');
const rel = t => `+${t - D.created}с`;

$('h').textContent = 'Задача ' + D.id;
$('m').innerHTML = `этап <b>${D.stage}</b>${D.message ? ' — ' + esc(D.message) : ''} · пол «${esc(D.gender)}» · создана ${new Date(D.created * 1000).toLocaleString('ru-RU')} · повторов рестайла из-за QA базы: ${D.baseQaFails}`;

async function img(url) {
  const src = D.images[url];
  if (!src) return null;
  const im = new Image(); im.src = src; await im.decode(); return im;
}
// исходник + заливка на шахматке + маска; возвращает вердикт
async function card(parent, url, caption, extra) {
  const row = el('div', 'att');
  const im = await img(url);
  if (!im) { row.append(el('div', 'bad', 'картинка недоступна (уже удалена у провайдера)'), el('div'), el('div'), el('div', '', extra)); parent.append(row); return null; }
  const c = el('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  x.drawImage(im, 0, 0, S, S);
  const raw = x.getImageData(0, 0, S, S);
  const d = new ImageData(new Uint8ClampedArray(raw.data), S, S);
  const r = fillCut(d.data);
  const a = el('canvas', 'ck'); a.width = a.height = S; a.getContext('2d').putImageData(d, 0, 0);
  const m = el('canvas'); m.width = m.height = S; const mx = m.getContext('2d');
  const mk = new ImageData(new Uint8ClampedArray(raw.data), S, S);
  for (let i = 0; i < S * S; i++) if (d.data[i * 4 + 3] < 128) { mk.data[i * 4] = 255; mk.data[i * 4 + 1] *= .3; mk.data[i * 4 + 2] *= .3; }
  mx.putImageData(mk, 0, 0); mx.strokeStyle = '#0ff'; mx.lineWidth = 2; mx.strokeRect(205, 179, 102, 102);
  const col = (cv, t) => { const w = el('div'); w.append(cv, el('div', 'cap', t)); return w; };
  const o = im.cloneNode();
  const info = el('div', '', `${caption}<br>заливка (эта страница): убрано ${(r.removed * 100).toFixed(1)}%, протечка в лицо ${(r.leak * 100).toFixed(1)}% → <b class="${r.verdict === 'ok' ? 'ok' : 'bad'}">${r.verdict}</b>${extra || ''}`);
  row.append(col(o, 'исходник'), col(a, 'после заливки (шахматка = прозрачно)'), col(m, 'маска: красное = залито как фон, рамка = зона лица'), info);
  parent.append(row);
  return r;
}

const root = $('o');
// фото и базовый
{
  root.append(el('h2', '', 'Фото (кроп, ушедший в RunningHub)'));
  const im = await img(D.photo); if (im) { im.style.cssText = 'width:210px;border-radius:6px'; root.append(im); }
}
const byId = {};
for (const e of D.log) if (e.id) (byId[e.id] ||= []).push(e);
const fills = e => D.log.filter(f => f.ev === 'fill' && f.id === e.id && f.attempt === (e.attempt ?? 0));

root.append(el('h2', '', 'Базовый стикер'));
{
  const gens = D.log.filter(e => e.ev === 'restyle' && e.url);
  const qas = D.log.filter(e => e.ev === 'qa' && e.id === 'base');
  for (const [i, g] of gens.entries()) {
    const q = qas[i];
    await card(root, g.url, `генерация ${i + 1} · ${fmt(g.t)} (${rel(g.t)})`,
      q ? `<br>QA: <b class="${q.pass ? 'ok' : 'bad'}">${q.pass ? 'прошёл' : 'не прошёл'}</b><pre>${esc(q.text)}</pre>` : '<br>QA: —');
  }
  if (!gens.length && D.stickers.base.url) await card(root, D.stickers.base.url, 'итоговый базовый', '');
  const bf = D.log.filter(f => f.ev === 'fill' && f.id === 'base');
  if (bf.length) root.append(el('div', 'meta', 'Браузер сообщил: ' + bf.map(f => `${f.verdict} (убрано ${(f.removed * 100).toFixed(1)}%, лицо ${(f.leak * 100).toFixed(1)}%)`).join('; ')));
}

for (const [id, s] of Object.entries(D.stickers)) {
  if (id === 'base') continue;
  root.append(el('h2', '', `${id} — ${s.state}${s.attempt ? ', попыток ' + s.attempt : ''}${s.lastFail ? ', последний брак: ' + s.lastFail : ''}`));
  const gens = D.log.filter(e => e.ev === 'gen' && e.id === id);
  if (!gens.length) {
    root.append(el('div', 'meta', 'нет записей о генерациях (прогон до включения журнала) — показываю только итоговую картинку'));
    if (s.url) await card(root, s.url, `${id} · итоговая`, '');
  }
  for (const g of gens) {
    const qa = D.log.find(e => e.ev === 'qa' && e.id === id && e.attempt === g.attempt);
    const rt = D.log.filter(e => e.ev === 'retry' && e.id === id && e.attempt === g.attempt).map(e => e.reason);
    const fl = D.log.filter(f => f.ev === 'fill' && f.id === id && f.attempt === g.attempt);
    const at = D.log.find(e => e.ev === 'attempt' && e.id === id && e.attempt === g.attempt);
    let extra = `<br>модель: <b>${g.model}</b>${at && at.reason ? ' (причина попытки: ' + at.reason + ')' : ''}`;
    extra += g.state !== 'done' || !g.url ? `<br><span class="bad">генерация: ${g.state}${g.refused ? ', отказ модели' : ''}${g.error ? ' · ' + esc(g.error) : ''}</span>` : '';
    extra += qa ? `<br>QA сервера: <b class="${qa.pass ? 'ok' : 'bad'}">${qa.pass ? 'прошёл' : 'не прошёл'}</b><pre>${esc(qa.text)}</pre>` : '<br>QA сервера: нет (генерация не дошла)';
    extra += fl.length ? `<br>браузер: ${fl.map(f => `<b class="${f.verdict === 'ok' ? 'ok' : 'bad'}">${f.verdict}</b> (убрано ${(f.removed * 100).toFixed(1)}%, лицо ${(f.leak * 100).toFixed(1)}%)`).join('; ')}` : '<br>браузер: не сообщал';
    if (rt.length) extra += `<br>→ ушло на перерисовку: ${rt.join(', ')}`;
    await card(root, g.url, `${id} · попытка ${g.attempt} · ${fmt(g.t)} (${rel(g.t)})`, extra);
  }
}

const lt = $('log');
lt.innerHTML = '<tr><th>время</th><th>событие</th><th>данные</th></tr>';
for (const e of D.log) {
  const { t, ev, ...rest } = e;
  for (const k of ['url', 'photo']) if (rest[k]) rest[k] = rest[k].slice(0, 60) + '…';
  const tr = el('tr', '', `<td class=mono>${fmt(t)} <span class=meta>${rel(t)}</span></td><td><b>${ev}</b></td><td class=mono>${esc(JSON.stringify(rest))}</td>`);
  lt.append(tr);
}
</script></html>
"""

if __name__ == "__main__":
    main()
