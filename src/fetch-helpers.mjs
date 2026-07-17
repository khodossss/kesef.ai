// In-page fetch helpers — faithful ports of israeli-bank-scrapers' helpers/fetch.
// They run fetch() inside the authenticated browser page (credentials:'include'),
// so they reuse the live session established by the user's manual login.

export function fetchGetWithinPage(page, url) {
  return page.evaluate(
    innerUrl => fetch(innerUrl, { credentials: 'include' }).then(r => (r.status === 204 ? null : r.json())),
    url,
  );
}

export function fetchPostWithinPage(page, url, data, extraHeaders = {}) {
  return page.evaluate(
    (innerUrl, innerData, innerExtraHeaders) =>
      fetch(innerUrl, {
        method: 'POST',
        body: JSON.stringify(innerData),
        credentials: 'include',
        headers: Object.assign(
          { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          innerExtraHeaders,
        ),
      }).then(r => (r.status === 204 ? null : r.json())),
    url,
    data,
    extraHeaders,
  );
}
