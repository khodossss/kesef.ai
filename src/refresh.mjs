// Refresh dispatcher. Opens a REAL visible browser; the human clears whatever gate
// the provider needs, then data is extracted.
//   - hapoalim: we drive page 0 (auto-fill creds), human enters the SMS OTP, then
//     extract from the live authenticated session (2FA can't be automated).
//   - leumi / isracard: the LIBRARY launches its own browser (mode B) with a
//     persistent profile and does login + extraction itself. We do NOT inject our
//     own browserContext — doing that from inside the MCP stdio server makes the
//     library's newPage fail ("Failed to open a new tab"). Isracard's Cloudflare and
//     any bank's "trust this device" are cleared by the human in that window (and a
//     one-time warmup persists the trust/clearance cookie for later silent runs).
// Returns { provider, accounts:[{accountNumber, balance, currency, txns[]}] }.

import puppeteer from 'puppeteer-core';
import { createScraper } from 'israeli-bank-scrapers-core';
import { getChrome, profileDir, getCredentials, MONTHS_BACK, PROVIDERS } from '../config.mjs';
import { extractHapoalim } from './extractors/hapoalim.mjs';

function log(onProgress, msg) { if (onProgress) onProgress(msg); }

const COMMON_ARGS = ['--start-maximized', '--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'];

// One-time manual login into a persistent profile. The human logs in, ticks
// "trust this device" (and passes Cloudflare for cards), reaches the account page,
// then CLOSES the window. The device-trust / cf_clearance cookie stays in the
// profile so later refresh() runs go through without OTP/Cloudflare. This is the
// robust path for banks whose automated login needs a trusted device (e.g. Leumi).
export async function warmup(provider, { onProgress } = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  getChrome();
  const browser = await puppeteer.launch({
    executablePath: getChrome(),
    headless: false,
    userDataDir: profileDir(provider),
    defaultViewport: null,
    args: COMMON_ARGS,
  });
  const [page] = await browser.pages();
  await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  log(onProgress, `Войди вручную в окне ${provider}: логин, пароль, SMS-код, ОБЯЗАТЕЛЬНО «доверять этому устройству». Дойди до страницы счёта и ЗАКРОЙ окно.`);
  await new Promise(resolve => browser.on('disconnected', resolve));
  return { provider, warmed: true, note: 'Профиль прогрет. Теперь refresh должен пройти без SMS/Cloudflare, пока держится cookie доверия.' };
}

export async function refresh(provider, { monthsBack = MONTHS_BACK, onProgress } = {}) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new Error(`unknown provider: ${provider}`);
  // Validate up front so a missing-cred error is a clean message, not a window flash.
  if (cfg.usesStoredCredentials) getCredentials(provider);
  getChrome(); // clear error if no browser is installed

  if (provider === 'hapoalim') {
    return refreshHapoalim(cfg, monthsBack, onProgress);
  }
  // leumi, isracard, and any other library-login provider
  return libScrape(cfg, provider, getCredentials(provider), monthsBack, onProgress);
}

// Hapoalim: our own browser; auto-fill creds; human types the SMS OTP; extract live.
async function refreshHapoalim(cfg, monthsBack, onProgress) {
  const browser = await puppeteer.launch({
    executablePath: getChrome(),
    headless: false,
    userDataDir: profileDir('hapoalim'),
    defaultViewport: null,
    args: COMMON_ARGS,
  });
  try {
    log(onProgress, 'открываю Hapoalim — сейчас вставлю логин/пароль');
    const page = (await browser.pages())[0] || (await browser.newPage());
    await page.goto(cfg.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await autofillHapoalim(page, cfg, onProgress);
    return await extractHapoalim(page, {
      monthsBack,
      onWait: (state, s) => log(onProgress, `жду полный вход (${state}); ~${s}s — введи SMS-код в окне`),
    });
  } finally {
    await browser.close();
  }
}

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

// Mode B: the library launches and drives its OWN browser (visible), with a
// persistent profile so a warmed "trust this device" / cf_clearance cookie lets
// later runs go through silently. Robust inside the MCP stdio server.
async function libScrape(cfg, provider, creds, monthsBack, onProgress) {
  log(onProgress, `открываю ${provider} — библиотека логинится сама; при челлендже/Cloudflare пройди в окне`);
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - monthsBack);
  const scraper = createScraper({
    companyId: cfg.companyId,
    startDate,
    combineInstallments: false,
    additionalTransactionInformation: false,
    showBrowser: true,
    executablePath: getChrome(),
    args: [...COMMON_ARGS, `--user-data-dir=${profileDir(provider)}`],
    timeout: 0, // no navigation timeout — gives the human time at Cloudflare / 2FA
  });
  const result = await scraper.scrape(creds);
  if (!result.success) throw new Error(`${provider} scrape failed: ${result.errorType} ${result.errorMessage || ''}`);
  return {
    provider,
    accounts: (result.accounts || []).map(a => ({
      accountNumber: String(a.accountNumber),
      balance: a.balance ?? null,
      currency: 'ILS',
      txns: a.txns || [],
    })),
  };
}
