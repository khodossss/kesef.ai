// Launch a real, visible system Chrome with a per-provider persistent profile.
// Persistent so the session/cookies survive between login and later refreshes;
// visible so the user can complete 2FA / CAPTCHA themselves.

import puppeteer from 'puppeteer-core';
import { CHROME, profileDir } from '../config.mjs';

export async function launch(provider) {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: profileDir(provider),
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-first-run',
      '--no-default-browser-check',
      // reduce the obvious automation fingerprint (helps with bot detection)
      '--disable-blink-features=AutomationControlled',
    ],
  });
}

// Poll every provider tab until one looks logged-in, or time out.
// Logs each new URL it sees so login flow can be diagnosed.
export async function waitForLogin(browser, cfg, timeoutMs = 480000) {
  const start = Date.now();
  const seen = new Set();
  while (Date.now() - start < timeoutMs) {
    for (const p of await browser.pages()) {
      let url = '';
      try { url = p.url(); } catch { /* navigating */ }
      if (url && !seen.has(url)) { seen.add(url); console.log('[nav]', url); }
      try {
        if (await cfg.detectLoggedIn(p)) return p;
      } catch { /* page transient */ }
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}
