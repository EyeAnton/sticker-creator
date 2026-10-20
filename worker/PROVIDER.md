# Провайдер — Replicate

Ключ сюда **не писать**: `cd worker && npx wrangler secret put REPLICATE_API_TOKEN` (токен: replicate.com → Account → API tokens). В Replicate поставить лимит расходов (Billing → spend limit).

Модели — те же, что в блюпринтах Make, только через Replicate. Задача #5 проверяет актуальные названия, версии, входы и цены на replicate.com и обновляет таблицу.

| Шаг | В блюпринте (Gemini API) | На Replicate (проверить) | Вход | Выход |
|---|---|---|---|---|
| validate | gemini-2.5-pro | vision-LLM Google (gemini-2.5-pro / -flash) | фото + `prompts.validate` | текст JSON |
| restyle | gemini-3-pro-image-preview | `google/nano-banana-pro` | фото + `prompts.restyle` | картинка 1:1 |
| emotion `fast` | gemini-2.5-flash-image | `google/nano-banana` | base + промпт эмоции | картинка 1:1 |
| emotion `pro` | gemini-3-pro-image-preview | `google/nano-banana-pro` | base + промпт эмоции | картинка 1:1 |
| qa | gemini-2.5-pro, temperature 0.2 | как validate | base + результат + `prompts.qa` | текст JSON |

API: создать prediction `POST /v1/models/{owner}/{name}/predictions` (`input`), статус `GET /v1/predictions/{id}` (`starting`/`processing`/`succeeded`/`failed`/`canceled`), картинки на вход — URL или файл через Files API. Отказ модели (safety) — `failed` с текстом про policy/safety или `succeeded` без картинки → `refused: true`.
