// Refresh dispatcher: opens a real visible browser, lets the user clear the human
// gate (Hapoalim: password + SMS OTP; Isracard: Cloudflare), then extracts.
//   - hapoalim: extract from the live authenticated session (2FA can't be automated)
//   - isracard: hand the Cloudflare-cleared context to the library's own scraper
// Returns a normalized { provider, accounts:[{accountNumber, balance, currency, txns[]}] }.

import puppeteer from 'puppeteer-core';
import { createScraper, CompanyTypes } from 'israeli-bank-scrapers-core';
import { CHROME, profileDir, getCredentials, MONTHS_BACK, PROVIDERS } from '../config.mjs';
import { extractHapoalim } from './extractors/hapoalim.mjs';

const CHALLENGE = /just a moment|attention required|checking your browser|רגע אחד|נא להמתין/i;

function launch(provider) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: profileDir(provider),
    defaultViewport: null,
    args: ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  });
}

function log(onProgress, msg) { if (onProgress) onProgress(msg); }

export async function refresh(provider, { monthsBack = MONTHS_BACK, onProgress } = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  const browser = await launch(provider);
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    log(onProgress, `открываю ${provider} — пройди вход в окне браузера`);
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

    if (provider === 'hapoalim') {
      await autofillHapoalim(page, cfg, onProgress); // fill user+password, click login
      const data = await extractHapoalim(page, {
        monthsBack,
        onWait: (state, s) => log(onProgress, `жду полный вход (${state}); ~${s}s — введи SMS-код в окне`),
      });
      return data;
    }

    if (provider === 'isracard') {
      await waitPastCloudflare(page, onProgress);
      log(onProgress, 'Cloudflare пройден — библиотека логинится и извлекает…');
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - monthsBack);
      const scraper = createScraper({
        companyId: CompanyTypes.isracard,
        startDate,
        combineInstallments: false,
        additionalTransactionInformation: false,
        browserContext: browser.defaultBrowserContext(),
        defaultTimeout: 120000,
      });
      const result = await scraper.scrape(getCredentials('isracard'));
      if (!result.success) throw new Error(`isracard scrape failed: ${result.errorType} ${result.errorMessage || ''}`);
      return {
        provider: 'isracard',
        accounts: (result.accounts || []).map(a => ({
          accountNumber: String(a.accountNumber),
          balance: null,
          currency: 'ILS',
          txns: a.txns || [],
        })),
      };
    }

    throw new Error(`no refresh strategy for ${provider}`);
  } finally {
    await browser.close();
  }
}

// Auto-fill Hapoalim userCode + password and click login, so the human only owes
// the SMS OTP. Best-effort: if the form isn't there (already logged in, changed
// markup), we log and continue — the user can still type it manually in the window.
async function autofillHapoalim(page, cfg, onProgress) {
  try {
    const creds = getCredentials('hapoalim');
    const { user, pass, submit } = cfg.login;
    await page.waitForSelector(user, { timeout: 30000 });
    await page.click(user, { clickCount: 3 }).catch(() => {});
    await page.type(user, creds.userCode, { delay: 25 });
    await page.type(pass, creds.password, { delay: 25 });
    log(onProgress, 'логин и пароль вставлены, жму «войти» — введи только SMS-код');
    await page.click(submit);
  } catch (e) {
    log(onProgress, `автозаполнение не удалось (${e.message}); войди вручную в окне`);
  }
}

async function waitPastCloudflare(page, onProgress, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = await page.evaluate(() => ({
      title: document.title, inputs: document.querySelectorAll('input').length,
      host: location.host, ready: document.readyState,
    })).catch(() => null);
    if (s && /isracard/i.test(s.host) && s.ready === 'complete' && s.inputs > 0 && !CHALLENGE.test(s.title)) return;
    log(onProgress, 'жду прохождение Cloudflare в окне…');
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Cloudflare not passed within timeout');
}
