# 🚀 START — запуск kesef.ai на новом компьютере

Личный MCP-коннектор к израильским банкам (**Hapoalim**, **Isracard**) с ручным
входом через живой браузер. Обходит 2FA и Cloudflare, читает баланс и траты,
отдаёт их Claude Code. **Всё локально, только чтение.**

---

## 0. Требования

- **Node.js ≥ 22** (нужен встроенный `node:sqlite`). Проверка: `node --version`.
- **Google Chrome** (или Edge) установлен.
- **git** и **Claude Code CLI** (`claude`).
- Windows (проверено). macOS/Linux — работает с правкой пути к Chrome (см. шаг 3).

---

## 1. Подкачать код из GitHub

```bash
git clone https://github.com/khodossss/kesef.ai.git
cd kesef.ai
```

**Обновиться позже** (когда выйдут изменения):

```bash
git pull
npm install        # если поменялись зависимости
```

---

## 2. Установить зависимости

Chromium качать не нужно — используем системный Chrome:

```bash
# Windows (Git Bash) / macOS / Linux:
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

```powershell
# Windows PowerShell:
$env:PUPPETEER_SKIP_DOWNLOAD="true"; npm install
```

---

## 3. Указать свои креды

```bash
cp .env.example .env
```

Открой `.env` и впиши **свои** данные:

```dotenv
ISRACARD_ID=...            # теудат зеут
ISRACARD_CARD6DIGITS=...   # последние 6 цифр карты
ISRACARD_PASSWORD=...
HAPOALIM_USERCODE=...
HAPOALIM_PASSWORD=...
LEUMI_USERNAME=...          # если есть счёт в Leumi
LEUMI_PASSWORD=...
SCRAPE_MONTHS_BACK=12
```

Заполняй только те банки, что у тебя есть — сервер сам определит активные по кредам.

`.env` **в git не попадает** (в `.gitignore`) — остаётся только у тебя.
SMS-код Hapoalim нигде не хранится: ты вводишь его в окне браузера.

**Chrome в нестандартном месте / macOS / Linux?** Добавь путь в
`config.mjs` → массив `CHROME_CANDIDATES` (напр. на macOS:
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).

---

## 4. Проверить, что код в порядке

```bash
npm run check    # node --check по всем модулям
```

---

## 5. Подключить к Claude Code

Укажи **абсолютный путь** к `src/server.mjs` (на Windows — со слэшами `/`):

```bash
claude mcp add kesef --scope user -- node /ПОЛНЫЙ/ПУТЬ/kesef.ai/src/server.mjs
claude mcp get kesef      # должно быть: Status ✔ Connected
```

Пример пути на Windows: `C:/Users/имя/kesef.ai/src/server.mjs`.

_(Опционально — slash-команда `/finance-report`: скопируй `commands/finance-report.md`
из репо в `~/.claude/commands/`.)_

---

## 6. Первый заход — собрать данные

Открой **новую** сессию Claude Code (чтобы подхватила сервер) и попроси:

- **«обнови Isracard»** → откроется окно Chrome → пройди **Cloudflare** (логин делает
  библиотека сама по кредам из `.env`).
- **«обнови Hapoalim»** → откроется окно → логин/пароль вставятся сами → введи
  **только SMS-код**.
- **«обнови Leumi»** → откроется окно → библиотека логинится сама (без OTP); вмешайся
  только при челлендже.

**Если банк требует «доверенное устройство» (частый случай для Leumi) и авто-вход падает —**
сначала сделай разовый **прогрев**: «сделай warmup Leumi» → откроется окно, войди вручную,
поставь галочку **«доверять этому устройству»**, дойди до счёта и закрой окно. После этого
«обнови Leumi» пойдёт без ручного входа, пока держится cookie доверия.

---

## 7. Пользоваться

- Один пользователь: [SOLO.md](SOLO.md) — отчёты и вопросы по своим финансам.
- Семья (несколько человек, сводный отчёт): [FAMILY.md](FAMILY.md).

---

## 8. Добавить другой банк/карту

`israeli-bank-scrapers` поддерживает 18+ провайдеров. Два шаблона:

- **Как Isracard** (блокирует только Cloudflare, без OTP): добавь провайдера в
  `config.mjs` → `PROVIDERS`, затем ветку в `src/refresh.mjs` по образцу `isracard`
  (`browserContext` → `createScraper`). Подходит для Max, Visa Cal, Amex и др.
- **Как Hapoalim** (2FA/OTP): нужен свой extractor из живой сессии по образцу
  `src/extractors/hapoalim.mjs`, либо тот же паттерн auto-fill + ручной OTP.

Список провайдеров и полей — в README библиотеки
`israeli-bank-scrapers`.

---

## 9. Траблшутинг

| Симптом                               | Что делать                                                           |
| ------------------------------------- | -------------------------------------------------------------------- |
| `No system Chrome/Edge found`         | добавь путь в `config.mjs` → `CHROME_CANDIDATES`, или поставь Chrome |
| ошибка про `node:sqlite`              | нужен **Node ≥ 22**                                                  |
| `refresh` висит                       | не закрывай окно, заверши вход (SMS/Cloudflare); таймаут 8 мин       |
| Cloudflare не проходит                | подожди/поставь галочку «I'm not a robot» в окне                     |
| Hapoalim авто-заполнение не сработало | войди в окне вручную — флоу не сломается                             |
| MCP не виден в Claude                 | открой **новую** сессию; проверь `claude mcp get kesef`              |

---

## 🔒 Безопасность

- `.env` (креды), `profiles/` (сессии), `data/` (транзакции) — **в `.gitignore`**,
  не коммитятся.
- Пароль Hapoalim SMS вводится только в браузере, не хранится.
- Данные никуда не уходят — только твоя машина и твой Claude Code.
- **Только чтение.** Никаких платежей/переводов.
- **Семейный режим** ([FAMILY.md](FAMILY.md)): в relay-режиме между машинами ходят
  E2E-зашифрованные снимки (без кредов); в local-режиме — файлы в папке, которую ты
  синхронизируешь сам. Соло-режим остаётся строго локальным.
