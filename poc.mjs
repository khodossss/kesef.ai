// PoC: user-assisted login + live-session extraction for one provider.
// Usage: node poc.mjs hapoalim
// Opens a visible Chrome, waits for you to log in, then extracts via the live
// authenticated session (no automated re-login). Prints a summary; writes the
// full result to data/<provider>-latest.json for inspection.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, waitForLogin } from './src/browser.mjs';
import { extractHapoalim } from './src/extractors/hapoalim.mjs';
import { PROVIDERS, MONTHS_BACK, DATA_DIR } from './config.mjs';

const EXTRACTORS = { hapoalim: extractHapoalim };

const provider = process.argv[2] || 'hapoalim';
const cfg = PROVIDERS[provider];
if (!cfg) { console.error('unknown provider', provider); process.exit(1); }
const extractor = EXTRACTORS[provider];
if (!extractor) { console.error('no extractor yet for', provider); process.exit(1); }

console.log(`[poc] launching Chrome for ${provider} ...`);
const browser = await launch(provider);
const pages = await browser.pages();
const page = pages[0] || (await browser.newPage());
console.log(`[poc] opening login page — LOG IN MANUALLY in the window (OTP/CAPTCHA ok)`);
await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('[poc] nav note:', e.message));

const loggedPage = await waitForLogin(browser, cfg);
if (!loggedPage) { console.log('[poc] LOGIN_TIMEOUT (5 min) — not detected'); await browser.close(); process.exit(2); }
console.log('[poc] LOGGED_IN detected — extracting from live session ...');

try {
  const onWait = (state, secsLeft) => console.log(`[poc] ещё жду полный вход (${state}); осталось ~${secsLeft}s — введи SMS-код в окне`);
  const data = await extractor(loggedPage, { monthsBack: MONTHS_BACK, onWait });
  const totalTxns = data.accounts.reduce((n, a) => n + a.txns.length, 0);
  console.log(`[poc] OK: ${data.accounts.length} account(s), ${totalTxns} transaction(s)`);
  for (const a of data.accounts) {
    console.log(`   • ${a.accountNumber}: balance=${a.balance} ${a.currency} · txns=${a.txns.length}`);
  }
  const out = join(DATA_DIR, `${provider}-latest.json`);
  writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[poc] full result written to ${out}`);
} catch (e) {
  console.log('[poc] EXTRACT_ERROR:', e.message);
  console.log(e.stack);
} finally {
  await browser.close();
  console.log('[poc] done, browser closed');
}
