#!/usr/bin/env node
// Local, one-shot setup form for the root .env.
//
// Binds to 127.0.0.1 on a random port, serves ONE page, writes .env (mode 600),
// then shuts itself down. Nothing is sent anywhere: the only network listener is
// loopback, guarded by a per-run token, and the page has no external assets.
//
// Run: npm run setup

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, chmodSync, renameSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(ROOT, '.env');
const CLAUDE_JSON = join(homedir(), '.claude.json');
const TOKEN = randomBytes(24).toString('base64url');

// Placeholder values shipped in .env.example — present but not real credentials.
const PLACEHOLDER = /^(your_|last_6_digits)/i;

const FIELDS = {
  isracard: [
    { key: 'ISRACARD_ID', label: 'Теудат зеут (ID)', hint: '9 цифр, как в удостоверении', type: 'text' },
    { key: 'ISRACARD_CARD6DIGITS', label: 'Последние 6 цифр карты', hint: 'С лицевой стороны карты', type: 'text' },
    { key: 'ISRACARD_PASSWORD', label: 'Пароль от личного кабинета', hint: '', type: 'password' },
  ],
  hapoalim: [
    { key: 'HAPOALIM_USERCODE', label: 'Код пользователя', hint: 'Тот, что вводишь на сайте банка', type: 'text' },
    { key: 'HAPOALIM_PASSWORD', label: 'Пароль', hint: '', type: 'password' },
  ],
  leumi: [
    { key: 'LEUMI_USERNAME', label: 'Имя пользователя', hint: '', type: 'text' },
    { key: 'LEUMI_PASSWORD', label: 'Пароль', hint: '', type: 'password' },
  ],
  cal: [
    { key: 'CAL_USERNAME', label: 'Имя пользователя', hint: 'То же, что на cal-online.co.il', type: 'text' },
    { key: 'CAL_PASSWORD', label: 'Пароль', hint: '', type: 'password' },
  ],
};

const PROVIDER_META = {
  isracard: { title: 'Isracard', kind: 'кредитная карта', step: 'При сборе один раз пройдёшь проверку Cloudflare' },
  hapoalim: { title: 'Банк Hapoalim', kind: 'банк', step: 'При сборе введёшь SMS-код в окне браузера' },
  leumi: { title: 'Банк Leumi', kind: 'банк', step: 'Вход автоматический, обычно ничего вводить не нужно' },
  cal: { title: 'Cal (כאל)', kind: 'кредитная карта', step: 'Вход автоматический, обычно ничего вводить не нужно' },
};

// Raw read: no '#' stripping, so a commented key really is inactive here.
function readEnvRaw() {
  const out = {};
  if (!existsSync(ENV_PATH)) return out;
  for (const line of readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] !== '' && !PLACEHOLDER.test(m[2])) out[m[1]] = m[2];
  }
  return out;
}

// Which providers already hold real (non-placeholder) values. Booleans only —
// saved secrets are never sent back to the page.
function savedState(env) {
  const state = {};
  for (const [provider, fields] of Object.entries(FIELDS)) {
    state[provider] = {
      any: fields.some(f => env[f.key]),
      fields: Object.fromEntries(fields.map(f => [f.key, Boolean(env[f.key])])),
    };
  }
  return state;
}

// IMPORTANT: never emit commented-out "# KEY=value" lines. config.loadEnv strips a
// leading '#' before parsing, so a commented credential would still count as
// configured. Unused providers are omitted entirely instead.
function renderEnv(values) {
  const out = [
    '# kesef.ai — доступы к банкам. Создано формой настройки (npm run setup).',
    '# Файл в .gitignore, права 600, никуда не отправляется.',
    '#',
    '# Не добавляй сюда закомментированные строки с ключами: парсер снимает',
    '# ведущую решётку, и такая строка всё равно считается активной.',
    '# Чтобы отключить банк — удали его строки или оставь значение пустым.',
    '',
  ];
  for (const [provider, fields] of Object.entries(FIELDS)) {
    const filled = fields.filter(f => values[f.key]);
    if (!filled.length) continue;
    out.push(`# ===== ${PROVIDER_META[provider].title} =====`);
    for (const f of filled) out.push(`${f.key}=${values[f.key]}`);
    out.push('');
  }
  const household = readHouseholdLines();
  if (household.length) out.push(...household, '');
  return out.join('\n');
}

// Family-mode keys are managed by the family_* tools, not by this form — carry
// them over verbatim so a re-run never wipes an existing household setup.
function readHouseholdLines() {
  if (!existsSync(ENV_PATH)) return [];
  return readFileSync(ENV_PATH, 'utf8')
    .split(/\r?\n/)
    .filter(l => /^(HOUSEHOLD_|RELAY_URL=|MEMBER_)/.test(l));
}

// SCRAPE_MONTHS_BACK is read from process.env (config.mjs), NOT from .env — so it
// only takes effect through the MCP server's own env block.
//
// ~/.claude.json is Claude Code's live global state (every MCP registration and
// per-project entry), and Claude Code writes it on its own schedule. So this
// read-modify-write must never leave it half-written: keep a .bak of what we read,
// then swap the new content in with an atomic rename instead of truncating in place.
function writeMonthsBack(months) {
  if (!existsSync(CLAUDE_JSON)) return { ok: false, reason: 'нет ~/.claude.json' };
  try {
    const raw = readFileSync(CLAUDE_JSON, 'utf8');
    const cfg = JSON.parse(raw);
    const entry = cfg.mcpServers && cfg.mcpServers.kesef;
    if (!entry) return { ok: false, reason: 'сервер kesef не зарегистрирован' };
    if (entry.env?.SCRAPE_MONTHS_BACK === String(months)) return { ok: true };
    entry.env = { ...(entry.env || {}), SCRAPE_MONTHS_BACK: String(months) };
    writeFileSync(`${CLAUDE_JSON}.bak`, raw);
    const tmp = `${CLAUDE_JSON}.kesef-tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    renameSync(tmp, CLAUDE_JSON); // same directory → atomic replace
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function tokenOk(candidate) {
  const a = Buffer.from(String(candidate || ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function page(state) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Настройка kesef.ai</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --fg: #16181d; --muted: #6b7280; --line: #e3e6ea;
    --accent: #2f6fe4; --accent-fg: #fff; --ok: #147a4b; --warn-bg: #fff8e6; --warn-line: #f0d089;
    --input-bg: #fff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --card: #1c1f25; --fg: #e8eaed; --muted: #9aa3af; --line: #2c313a;
      --accent: #5b91ff; --accent-fg: #0d1117; --ok: #4ec98a; --warn-bg: #2a2415; --warn-line: #5c4d22;
      --input-bg: #14171c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--fg);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .wrap { max-width: 620px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 6px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); margin: 0 0 24px; font-size: 14px; }
  .note {
    background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 10px;
    padding: 12px 14px; font-size: 13.5px; margin-bottom: 24px; color: var(--fg);
  }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    margin-bottom: 14px; overflow: hidden;
  }
  .head {
    display: flex; align-items: center; gap: 12px; padding: 16px 18px; cursor: pointer;
    user-select: none;
  }
  .head:hover { background: color-mix(in srgb, var(--fg) 3%, transparent); }
  .head input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; flex: none; }
  .title { font-weight: 600; }
  .kind { color: var(--muted); font-weight: 400; font-size: 13px; }
  .saved { margin-left: auto; color: var(--ok); font-size: 12.5px; font-weight: 500; flex: none; }
  .body { display: none; padding: 4px 18px 18px; border-top: 1px solid var(--line); }
  .body.open { display: block; }
  .step { color: var(--muted); font-size: 13px; margin: 12px 0 16px; }
  label { display: block; margin-bottom: 14px; }
  .lab { display: block; font-size: 13.5px; font-weight: 500; margin-bottom: 5px; }
  .hint { color: var(--muted); font-weight: 400; }
  .row { display: flex; gap: 8px; }
  input[type=text], input[type=password], input[type=number] {
    width: 100%; padding: 9px 11px; font-size: 15px; font-family: inherit;
    background: var(--input-bg); color: var(--fg);
    border: 1px solid var(--line); border-radius: 9px;
  }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
  input::placeholder { color: var(--muted); opacity: 0.7; }
  .eye {
    flex: none; width: 42px; border: 1px solid var(--line); border-radius: 9px;
    background: var(--input-bg); color: var(--muted); cursor: pointer; font-size: 15px;
  }
  .eye:hover { color: var(--fg); }
  .months { display: flex; align-items: center; gap: 12px; padding: 16px 18px; }
  .months input { width: 88px; }
  .months .lab { margin: 0; }
  button.save {
    width: 100%; margin-top: 8px; padding: 13px; font-size: 15.5px; font-weight: 600;
    font-family: inherit; color: var(--accent-fg); background: var(--accent);
    border: 0; border-radius: 11px; cursor: pointer;
  }
  button.save:hover { filter: brightness(1.08); }
  button.save:disabled { opacity: 0.55; cursor: default; filter: none; }
  .msg { margin-top: 14px; font-size: 14px; }
  .msg.err { color: #c0392b; }
  @media (prefers-color-scheme: dark) { .msg.err { color: #ff8b7a; } }
  .done { text-align: center; padding: 40px 0; }
  .done .check { font-size: 44px; }
  .done h2 { margin: 12px 0 8px; font-size: 20px; }
  .done p { color: var(--muted); margin: 0 auto 8px; max-width: 420px; }
  .done code {
    background: color-mix(in srgb, var(--fg) 8%, transparent); padding: 2px 6px;
    border-radius: 5px; font-size: 13px;
  }
</style>
</head>
<body>
<div class="wrap" id="wrap">
  <h1>Настройка kesef.ai</h1>
  <p class="sub">Отметь банки, которыми пользуешься, и заполни поля. Остальные не трогай.</p>

  <div class="note">
    Страница работает только на твоём компьютере (127.0.0.1) и записывает файл <code>.env</code>
    в папке проекта. Никуда ничего не отправляется. После сохранения сервер сам выключится.
  </div>

  <form id="form">
    ${Object.keys(FIELDS)
      .map(p => providerCard(p, state[p]))
      .join('\n')}

    <div class="card">
      <div class="months">
        <span class="lab">За сколько месяцев тянуть историю</span>
        <input type="number" id="months" name="months" min="1" max="36" value="12">
      </div>
    </div>

    <button class="save" type="submit">Сохранить</button>
    <div class="msg" id="msg"></div>
  </form>
</div>

<script>
const TOKEN = ${JSON.stringify(TOKEN)};

for (const head of document.querySelectorAll('.head')) {
  const box = head.querySelector('input[type=checkbox]');
  const body = head.parentElement.querySelector('.body');
  const sync = () => body.classList.toggle('open', box.checked);
  head.addEventListener('click', e => {
    if (e.target !== box) box.checked = !box.checked;
    sync();
  });
  sync();
}

for (const eye of document.querySelectorAll('.eye')) {
  eye.addEventListener('click', () => {
    const input = eye.previousElementSibling;
    const shown = input.type === 'text';
    input.type = shown ? 'password' : 'text';
    eye.textContent = shown ? '\u{1F441}' : '\u{1F648}';
  });
}

document.getElementById('form').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = document.getElementById('msg');
  const btn = e.target.querySelector('button.save');
  const providers = {}, values = {};
  for (const box of document.querySelectorAll('input[type=checkbox]')) providers[box.dataset.provider] = box.checked;
  for (const input of document.querySelectorAll('input[data-key]')) values[input.dataset.key] = input.value.trim();
  if (!Object.values(providers).some(Boolean)) {
    msg.className = 'msg err';
    msg.textContent = 'Отметь хотя бы один банк.';
    return;
  }
  btn.disabled = true;
  msg.className = 'msg';
  msg.textContent = 'Сохраняю…';
  try {
    const res = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Setup-Token': TOKEN },
      body: JSON.stringify({ providers, values, months: document.getElementById('months').value }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    document.getElementById('wrap').innerHTML =
      '<div class="done"><div class="check">✅</div><h2>Готово</h2>' +
      '<p>' + data.summary + '</p>' +
      '<p>Закрой эту вкладку и перезапусти сессию Claude Code — потом попроси обновить данные по банку.</p></div>';
  } catch (err) {
    btn.disabled = false;
    msg.className = 'msg err';
    msg.textContent = 'Не сохранилось: ' + err.message;
  }
});
</script>
</body>
</html>`;
}

function providerCard(provider, saved) {
  const meta = PROVIDER_META[provider];
  const fields = FIELDS[provider]
    .map(f => {
      const isSaved = saved.fields[f.key];
      const ph = isSaved ? 'сохранено — оставь пустым, чтобы не менять' : '';
      const input =
        `<input type="${f.type}" data-key="${f.key}" placeholder="${ph}" autocomplete="off" ` +
        `spellcheck="false" ${f.type === 'password' ? '' : 'inputmode="text"'}>`;
      const control =
        f.type === 'password'
          ? `<div class="row">${input}<button type="button" class="eye">\u{1F441}</button></div>`
          : input;
      return `<label><span class="lab">${f.label}${f.hint ? ` <span class="hint">— ${f.hint}</span>` : ''}</span>${control}</label>`;
    })
    .join('\n');
  return `<div class="card">
  <div class="head">
    <input type="checkbox" data-provider="${provider}" ${saved.any ? 'checked' : ''}>
    <span class="title">${meta.title} <span class="kind">— ${meta.kind}</span></span>
    ${saved.any ? '<span class="saved">уже настроен</span>' : ''}
  </div>
  <div class="body">
    <div class="step">${meta.step}</div>
    ${fields}
  </div>
</div>`;
}

function save(body) {
  const existing = readEnvRaw();
  const values = {};
  const kept = [];
  for (const [provider, fields] of Object.entries(FIELDS)) {
    if (!body.providers[provider]) continue;
    const missing = [];
    for (const f of fields) {
      // Blank input keeps whatever was already saved for that key.
      const next = (body.values[f.key] || '').trim() || existing[f.key] || '';
      if (!next) missing.push(f.label);
      else values[f.key] = next;
    }
    if (missing.length) throw new Error(`${PROVIDER_META[provider].title}: не заполнено — ${missing.join(', ')}`);
    kept.push(PROVIDER_META[provider].title);
  }
  writeFileSync(ENV_PATH, renderEnv(values));
  chmodSync(ENV_PATH, 0o600);

  const months = Math.min(36, Math.max(1, parseInt(body.months, 10) || 12));
  const monthsResult = writeMonthsBack(months);
  const monthsNote = monthsResult.ok
    ? `Глубина истории: ${months} мес.`
    : `Глубину истории записать не вышло (${monthsResult.reason}) — останется 12 мес. по умолчанию.`;
  return { summary: `Настроено: ${kept.join(', ')}. ${monthsNote}`, kept, months };
}

const state = savedState(readEnvRaw());

const server = createServer((req, res) => {
  // Loopback only: reject anything that reached us under another host name
  // (blocks DNS-rebinding from a page in the same browser).
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1') {
    res.writeHead(403).end('forbidden');
    return;
  }
  const url = new URL(req.url, 'http://127.0.0.1');

  if (req.method === 'GET' && url.pathname === '/') {
    if (!tokenOk(url.searchParams.get('t'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Открой ссылку целиком, вместе с ?t=… — она напечатана в терминале.');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(page(state));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/save') {
    if (!tokenOk(req.headers['x-setup-token'])) {
      res.writeHead(403, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"bad token"}');
      return;
    }
    let raw = '';
    req.on('data', c => {
      raw += c;
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const result = save(JSON.parse(raw));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, summary: result.summary }));
        console.log(`\n  ✓ .env записан (${result.kept.join(', ')}; история ${result.months} мес.)`);
        console.log('  Перезапусти сессию Claude Code и попроси обновить данные по банку.\n');
        setTimeout(() => server.close(() => process.exit(0)), 400);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404).end('not found');
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/?t=${TOKEN}`;
  console.log('\n  Форма настройки kesef.ai открыта в браузере.');
  console.log(`  Если вкладка не появилась — открой ссылку вручную:\n\n  ${url}\n`);
  console.log('  Пароли остаются на этой машине: страница локальная, сервер выключится после сохранения.');
  console.log('  Прервать без сохранения — Ctrl+C.\n');
  // KESEF_SETUP_NO_OPEN=1 — print the URL only (headless box, SSH, smoke test).
  if (process.env.KESEF_SETUP_NO_OPEN) return;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
  child.on('error', () => console.log('  (браузер сам не открылся — скопируй ссылку выше)'));
  child.unref();
});
