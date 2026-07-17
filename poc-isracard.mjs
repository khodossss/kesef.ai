// PoC for Isracard. Its only blocker is Cloudflare bot-detection (not login 2FA),
// so: open a real visible Chrome, let the user get past Cloudflare, then hand the
// same browser context to israeli-bank-scrapers-core — it logs in (id + card6 +
// password, no OTP) and extracts with its own parsers (installments, months, …).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers-core';
import { CHROME, profileDir, getCredentials, MONTHS_BACK, DATA_DIR } from './config.mjs';

const CHALLENGE = /just a moment|attention required|checking your browser|רגע אחד|נא להמתין/i;

console.log('[isra] launching Chrome …');
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: profileDir('isracard'),
  defaultViewport: null,
  args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
});

const page = (await browser.pages())[0] || (await browser.newPage());
console.log('[isra] opening Isracard — pass the Cloudflare check / any human step in the window');
await page.goto('https://digital.isracard.co.il/personalarea/Login', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('[isra] nav note:', e.message));

// Wait until we're clearly past Cloudflare: real DOM with inputs, non-challenge title.
const start = Date.now();
let passed = false;
while (Date.now() - start < 300000) {
  const s = await page.evaluate(() => ({
    title: document.title,
    inputs: document.querySelectorAll('input').length,
    host: location.host,
    ready: document.readyState,
  })).catch(() => null);
  if (s && /isracard/i.test(s.host) && s.ready === 'complete' && s.inputs > 0 && !CHALLENGE.test(s.title)) { passed = true; break; }
  await new Promise(r => setTimeout(r, 2000));
}
if (!passed) { console.log('[isra] CLOUDFLARE_NOT_PASSED (5 min)'); await browser.close(); process.exit(2); }
console.log('[isra] past Cloudflare — handing session to scraper for login + extraction …');

try {
  const creds = getCredentials('isracard');
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - MONTHS_BACK);
  const scraper = createScraper({
    companyId: CompanyTypes.isracard,
    startDate,
    combineInstallments: false,
    additionalTransactionInformation: false,
    browserContext: browser.defaultBrowserContext(),
    defaultTimeout: 120000,
  });
  const result = await scraper.scrape(creds);
  if (!result.success) throw new Error(`scrape failed: ${result.errorType} ${result.errorMessage || ''}`);
  const accounts = result.accounts || [];
  const totalTxns = accounts.reduce((n, a) => n + (a.txns?.length || 0), 0);
  console.log(`[isra] OK: ${accounts.length} card(s), ${totalTxns} transaction(s)`);
  for (const a of accounts) console.log(`   • card ${a.accountNumber}: txns=${a.txns?.length || 0}`);
  const out = join(DATA_DIR, 'isracard-latest.json');
  writeFileSync(out, JSON.stringify({ provider: 'isracard', accounts }, null, 2), 'utf8');
  console.log(`[isra] full result written to ${out}`);
} catch (e) {
  console.log('[isra] EXTRACT_ERROR:', e.message);
  console.log(e.stack);
} finally {
  await browser.close();
  console.log('[isra] done, browser closed');
}
