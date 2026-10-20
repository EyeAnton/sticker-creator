# RunningHub — данные для live-режима (заполняет пользователь)

Ключ API сюда **не писать**: `cd worker && npx wrangler secret put RUNNINGHUB_API_KEY`.

На каждый шаг — workflow или AI-приложение RunningHub. Нужны id и узлы, куда подставлять вход (nodeId + fieldName), и узел результата. Проще всего — положить JSON workflow (API-формат) в `worker/rh/<шаг>.json`; таблицу ниже тогда заполнит агент.

| Шаг | Что делает | workflowId / webappId | Вход: картинка (nodeId.field) | Вход: промпт (nodeId.field) | Выход |
|---|---|---|---|---|---|
| validate | модерация фото (vision-LLM) → JSON | | | | текст |
| restyle | портрет → базовый стикер | | | | картинка |
| emotion `fast` | базовый стикер + промпт → эмоция | | | | картинка |
| emotion `pro` | то же, «сильная» модель | | | | картинка |
| qa | 2 картинки → JSON `{"status":0}` | | image1: … image2: … | | текст |

Если для validate/qa на RunningHub нет vision-LLM — напиши, решим отдельно.

Домен API: `www.runninghub.ai` или `www.runninghub.cn` — какой у аккаунта?
