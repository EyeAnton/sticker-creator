# Sticker Creator

Стикерпак из одного фото прямо в браузере: модерация фото, рестайл портрета в стикер и набор эмоций с автоматической проверкой качества. Генерация идёт на [RunningHub](https://www.runninghub.ai) через Cloudflare Worker, ключ API в браузер не попадает.

Раздел портфолио: https://eyeanton.github.io/sticker-creator/

- `index.html`, `css/`, `js/` — страница (GitHub Pages, без сборки)
- `worker/` — прокси: капча Turnstile, лимиты, очередь этапов
- `SPEC.md` — контракт и пайплайн
