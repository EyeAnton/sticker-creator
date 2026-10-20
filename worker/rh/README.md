# RunningHub: данные workflow

`config.json` читает `src/provider.js`. Пока `workflowId`/`nodeId` = `null`, этапы restyle/emotion на RunningHub не работают (в `ROUTES` ставить `stub`).

Заполнить (положить JSON workflow в API-формате рядом — `restyle.json`, `emotion_fast.json`, `emotion_pro.json` — для справки):
- `host` — `https://www.runninghub.ai` или `https://www.runninghub.cn`.
- `stages.<restyle|emotion_fast|emotion_pro>`: `workflowId`; `image` — nodeId узла LoadImage и fieldName (обычно `image`); `prompt` — nodeId текстового узла и fieldName (`text`/`prompt`/`value`); `output` — nodeId узла сохранения результата (если пусто — берётся первая картинка из outputs); `extra` — фиксированные `{nodeId, fieldName, fieldValue}` (например переключатель fast/pro).
- `publicOutputUrls` — открываются ли `fileUrl` результатов без ключа (иначе QA получает картинку перекладкой через Replicate Files).

API (проверено по документации RunningHub OpenAPI): `POST /task/openapi/upload` (multipart, `fileName` → в `fieldValue` узла LoadImage), `/task/openapi/create` (`workflowId` + `nodeInfoList`), `/task/openapi/status` (`data`: QUEUED|RUNNING|SUCCESS|FAILED), `/task/openapi/outputs` (`data[].fileUrl/nodeId/fileType`). Ключ — `Authorization: Bearer` + `apiKey` в теле.
