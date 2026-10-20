# SPEC — Sticker Creator

Посетитель портфолио загружает фото и получает стикерпак: базовый стикер (рестайл портрета) + выбранные эмоции.
Это перенос сценариев Make «Social3.0-SC» (сырьё: `~/Downloads/Portfolio/Social3.0-SC-blueprints`, в git не входит). Все модели вызываются напрямую через RunningHub Standard Model API (без своих workflow); Make, GCP-бакет, data store и Google Sheets выкидываются. **Логику повторов и проверок сохраняем как в блюпринтах** (ниже — «Пайплайн»).

```
браузер (GitHub Pages)                        Worker (Cloudflare)                      RunningHub
 фото → 1 лицо? (MediaPipe) → кроп 1024 ──POST /api/jobs──▶ капча, лимиты, отклонённые ──▶ validate
 опрос каждые 4 с      ◀──GET /api/jobs/:id──  двигает этапы при опросе  ◀─────────── статусы
                                               validate ok → restyle → emotion×N (+qa)
 картинки              ◀──GET …/img/:sid──  стрим (без декодирования)
 зелёный → альфа, 512×512 PNG, «Поделиться» / ZIP
```

Кто что трогает: **Worker** — только `worker/`; **страница** — `index.html`, `css/`, `js/`, `assets/`. SPEC.md меняет пользователь или основная сессия; если контракт неудобен — напиши в описании PR, не меняй молча.

## Пайплайн (как в блюпринтах)

| Этап | Модель в оригинале | Вход | Успех | Неудача |
|---|---|---|---|---|
| **validate** (1.0) | Gemini 2.5 Pro, промпт `prompts.validate` | кроп фото | JSON `{"status":0}` | `status≠0` → пак отклонён, `failureReason` показываем пользователю, фото в «отклонённые»; ошибка запроса / нечитаемый JSON → `upstream` (не отклонённое) |
| **restyle** (2.1) | Gemini 3 Pro Image, `prompts.restyle` (`{gender}`) | кроп фото | есть картинка → стикер `base` | ошибка запроса → пауза 5 с, **один** повтор; ответ без картинки (отказ модели) → пак `failed`, фото в «отклонённые» |
| **emotion** (2.0/2.2) | см. попытки ниже, `prompts.emotions[i]` | картинка `base` | картинка + QA ok | после 4 попыток → стикер `failed`, пак продолжается |
| **qa** (2.2.1) | Gemini 2.5 Pro, temperature 0.2, `prompts.qa` | image1 = `base`, image2 = результат | JSON `{"status":0}` | `status≠0` или нечитаемый JSON → попытка неудачна |

Эмоции стартуют все сразу (параллельно), но **внутри одной эмоции попытки идут по очереди до первого успеха**, максимум 4. Попытка неудачна, если: ошибка запроса; модель не отдала картинку (отказ по политике / `finishReason ≠ STOP`); QA отклонил; ответ QA не разобрать.
Выбор модели для следующей попытки (уточнено пользователем, отличается от блюпринта, где порядок жёсткий `fast, fast, pro, pro`):
- неудача из-за **QA** → следующая попытка той же моделью;
- **отказ/ошибка генерации** → следующая попытка другой моделью (`fast` ↔ `pro`).
Первая попытка — `fast` (в оригинале gemini-2.5-flash-image), `pro` — gemini-3-pro-image. Порядок вынесен в `worker/src/pipeline.js` одной функцией `nextModel(prev, reason)`, чтобы его было легко поменять.

Пак `done`, когда каждая эмоция `done` или `failed`; в результат идут только `done` (как 2.3/2.4). `base` тоже выдаётся пользователю как стикер.

«Отклонённые фото» (1.0/2.0 «remember rejected photo»): KV `rejected:<sha256 фото>`, TTL 30 дней; повторная отправка того же файла сразу → `422 rejected` без трат.

## API Worker'а

Адрес: прод — `https://sticker-creator.<account>.workers.dev` (впишется после деплоя), локально — `http://localhost:8787` (`npx wrangler dev`). Страница выбирает адрес в `js/config.js` по `location.hostname`.

Ответы JSON (кроме `/img`), `Access-Control-Allow-Origin` — только из `ALLOWED_ORIGINS`. Ошибка: `{"error": "<код>", "message": "<по-русски для пользователя>", "retryAfter"?: сек}`.

### `GET /api/config`
```json
{ "emotions": ["wink","kiss_heart","heart_eyes","hearts_around","halo","laughing","tears","smile","demon","blush"],
  "maxEmotions": 6, "turnstileSiteKey": "…", "open": true, "leftToday": 2 }
```
`open: false` — исчерпан общий дневной лимит (страница показывает примеры вместо формы). `leftToday` — сколько паков ещё может этот IP.

### `POST /api/jobs` — multipart/form-data
| поле | что |
|---|---|
| `photo` | JPEG 1024×1024, уже обрезан по лицу, ≤ 1.5 МБ |
| `emotions` | id через запятую, 1…`maxEmotions`, только из списка, без повторов |
| `gender` | `""` / `"male"` / `"female"` |
| `turnstile` | токен Cloudflare Turnstile |

→ `201 {"jobId": "…", "stage": "validate", "stickers": [{"id":"base","state":"queued"}, {"id":"wink","state":"queued"}, …]}`
Ошибки: `400 bad_input`, `403 captcha`, `403 origin`, `413 too_large`, `422 rejected` (фото уже отклонялось), `429 limit` (+`retryAfter`), `503 closed`, `502 upstream`.

### `GET /api/jobs/:jobId`
```json
{ "jobId": "…", "stage": "validate" | "restyle" | "emotions" | "done" | "rejected" | "failed",
  "stickers": [{"id":"base","state":"done","image":"/api/jobs/<jobId>/img/base"},
               {"id":"wink","state":"running","attempt":2}, …],
  "message"?: "почему отклонено / что сломалось — по-русски" }
```
Стикер: `queued` → `running` → `done` | `failed`. `rejected` — фото не прошло validate или рестайл получил отказ (показать `message` и предложить другое фото). `failed` — сломался `base` по технической причине.

### `GET /api/jobs/:jobId/img/:stickerId`
Стримит картинку результата (URL из задачи — **не** открытый прокси). `Content-Type: image/*`, CORS, `Cache-Control: private, max-age=86400`.

## Задача (KV `JOBS`, ключ `job:<jobId>`, TTL 24 ч)
```json
{ "created": 1760000000, "gender": "", "photoHash": "…", "photoRef": "<URL загрузки в RunningHub>",
  "stage": "emotions", "validate": {"task": "…"}, "restyleRetry": 0,
  "stickers": { "base": {"task": "…", "state": "done", "url": "…"},
                "wink": {"state": "running", "attempt": 2, "model": "fast", "phase": "qa",
                         "genTask": "…", "qaTask": "…", "url": null, "lastFail": "qa"} } }
```
`jobId` = `crypto.randomUUID()` — он же доступ к задаче. Worker двигает этапы при каждом `GET` (состояние только в KV, без фоновых процессов). Опрос клиента последовательный; защита от двойного старта — проверка, что задача текущей фазы ещё не создана.

## Провайдер (RunningHub Standard Model API) — адаптер `worker/src/provider.js`, endpoint'ы в vars `RH_*` — см. `worker/PROVIDER.md`
```js
uploadImage(env, body, filename) → ref
startTask(env, kind, input) → taskId
   // kind: "validate" {image}            → результат: текст (JSON)
   //       "restyle"  {image, prompt}    → картинка
   //       "emotion"  {image, prompt, model: "fast"|"pro"} → картинка
   //       "qa"       {image1, image2}   → текст (JSON)
getTask(env, taskId) → { state: "queued"|"running"|"done"|"failed", url?, text?, refused?, error? }
```
`refused: true` — модель отработала, но картинки нет (отказ по политике) — это отличает «отказ» от «ошибки» для `nextModel`.
Реализации по `env.PROVIDER_MODE`: **`stub`** — без сети: задача готова через ~6 с (время старта зашито в taskId), validate/qa → `{"status":0}`, картинки — встроенный тестовый PNG 1024×1024 (зелёный #00FF00 фон, белый круг-«стикер»); для проверки веток — спецзначения: `gender=stub-reject` → validate отклоняет, эмоция `demon` в stub первые 2 раза получает отказ QA. **`live`** — RunningHub: upload → submit → `/query` (модели и поля — `worker/PROVIDER.md`). Таймаут задачи 10 мин, повтор только сеть/429/5xx; причина сбоя провайдера — в KV `taskerr:<taskId>`, клиенту не отдаётся.

Промпты — только на сервере: `worker/prompts.json` (не в git; `python3 -I tools/extract_prompts.py <папка блюпринтов>`), ключи `validate`, `restyle`, `emotions[]`, `qa`. Клиент промптов не видит и не передаёт.

## Лимиты и безопасность (Worker)
- Секреты (`wrangler secret put`): `RUNNINGHUB_API_KEY`, `TURNSTILE_SECRET`, `IP_SALT`. Никогда не попадают в ответы и логи.
- Vars (`wrangler.toml`): `PROVIDER_MODE`, `RH_API_BASE_URL`, `RH_VALIDATE`, `RH_RESTYLE`, `RH_EMOTION_FAST`, `RH_EMOTION_PRO`, `RH_QA`, `RH_RESOLUTION`, `RH_IMG_HOSTS` (необяз.), `ALLOWED_ORIGINS="https://eyeanton.github.io,http://localhost:8000"`, `MAX_EMOTIONS=6`, `PER_IP_DAY=2`, `GLOBAL_DAY=30`, `RUNS_DAY=400`, `TURNSTILE_SITE_KEY`.
- `RUNS_DAY` — жёсткий потолок вызовов провайдера в сутки (все виды: validate, restyle, emotion, qa), счётчик `runs:<YYYY-MM-DD>`. Достигнут → новые паки `503 closed`, у начатых паков недоделанные стикеры `failed` (без новых вызовов). Это главный предохранитель по деньгам, независимо от повторов.
- POST: `Origin` ∈ `ALLOWED_ORIGINS`, Turnstile (`siteverify`), размер ≤ 1.5 МБ, первые байты JPEG (`FF D8 FF`), emotions — белый список, проверка «отклонённых» по sha256 (`crypto.subtle.digest`).
- Счётчики в KV `JOBS`: `ip:<sha256(ip+IP_SALT)>:<YYYY-MM-DD>` и `global:<YYYY-MM-DD>`, TTL 2 дня; списываются при успешном старте. IP — из `CF-Connecting-IP`, в KV только хэш.
- Ошибки провайдера наружу не отдаём сырыми — только код и общий текст. `failureReason` validate — показываем (он для пользователя), но обрезаем до 200 символов.
- Локально: `worker/.dev.vars` (не в git) с тестовыми ключами Turnstile `1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`, `PROVIDER_MODE=stub`, `IP_SALT=dev`.
- CPU-лимит бесплатного тарифа 10 мс: картинки не декодировать и не перекодировать, только стримить.

## Страница (корень репо, без сборки)
`index.html`, `css/style.css`, `js/config.js`, `js/app.js` (экраны и опрос), `js/face.js` (MediaPipe), `js/crop.js` (кроп, ручной фолбэк), `js/chroma.js` (зелёный → альфа), `js/share.js` (Поделиться/ZIP).

Экраны:
1. **Фото** — `<input type=file accept="image/*">` (галерея или камера). Строка о приватности: «Фото отправляется в RunningHub только для генерации и не хранится».
2. **Подготовка** — сначала уменьшить фото до ≤ 2048 по длинной стороне (`createImageBitmap` с resize; лимит canvas на iOS). MediaPipe Face Detector (`@mediapipe/tasks-vision`, точная версия с jsdelivr): лиц 0 или >1 → понятное сообщение, дальше не пускать (это быстрая предпроверка, настоящая модерация — validate на сервере). Кроп как в оригинале (crop_face `square=true`, `padding=0.08`): квадрат по рамке лица с запасом, чтобы влезли волосы и плечи — рамка MediaPipe ýже, чем у Google Vision, коэффициент подобрать на нескольких фото; ограничить краями → 1024×1024 JPEG q≈0.9 (перекодирование убирает EXIF). Модель не загрузилась → ручной кроп пальцем/мышью (перетащить, масштаб). Выбор эмоций (чипы, ≤ `maxEmotions`), пол (необязательно), Turnstile, кнопка «Сделать стикеры».
3. **Генерация** — этап словами («Проверяем фото» → «Рисуем базовый стикер» → «Эмоции»), сетка карточек-заглушек, заполняются по мере готовности, общий прогресс-бар (готово N из M), у эмоции на повторной попытке — «попытка 2». `jobId` в `localStorage["sc.job"]` (с датой): при возврате на страницу опрос продолжается; `visibilitychange` → сразу опрос. `rejected` → причина + «Выбрать другое фото».
4. **Результат** — каждая картинка: зелёный (#00FF00) → прозрачность с подавлением зелёной каймы (despill; у краёв бывает тёмно-зелёная тень — тоже убрать), белая обводка сохраняется, 512×512 PNG. На телефоне «Поделиться» (`navigator.share({files})` → Фото / Telegram), на компьютере «Скачать всё» (ZIP, JSZip точной версии) и по одной. Во встроенных браузерах (Telegram, Instagram — по user agent) подсказка «Откройте в браузере».
- Нет `createImageBitmap`/`fetch`/`Promise.allSettled` → «Обновите браузер».
- Стиль — дизайн-система портфолио «Lighthouse»: `<link rel="stylesheet" href="https://eyeanton.github.io/design-system.css">`, тёмная, mobile-first, отступы 16px, без горизонтального скролла. Нельзя: звёздочки ✦, сетка на фоне, грязные размытые градиенты.
- Тексты по-русски (EN — позже).
