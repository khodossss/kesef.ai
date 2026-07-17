# bank-connector-live

Локальный MCP-коннектор к израильским банкам с **ручным входом через живой браузер**.
Обходит защиты, о которые разбивается headless-скрейпинг: 2FA у Hapoalim и Cloudflare
у Isracard. Всё локально, только чтение.

## Как это работает

- **Hapoalim** — открывается окно Chrome; логин и пароль **вставляются автоматически**
  и кнопка входа нажимается сама, ты вводишь **только SMS-код (OTP)**. Данные тянутся из
  **живой авторизованной сессии** через внутренний API банка (2FA не автоматизируется).
- **Isracard** — открывается окно Chrome, ты проходишь **Cloudflare**; дальше библиотека
  `israeli-bank-scrapers-core` сама логинится (id + 6 цифр + пароль, без OTP) и извлекает
  данные своими парсерами.
- **Leumi** — открывается окно; библиотека логинится **сама** (логин + пароль, без OTP)
  и извлекает данные; человек нужен только если всплывёт челлендж в окне.

Результат складывается в локальный SQLite (`data/bank.db`), запросы идут из него —
без браузера и без повторного входа.

## Требования

- Node ≥ 22 (используется встроенный `node:sqlite`; проверено на Node 24).
- Системный Google Chrome (или Edge). Скачивание Chromium отключено.
- Креды в `.env`: Isracard (`ISRACARD_ID`, `ISRACARD_CARD6DIGITS`, `ISRACARD_PASSWORD`),
  Hapoalim (`HAPOALIM_USERCODE`, `HAPOALIM_PASSWORD`), Leumi (`LEUMI_USERNAME`,
  `LEUMI_PASSWORD`). SMS-код Hapoalim вводится вручную в окне (не хранится).

## MCP-инструменты (в Claude Code: сервер `il-bank-live`)

- `refresh(provider)` — открывает браузер, ты проходишь вход, данные обновляются в базе.
  Интерактивно, до нескольких минут. `provider`: `hapoalim` | `isracard`.
- `list_accounts(provider?)` — счета/карты и последний баланс (из базы).
- `get_transactions({provider?, from?, to?, search?, limit?})` — транзакции (из базы).
- `status()` — когда последний раз обновляли, сколько записей.

## Запуск вручную (для отладки)

```
node poc.mjs hapoalim        # ручной вход Hapoalim + извлечение
node poc-isracard.mjs        # Cloudflare + извлечение Isracard
```

## Структура

- `config.mjs` — Chrome, профили, провайдеры, чтение `.env`.
- `src/browser.mjs` — запуск видимого Chrome с постоянным профилем.
- `src/extractors/hapoalim.mjs` — извлечение Hapoalim из живой сессии.
- `src/refresh.mjs` — диспетчер обновления (per-provider стратегия).
- `src/store.mjs` — SQLite (node:sqlite), upsert/дедуп.
- `src/server.mjs` — MCP-сервер (stdio).

## Приватность

Всё на твоей машине. Пароли Hapoalim ты вводишь только в окне браузера (в чат/в файлы
не попадают). Профили с сессиями (`profiles/`) и данные (`data/`) — под `.gitignore`.
Только чтение; никаких платежей.
