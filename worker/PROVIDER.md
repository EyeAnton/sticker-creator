# Провайдеры — Replicate проверяет, RunningHub рисует

Ключи сюда **не писать**. Локально — `worker/.dev.vars`, в проде — `npx wrangler secret put REPLICATE_API_TOKEN` и `npx wrangler secret put RUNNINGHUB_API_KEY`. В обоих аккаунтах поставить лимит расходов.

## Маршруты
Var `ROUTES` в `wrangler.toml` — какой этап куда идёт; у любого этапа можно поставить `stub` (проверка по частям):
```
ROUTES = "validate=replicate,qa=replicate,restyle=runninghub,emotion=runninghub"
```
`PROVIDER_MODE=stub` по-прежнему переводит всё в stub (локальная разработка, smoke.sh).

| Этап | Провайдер | В блюпринте (Gemini API) | Модель / workflow | Вход | Выход |
|---|---|---|---|---|---|
| validate | Replicate | gemini-2.5-pro | vision-LLM Google на Replicate (gemini-2.5-pro / -flash — проверить) | фото + `prompts.validate` | текст JSON |
| qa | Replicate | gemini-2.5-pro, temperature 0.2 | та же | base + результат + `prompts.qa` | текст JSON |
| restyle | RunningHub | gemini-3-pro-image-preview | workflow из `worker/rh/restyle.json` | фото + `prompts.restyle` | картинка 1:1 |
| emotion `fast` | RunningHub | gemini-2.5-flash-image | workflow из `worker/rh/emotion_fast.json` | base + промпт эмоции | картинка 1:1 |
| emotion `pro` | RunningHub | gemini-3-pro-image-preview | workflow из `worker/rh/emotion_pro.json` (или тот же с переключателем) | base + промпт эмоции | картинка 1:1 |

Данные RunningHub (заполняет пользователь): JSON workflow (API-формат) в `worker/rh/`, плюс в `worker/rh/README.md` — workflowId/webappId, nodeId+fieldName для картинки и промпта, узел результата, домен API (`www.runninghub.ai` или `.cn`).

## Как устроено в `worker/src/provider.js`
- Один интерфейс (`uploadImage/startTask/getTask/fetchImage`), внутри — роутер по `kind` → `replicate` | `runninghub` | `stub`.
- `uploadImage`: тело читается один раз в ArrayBuffer (без декодирования) и загружается туда, где оно нужно (Replicate Files API и/или upload RunningHub). Возвращает составную ссылку `{"replicate": "<url>", "runninghub": "<fileName>"}` строкой JSON; каждый провайдер берёт свою часть.
- Картинка между провайдерами (base с RunningHub → QA и emotion): по URL, если он открывается без ключа; иначе перекладывать стримом (fetch → upload), без декодирования.
- `taskId` с префиксом провайдера: `rep:<id>`, `rh:<id>`, `stub.…` — `getTask` знает, кого спрашивать.
- `fetchImage` — только хосты результатов этих провайдеров (белый список), иначе ошибка: `/img` не открытый прокси.
- Отказ модели: Replicate — `failed` с текстом про safety/policy или `succeeded` без результата; RunningHub — ошибка узла модели или пустой выход → `refused: true`. Прочие сбои — `error`.
