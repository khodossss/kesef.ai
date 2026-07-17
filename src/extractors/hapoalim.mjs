// Hapoalim extraction from an already-authenticated page.
// Ported from israeli-bank-scrapers' hapoalim.js (fetchAccountData path), but
// driven against the live session instead of the library's automated login —
// which cannot pass Hapoalim's device 2FA in headless.

import { randomUUID } from 'node:crypto';
import { fetchGetWithinPage, fetchPostWithinPage } from '../fetch-helpers.mjs';

const BASE_URL = 'https://login.bankhapoalim.co.il';
const DATE = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

function convertTransactions(txns = []) {
  return txns.map(txn => {
    const isOutbound = txn.eventActivityTypeCode === 2;
    const amount = isOutbound ? -txn.eventAmount : txn.eventAmount;
    const memoLines = [];
    const b = txn.beneficiaryDetailsData;
    if (b) {
      if (b.partyHeadline) memoLines.push(b.partyHeadline);
      if (b.partyName) memoLines.push(`${b.partyName}.`);
      if (b.messageHeadline) memoLines.push(b.messageHeadline);
      if (b.messageDetail) memoLines.push(`${b.messageDetail}.`);
    }
    return {
      identifier: txn.referenceNumber,
      date: dateFromYmd(txn.eventDate),
      processedDate: dateFromYmd(txn.valueDate),
      originalAmount: amount,
      originalCurrency: 'ILS',
      chargedAmount: amount,
      description: txn.activityDescription || '',
      status: txn.serialNumber === 0 ? 'pending' : 'completed',
      memo: memoLines.join(' '),
    };
  });
}

function dateFromYmd(ymd) {
  const s = String(ymd);
  return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00`).toISOString();
}

async function waitFor(fn, label, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function fetchTxnsXSRF(page, url) {
  const cookies = await page.cookies();
  const xsrf = cookies.find(c => c.name === 'XSRF-TOKEN');
  const headers = { 'Content-Type': 'application/json;charset=UTF-8', pageUuid: '/current-account/transactions', uuid: randomUUID() };
  if (xsrf) headers['X-XSRF-TOKEN'] = xsrf.value;
  return fetchPostWithinPage(page, url, [], headers);
}

// The user may be caught on the transient auth page before the portal SPA has
// settled; poll the accounts endpoint (re-reading restContext each try) until it
// returns an array, giving the app time to finish loading.
async function getAccounts(page, { tries = 160, delayMs = 3000, onWait } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const hasApp = await page.evaluate(() => !!window.bnhpApp).catch(() => false);
    if (hasApp) {
      const restContext = (await page.evaluate(() => window.bnhpApp.restContext).catch(() => ''))?.slice(1);
      const info = await fetchGetWithinPage(page, `${BASE_URL}/ServerServices/general/accounts`).catch(e => ({ __err: e.message }));
      if (Array.isArray(info) && info.length) return { apiSiteUrl: `${BASE_URL}/${restContext}`, accountsInfo: info };
      last = info;
    }
    if (onWait && i % 5 === 0) {
      const state = last?.state || (hasApp ? 'портал грузится' : 'жду страницу банка');
      onWait(state, Math.round(((tries - i) * delayMs) / 1000));
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`accounts not ready after ${tries} tries; last response: ${JSON.stringify(last)?.slice(0, 300)}`);
}

export async function extractHapoalim(page, { monthsBack = 12, onWait } = {}) {
  const { apiSiteUrl, accountsInfo } = await getAccounts(page, { onWait });

  const start = new Date();
  start.setMonth(start.getMonth() - monthsBack);
  const startStr = DATE(start);
  const endStr = DATE(new Date());

  const accounts = [];
  for (const acc of accountsInfo) {
    const accountNumber = `${acc.bankNumber}-${acc.branchNumber}-${acc.accountNumber}`;
    const isActive = acc.accountClosingReasonCode === 0;
    let balance;
    if (isActive) {
      const bal = await fetchGetWithinPage(
        page,
        `${apiSiteUrl}/current-account/composite/balanceAndCreditLimit?accountId=${accountNumber}&view=details&lang=he`,
      );
      balance = bal?.currentBalance;
    }
    const txnsUrl = `${apiSiteUrl}/current-account/transactions?accountId=${accountNumber}&numItemsPerPage=1000&retrievalEndDate=${endStr}&retrievalStartDate=${startStr}&sortCode=1`;
    const txnsResult = await fetchTxnsXSRF(page, txnsUrl);
    accounts.push({
      accountNumber,
      balance,
      currency: 'ILS',
      txns: convertTransactions(txnsResult?.transactions ?? []),
    });
  }
  return { provider: 'hapoalim', accounts };
}
