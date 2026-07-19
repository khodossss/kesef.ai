# kesef.ai

**Smart, private analysis of your real bank data — right inside Claude Code.**

kesef.ai pulls your Israeli‑bank balances and transactions into Claude so you can ask for the
kind of analysis a spreadsheet won't give you: spending **broken down by category**, recurring
**subscriptions**, month‑over‑month **trends**, "how much can I actually spend right now", and —
in **family mode** — the same picture across a whole household. Claude does the reasoning over
your data; the connector is just the plumbing that gets real, up‑to‑date figures to it.

It's a **local, read‑only** MCP connector with a **user‑assisted, live‑browser login** — it gets
past the defenses that break headless scraping (Hapoalim's 2FA, Isracard's Cloudflare). Everything
runs on your own machine. It never moves money — read‑only, always.

## What it's for

The connector's job is to land accurate data locally; the value is what you then ask Claude:

- **Spending by category** — "how much did I spend in July, by category?"
- **Subscriptions & recurring charges** — "what am I paying for every month?"
- **Trends & comparisons** — "compare June vs July", "is my grocery spend growing?"
- **Real available money** — "how much can I actually spend?" (balance minus upcoming card bills).
- **Household view** — the same questions across the family: per‑member breakdown + a joint total.

Run the `/finance-report` command for a structured report, or just ask in plain language.

## How it works

- **Hapoalim** — a Chrome window opens; your username and password are **auto‑filled** and
  the login button is clicked for you. You type **only the SMS one‑time code (OTP)**. Data
  is read from the **live authenticated session** via the bank's internal API (2FA can't be
  automated).
- **Isracard** — a Chrome window opens; you clear the **Cloudflare** check. Then
  `israeli-bank-scrapers-core` logs in on its own (id + last 6 card digits + password, no
  OTP) and extracts the data.
- **Leumi** — a window opens; the library logs in **by itself** (username + password, no
  OTP). A human is needed only if a rare challenge appears.

Results are stored in a local SQLite file (`data/bank.db`); every later query reads from
there — no browser, no re‑login. Refreshes upsert and de‑duplicate, so history accumulates.

## Requirements

- **Node ≥ 22** (uses the built‑in `node:sqlite`; tested on Node 24).
- System **Google Chrome** (or Edge). No Chromium download.
- Bank credentials in a git‑ignored root `.env`: Isracard (`ISRACARD_ID`,
  `ISRACARD_CARD6DIGITS`, `ISRACARD_PASSWORD`), Hapoalim (`HAPOALIM_USERCODE`,
  `HAPOALIM_PASSWORD`), Leumi (`LEUMI_USERNAME`, `LEUMI_PASSWORD`). The Hapoalim SMS code is
  typed in the browser and **never stored**.

Fill in only the banks you actually have — the server discovers the configured set from
`.env`.

## Setup

Full step‑by‑step install is in **[START.md](START.md)**. Then, depending on how you use it:

- **[SOLO.md](SOLO.md)** — one person, analysis of your own finances.
- **[FAMILY.md](FAMILY.md)** — household mode for several people.

## MCP tools (Claude Code server `kesef`)

- `providers()` — which banks/cards are configured on **this** machine (from `.env`) and
  their login mode. Call this first — the set differs per machine.
- `refresh({provider, monthsBack?})` — opens the browser, you complete the human step, data
  is updated in the DB. Interactive, up to a few minutes.
- `warmup(provider)` — one‑time manual login with "trust this device" (for banks like Leumi)
  so later `refresh` runs go through without OTP/Cloudflare.
- `list_accounts({provider?, scope?})` — accounts/cards with the latest balance.
- `get_transactions({provider?, from?, to?, search?, limit?, scope?})` — stored transactions.
- `status()` — when each provider was last refreshed and how many rows are stored.
- `reconcile({from?, to?, scope?})` — concrete balance reconciliation: `currentBalance`,
  `pendingCardBill`, `availableBalance`, and a period ledger. The balance moves via lump card
  **repayments**, not the itemized purchases — the two are different numbers, never summed.

**Family tools:** `family_create`, `family_join`, `family_leave`, `family_status`,
`family_sync` (see below). The `scope` argument on the read tools is `own` (default, this
machine) or `household` (the whole family).

## Family mode (household budget)

Each family member runs their own connector on their own machine and refreshes **their own**
accounts. Reports can then be produced over your own accounts (`scope: own`) or the whole
household (`scope: household`) — with a per‑member section plus a household total, and each
member's last‑refresh time shown so you never trust stale figures.

Between machines, only a **snapshot** travels: derived balances, transactions and
refresh metadata — **never credentials, cookies, or passwords**. Reconciliation runs **per
member and is then summed**; card repayments are matched to a bank only within one member, so
figures can't be double‑counted across people.

There are two storage modes; pick one:

|               | `local`                                         | `relay`                                                             |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| Shared medium | a folder you sync yourself (OneDrive/Dropbox/…) | a Cloudflare Worker you deploy once                                 |
| Joining       | point at the same folder                        | paste a token                                                       |
| Encryption    | plaintext files in **your** folder              | **end‑to‑end** AES‑256‑GCM                                          |
| Manual work   | you sync the folder                             | none                                                                |
| Setup         | works today, nothing to deploy                  | one‑time `wrangler deploy` (see [relay/README.md](relay/README.md)) |

Typical relay flow: one person runs `family_create` → gets a **token** → shares it privately;
the others run `family_join <token>`. After each `refresh`, the snapshot syncs automatically.

## Why it's safe

Security is the point of the design, not an afterthought:

- **Your credentials never leave your machine.** Bank passwords live only in your local,
  git‑ignored `.env`; the Hapoalim SMS code is typed in the browser and stored nowhere. None
  of this is ever part of what's shared with family members.
- **Shared snapshots contain no secrets.** A snapshot is only derived financial data
  (balances + transactions + timestamps). No passwords, no session cookies, no `.env`.
- **Relay mode is end‑to‑end encrypted and zero‑knowledge.** Snapshots are sealed with
  AES‑256‑GCM using a key derived from your family **token**, which never leaves your
  machines. The relay stores only ciphertext plus a verifier that **cannot** decrypt anything
  — so even if the relay were fully compromised, your transactions stay unreadable.
- **Local mode touches no third party.** Snapshots are plain files in a folder you control
  and sync yourself; nothing is uploaded anywhere.
- **The family token is treated as a credential** — kept in `.env`, redacted in logs, never
  printed to the protocol stream. Whoever holds it is "in the family," so share it privately.
- **Strictly read‑only.** No payments, no transfers — in solo or family mode, ever.

In short: solo mode is fully local; family mode shares only credential‑free figures, and in
relay mode even those are encrypted before they leave your machine.

## Project structure

- `config.mjs` — Chrome discovery, browser profiles, provider table, `.env` loading.
- `src/server.mjs` — MCP stdio server; declares the tools.
- `src/refresh.mjs` — per‑provider refresh strategy + warmup.
- `src/extractors/hapoalim.mjs` — Hapoalim extraction from the live session.
- `src/fetch-helpers.mjs` — in‑page `fetch` inside the authenticated page.
- `src/store.mjs` — SQLite store (`node:sqlite`): upsert/dedup, `reconcile`, snapshot export.
- `src/household/` — family core: `token`, `crypto` (E2E seal/open), `identity`, `stores`
  (local + relay), `merge` (per‑member household reconcile), `index` (family ops).
- `relay/` — the zero‑knowledge Cloudflare Worker + deploy docs (separate, one‑time deploy).

## Privacy

Everything is on your machine. Session profiles (`profiles/`), data (`data/`) and credentials
(`.env`) are all git‑ignored. Read‑only; no payments. See **Why it's safe** above for the
family‑mode details.
