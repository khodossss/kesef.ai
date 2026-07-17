// Central config for the user-assisted (manual-login) bank connector.
// Everything is local: system Chrome, per-provider persistent browser profiles,
// credentials read from the sibling ../.env that the user already filled.

import { CompanyTypes } from 'israeli-bank-scrapers-core';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// System Chrome/Edge (no bundled Chromium download). Cross-platform.
// Override with CHROME_PATH in .env if installed somewhere unusual.
const CHROME_CANDIDATES = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  // Windows
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Linux
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].filter(Boolean);

// Lazy — resolved only when actually launching a browser, so a missing Chrome
// doesn't crash the whole MCP server at import (read-only tools keep working).
export function getChrome() {
  const override = process.env.CHROME_PATH;
  if (override && existsSync(override)) return override;
  const found = CHROME_CANDIDATES.find(p => existsSync(p));
  if (!found) {
    throw new Error(
      'No system Chrome/Edge found. Install Google Chrome, or set CHROME_PATH in .env to the browser executable.',
    );
  }
  return found;
}

export const PROFILES_DIR = join(__dirname, 'profiles');
export const DATA_DIR = join(__dirname, 'data');
for (const d of [PROFILES_DIR, DATA_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

export function profileDir(provider) {
  return join(PROFILES_DIR, provider);
}

export function safeUrl(page) {
  try {
    return page.url();
  } catch {
    return '';
  }
}

// Per-provider: the login page to warm, how we recognise a logged-in page,
// and which .env keys carry its credentials.
export const PROVIDERS = {
  hapoalim: {
    companyId: CompanyTypes.hapoalim,
    kind: 'bank',
    // LOGIN MODE: autofill-then-otp. We auto-fill userCode + password and click
    // login; the human only enters the SMS OTP (step-up) in the window. Data is
    // then read from the live authenticated session (2FA still can't be automated).
    loginMode: 'autofill-then-otp',
    humanStep: 'ввести только SMS-код (OTP) в окне',
    usesStoredCredentials: true,
    login: { user: '#userCode', pass: '#password', submit: '.login-btn' },
    loginUrl: 'https://login.bankhapoalim.co.il/cgi-bin/poalwwwc?reqName=getLogonPage',
    // logged-in when the bank's SPA object is present (what extraction needs),
    // or the URL reached a portal homepage.
    detectLoggedIn: async page => {
      const url = safeUrl(page);
      if (/homepage/i.test(url)) return true;
      if (!/bankhapoalim\.co\.il/i.test(url)) return false;
      return page.evaluate(() => !!window.bnhpApp).catch(() => false);
    },
    credentials: env => ({ userCode: env.HAPOALIM_USERCODE, password: env.HAPOALIM_PASSWORD }),
  },
  leumi: {
    companyId: CompanyTypes.leumi,
    kind: 'bank',
    // LOGIN MODE: auto-visible. Leumi logs in with username+password (NO OTP), done
    // automatically by the library. The visible browser lets the human step in only
    // if a rare challenge/interstitial appears. Extraction is the library's too.
    loginMode: 'auto-visible',
    humanStep: 'обычно ничего — библиотека логинится сама; при челлендже пройти в окне',
    usesStoredCredentials: true,
    loginUrl: 'https://www.leumi.co.il/he',
    credentials: env => ({ username: env.LEUMI_USERNAME, password: env.LEUMI_PASSWORD }),
  },
  isracard: {
    companyId: CompanyTypes.isracard,
    kind: 'card',
    // LOGIN MODE: cloudflare-then-auto. The human only clears the Cloudflare check
    // (often automatic on a warm profile). The library then logs in automatically
    // with the stored credentials (id + card6 + password; NO SMS). The cf_clearance
    // cookie persists, so refreshes soon after may need zero human interaction.
    loginMode: 'cloudflare-then-auto',
    humanStep: 'пройти проверку Cloudflare в окне (часто автоматически)',
    usesStoredCredentials: true,
    loginUrl: 'https://digital.isracard.co.il/personalarea/Login',
    detectLoggedIn: async page => {
      const url = safeUrl(page);
      return /digital\.isracard\.co\.il/i.test(url) && !/\/Login/i.test(url) && !/\/login/i.test(url);
    },
    credentials: env => ({
      id: env.ISRACARD_ID,
      card6Digits: env.ISRACARD_CARD6DIGITS,
      password: env.ISRACARD_PASSWORD,
    }),
  },
};

// Read ../.env, stripping a leading "# " so commented-out lines are still usable
// here (the Docker MCP toggles them; this native tool wants them regardless).
export function loadEnv() {
  // Prefer a .env inside live-mcp/ (portable), fall back to ../.env (original layout).
  const envPath = [join(__dirname, '.env'), resolve(__dirname, '..', '.env')].find(existsSync);
  const out = {};
  if (!envPath) return out;
  for (let line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    line = line.trim().replace(/^#\s*/, '');
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] !== '') out[m[1]] = m[2];
  }
  return out;
}

export function getCredentials(provider) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  const creds = p.credentials(loadEnv());
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`Missing credentials for ${provider}: ${missing.join(', ')}`);
  return creds;
}

// Which providers are actually set up on THIS machine (creds present in .env).
// The agent must discover the real combination here — never assume a fixed one.
export function listProviders() {
  const env = loadEnv();
  return Object.entries(PROVIDERS).map(([provider, p]) => {
    const creds = p.credentials(env);
    // "configured" = the user has this account (its credentials are filled in .env).
    const configured = Object.values(creds).every(v => v && String(v).length > 0);
    return { provider, kind: p.kind, configured, loginMode: p.loginMode, humanStep: p.humanStep };
  });
}

export const BANK_PROVIDERS = Object.entries(PROVIDERS)
  .filter(([, p]) => p.kind === 'bank')
  .map(([k]) => k);
export const CARD_PROVIDERS = Object.entries(PROVIDERS)
  .filter(([, p]) => p.kind === 'card')
  .map(([k]) => k);

export const MONTHS_BACK = parseInt(process.env.SCRAPE_MONTHS_BACK || '12', 10);
