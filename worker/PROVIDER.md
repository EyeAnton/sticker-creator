# Провайдер — RunningHub Standard Model API

Контракт: [developer-kit](https://github.com/HM-RunningHub/ComfyUI_RH_OpenAPI/tree/main/developer-kit) (`llms.txt`, `rh-api-contract.md`); поля и enum'ы — только из `model-registry.public.json`. Ключ сюда **не писать**: локально `worker/.dev.vars` (`RUNNINGHUB_API_KEY`, `RH_API_BASE_URL`), в проде `npx wrangler secret put RUNNINGHUB_API_KEY`; в аккаунте RunningHub поставить лимит расходов.

Endpoint'ы и resolution — vars в `wrangler.toml` (канал «低价渠道版» меняется одной строкой). `PROVIDER_MODE=stub` переводит всё в stub (локальная разработка, `smoke.sh`).

| Этап | Var | Endpoint | Поля | Цена, ¥/запуск (ориентир) |
|---|---|---|---|---|
| validate | `RH_VALIDATE` | `rhart-text-g-25-pro/image-to-text` | `prompt` = `prompts.validate`, `imageUrl` (строка) | 0.02 |
| restyle | `RH_RESTYLE` | `rhart-image-n-pro/edit` | `imageUrls` [фото], `prompt`, `resolution` (`RH_RESOLUTION`, 1k), `aspectRatio` 1:1 | 0.40 (1k) |
| emotion fast | `RH_EMOTION_FAST` | `rhart-image-n-g31-flash/image-to-image` | `imageUrls` [base], `prompt`, `resolution`, `aspectRatio` 1:1 | 0.19 (1k) |
| emotion pro | `RH_EMOTION_PRO` | `rhart-image-n-pro/edit` | как restyle | 0.40 (1k) |
| qa | `RH_QA` | `rhart-text-qwen-27b/chat` | `prompt` = `prompts.qa` + задание, `imageUrls` [base, результат] | 0.10 |

Цены из `pricing.public.json` (обновлено 2026-04-29) — **только ориентир**, не биллинг; сверять на сайте RunningHub.

## Как устроено в `worker/src/provider.js`
- Клиент: `base = RH_API_BASE_URL`, `Authorization: Bearer <RUNNINGHUB_API_KEY>`. Upload — `POST /media/upload/binary` (поле `file`, тело без декодирования) → `data.download_url`; submit — `POST /{endpoint}` → `taskId`; опрос — `POST /query`.
- Ошибки приходят с HTTP 200: `{code≠0, msg}` или `{errorCode, errorMessage, failedReason}` — проверяются оба формата.
- Повтор (до 3, backoff) только для сети, 429, 5xx; бизнес-ошибки не повторяются.
- Статусы: `CREATE`/`QUEUED`/`RUNNING` → queued/running; `SUCCESS` → done (`results[].url|outputUrl`, текст — `text|content|output`); `FAILED`/`CANCEL` → `refused`, если сообщение про policy/moderation/safety/NSFW/violation/forbidden, иначе обычная ошибка (сбой дешёвого канала не переключает модель зря). Таймаут задачи — 10 мин (время старта зашито в taskId `rh:<мс>:<taskId>`).
- Код и текст (≤300) ошибки провайдера — в KV `taskerr:<taskId>` (TTL 2 сут), клиенту не отдаются.
- `fetchImage` — только хосты `runninghub.ai`/`.cn` и поддомены (+ var `RH_IMG_HOSTS`), редиректы вручную по тому же списку; иначе `/img` стал бы открытым прокси.
- Результаты передаются в следующие этапы по URL (base → emotion и qa) без перекладки.
