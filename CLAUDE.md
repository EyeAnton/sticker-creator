# sticker-creator — карта проекта

Генератор стикерпака по фото для портфолио: https://eyeanton.github.io/sticker-creator/ (GitHub Pages с `main`) + Cloudflare Worker-прокси к RunningHub Standard Model API.
**Контракт, пайплайн, лимиты — в `SPEC.md`. Читай его, а не блюпринты.** Блюпринты Make лежат вне репо (`~/Downloads/Portfolio/Social3.0-SC-blueprints`) и нужны только `tools/extract_prompts.py`.

## Где что
| Что | Где |
|---|---|
| Страница (без сборки) | `index.html`, `css/style.css`, `js/*.js` |
| Адрес Worker'а для страницы | `js/config.js` |
| Worker: роуты, лимиты, капча | `worker/src/index.js` |
| Этапы и повторы (validate → restyle → emotion + qa, `nextModel`) | `worker/src/pipeline.js` |
| Атомарные счётчики runs/global, блокировки задачи и IP (Durable Object `Gate`) | `worker/src/gate.js` |
| Провайдер RunningHub (stub / live), endpoint'ы — vars `RH_*` в `wrangler.toml` | `worker/src/provider.js`, модели — `worker/PROVIDER.md` |
| Промпты | `worker/prompts.json` — **не в git** (репо публичный), делается `python3 -I tools/extract_prompts.py <папка блюпринтов>` |
| Вырезка фона, белая обводка, проверка брака (браузер) | `js/chroma.js`; юнит-тест `node tools/chroma.test.mjs` |
| Секреты локально | `worker/.dev.vars` — не в git |

## Запуск локально
- Worker: `cd worker && npx wrangler dev` → http://localhost:8787 (`PROVIDER_MODE=stub`, тестовые ключи Turnstile).
- Страница: `python3 -m http.server 8000` в корне → http://localhost:8000.

## Правила
- Ключи только в `wrangler secret`, никогда в коде, ответах и логах.
- В Worker'е не декодировать картинки (CPU 10 мс) — только стрим.
- Работа: ветка → PR → слить самому (`gh pr merge --squash`).
- Отвечать пользователю по-русски, коротко.
