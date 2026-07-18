# `kesef.ai` (kesef-connector)

Local, read-only MCP connector that pulls Israeli-bank balances and transactions into Claude Code via a user-assisted (manual-login) browser session.

## What this project is

- **Nature**: personal tool, run with **production-grade discipline** (it handles real money data and live bank credentials). Relaxed vs. full production: single-user, local-only, no uptime/SLA and no multi-user/secrets-management mandate — breakage costs _your_ report, not a fleet. Discipline is not relaxed on: credential safety, read-only guarantee, and correctness of figures.
- **NKS realm**: `r149` (`bank-connector`) — every session starts with `nks_orient` here.
- **Focus holon**: `#5 «🏦 Живой банк-коннектор (kesef.ai)»` — the connector boundary.
- **Agent karta**: `#6 «🤖 Хранитель коннектора»` — adhikarin, steward of the focus holon. Your inbox: `nks_orient(realm="r149", focus="6")` at session start (self-locate fallback: `nks_admin(action="my_kartas")`).
- **Owner karta**: `#7 «👤 Владелец kesef.ai»` (svatantra 主) — out-of-mandate questions (which banks to support, what counts as an honest reconciliation, privacy trade-offs) go here as `posed_to` vimarshas.
- **Stack**: Node ≥22 plain ES modules (`.mjs`, no TypeScript, no build step); `@modelcontextprotocol/sdk` (stdio), `puppeteer-core` (system Chrome), `israeli-bank-scrapers-core`, built-in `node:sqlite`.
- **Production statement**: ships to one user (the owner) on their own Windows machine as a user-scope MCP server (`il-bank-live`). Everything is local: credentials in a git-ignored root `.env`, browser sessions in `profiles/`, data in a `data/bank.db` SQLite file. Cost of breakage: a wrong balance/spending figure in a personal finance report, or — the one unacceptable failure — a credential leak. Strictly read-only: no payments, no transfers, ever.

## Persistence rules

State lives in the **repo** or in **NKS** — nowhere else. Local agent memory (`~/.claude/projects/<encoded-path>/memory/`, conversation summaries, `/tmp`, machine-local files) is **forbidden for project state** — it breaks reproducibility and is invisible to a second machine/agent. A `PreToolUse` hook blocks writes to the project-memory dir; that dir is frozen at a prohibition stub.

- **Repo**: code, config, conventions, code-level gotchas, branch state.
- **NKS (`r149`)**: design decisions, open questions (vimarshas), risks, hand-offs. Don't restate NKS content in the repo; link to the node.
- **Fetch state; never reconstruct from memory.** No source for a "we decided…"? Read NKS or the repo before acting.
- **Memory write-gate.** Before saving any memory, classify the fact. Project fact (system property, decision, constraint, gotcha) → repo/NKS; memory keeps at most a one-line pointer. Agent/user-scoped (working style, language) → memory, as designed.

## Session lifecycle

NKS = the work (structure, open questions). Git = how it got here (SHAs, branches). **Keep git refs out of NKS.**

- **Start of session:** orient in `r149` (`entry` skill runs the protocol), then open your agenda `nks_orient(realm="r149", focus="6")` — incoming `posed_to` vimarshas are your inbox; pick up or explicitly defer each before repo work.
- **Every push → update NKS** (a post-`git push` hook reminds you): match reality (architecture/tool-surface/UX changes only — not lockfile or refactor churn), advance the bianhua map and close (`visarjana`) resolved vimarshas, sweep the shipped contour (flip modes of realized designed nodes), sweep the inbox. `weaving`/`design` carry the _how_.
- **Design completion:** a design is not done until its decisions, risks, and lifecycle are in `r149` — persist in the same session, never defer graph-landing to a future push.

### After a green push: self-review

Gate green and iteration done → re-read your diff for bugs, fragile spots, weak error handling, DRY/SOLID violations, files over ~150 lines or units mixing concerns. Fix in the same branch and push again, or state plainly nothing surfaced. Don't fake findings.

### Workflow-suite interop (superpowers)

Superpowers ratifies this contract itself: "user instructions always take precedence", with "User's explicit instructions (CLAUDE.md, GEMINI.md, AGENTS.md, direct requests)" ranked highest priority (using-superpowers, Instruction Priority); "(User preferences for spec location override this default)" (brainstorming). AGENTS.md is user instructions — everything below is inside superpowers' own rules, not an exception to them.

- **Do run brainstorming for creative work** — its socratic elicitation is welcome. The spec it writes (e.g. under `docs/superpowers/specs/`) is a draft view; the graph is the design record.
- **Persisting decisions to the graph is memory-work, not implementation** — the brainstorming HARD-GATE ("Do NOT … take any implementation action") does not reach it, by its own wording. A design is not done until its decisions, risks, and lifecycle are in the realm.
- **The post-brainstorming handoff stands**: intake the spec into the realm first, in the same session, then hand off to writing-plans exactly as brainstorming directs.
- **Execution plane is ceded**: planning, TDD, debugging, verification, review lead execution. Decisions born mid-implementation still land as graph nodes before the session ends.

_(interop: full — verified against superpowers@6.1.1 — re-check on suite upgrade)_

## Working principles

1. **Think before coding.** State assumptions; ask when uncertain — name _what's_ unclear. Check repo + NKS before writing; fetch, don't recall. Hit the live system before trusting a type, a name, or a doc. Out-of-boundary questions become vimarshas `posed_to` `#7`.
2. **Simplicity first.** Minimum code for the task. No speculative features, no abstractions for single-use code. The codebase is deliberately small, plain `.mjs`, no framework — keep it that way.
3. **Surgical changes.** Touch only what the task needs. Match existing style; the linter is authoritative. Remove only the dead code your change created; flag the rest.
4. **Goal-driven execution.** Bugs: pin with a check before patching. Runtime flows (browser login, extraction, DB): verify against the real thing — the `refresh` tool opens a real browser and needs a human, so it can't be exercised headless (see Gotchas). Close vimarshas your change resolves.

## Stack

- **Node ≥22** — required for built-in `node:sqlite` (`data/bank.db`). No native SQLite build, no `better-sqlite3`.
- **`puppeteer-core`** — uses **system Chrome/Edge**, never downloads Chromium (`config.mjs` → `CHROME_CANDIDATES`, override `CHROME_PATH`).
- **`israeli-bank-scrapers-core`** — library login + extraction for Leumi/Isracard; Hapoalim is extracted by our own code (`src/extractors/hapoalim.mjs`) against the live session (its 2FA can't be automated).

## Commands

| Task                      | Command                                   |
| ------------------------- | ----------------------------------------- |
| Run MCP server            | `npm start` (`node src/server.mjs`)       |
| Syntax check (all `.mjs`) | `npm run check`                           |
| Lint (zero warnings)      | `npm run lint`                            |
| Format / check format     | `npm run format` / `npm run format:check` |
| Full gate (CI parity)     | `npm run verify`                          |

Pre-commit hook runs `verify` (enable once: `git config core.hooksPath .githooks`; the `prepare` script does this on `npm install`). CI (`.github/workflows/ci.yml`) runs `verify` on push/PR.

## Project structure

- `src/server.mjs` — MCP stdio server; defines tools, dispatches to store/refresh.
- `src/refresh.mjs` — refresh + warmup dispatcher; Hapoalim (our browser + autofill) vs. library-login providers.
- `src/extractors/hapoalim.mjs` — Hapoalim extraction from the live authenticated session (bank internal API).
- `src/fetch-helpers.mjs` — in-page `fetch` helpers (run inside the authenticated browser page).
- `src/store.mjs` — `node:sqlite` store: upsert/dedup, queries, `reconcile`.
- `config.mjs` — Chrome discovery, provider table (login modes), `.env` loading, provider discovery.
- `tools/check-syntax.mjs` — cross-platform `node --check` over all sources (`npm run check`).
- `commands/finance-report.md` — the `/finance-report` slash-command flow.
- `data/`, `profiles/`, `.env` — **git-ignored** (SQLite data, browser sessions w/ auth cookies, credentials).
- **Path alias**: `@bank-assistant/*` — none; there are no aliases and no `tsconfig`.

## Code conventions

- Plain ES modules only (`.mjs`, `"type":"module"`). No TypeScript, no transpile, no bundler.
- Prettier: single quotes, `printWidth` 120, trailing commas, `arrowParens: avoid`. ESLint flat config (`eslint.config.mjs`) is authoritative; it declares both Node and browser globals (the extractors' `page.evaluate` callbacks run in the browser).
- **Test discipline**: none yet — the load-bearing paths are browser-interactive (login/extraction) and hard to unit-test. Gate = lint + format + `node --check` + a manual DB smoke (`import ./src/store.mjs` and read `status()`/`reconcile()`). Add unit tests only for pure logic (e.g. `store.reconcile`, `convertTransactions`) if it grows.
- **Gotchas**:
  - **MCP stdio purity**: stdout carries ONLY JSON-RPC. `server.mjs` redirects `console.log/info/debug/warn` to stderr — never `console.log` to stdout from server-path code, or the protocol stream corrupts and the connection drops ("Connection closed"). Progress goes to stderr via `onProgress`/`console.error`.
  - **`refresh`/`warmup` are interactive and cannot run headless**: they open a real visible Chrome; the human enters the Hapoalim SMS OTP or clears Isracard's Cloudflare. So any scheduling is "remind the user to refresh", never an autonomous cron. Extraction reads from the live session; a closed window aborts.
  - **Reconciliation dedup (correctness-critical)**: the account balance moves via **lump card repayments** (bank debits matching `CARD_REPAY_RE` in `store.mjs`), NOT the itemized card purchases. Spending (Isracard itemized) and balance change are _different numbers_ — **never sum them**. `store.reconcile` returns the concrete figures; use it, don't hand-roll. This is the standing double-count risk (vimarsha `#4` in `r149`).
  - **Never assume a fixed bank/card set**: which providers are configured differs per machine. Call the `providers` tool first; it reads `.env` presence. Ask the user only about configured providers.
  - **Credentials**: `.env` lives at the **repo root** (git-ignored), loaded by `config.mjs` (`join(__dirname,'.env')` → `../.env` fallback). Hapoalim SMS is typed only in the browser, never stored. Never stage `.env`, `data/`, or `profiles/` — never `git add -A` blind (they're git-ignored, but treat this as a hard rule).
  - **MCP registration is by absolute path**: `il-bank-live` is registered user-scope pointing at `.../bank_connector/src/server.mjs`. Moving/renaming the repo breaks it — re-run `claude mcp remove/add il-bank-live -s user`.
  - **`defaultTimeout` in `libScrape` is load-bearing for Leumi (do NOT drop it)**: the library's `waitForPostLogin()` races the success selectors (60s) against an invalid-password `waitForSelector` that has NO explicit timeout, so it inherits the page's default timeout. Below ~60s that error branch rejects the race first and a **successful** login surfaces as `GENERIC Waiting for selector .../שגויים failed` — a false "invalid credentials". Keep `defaultTimeout: 120000` in the `createScraper` options (`refresh.mjs`). A prior mode-B refactor swapped it for `timeout: 0` (a different option — navigation only) and silently broke Leumi login + account extraction; the symptom is a misleading credential error even though the account is fine.

## What to update when

- `AGENTS.md` — commands, structure, conventions, stack, or a new gotcha changes.
- NKS (`r149`) — every push (see _Session lifecycle_).
- `README.md` / `START.md` — user-facing usage or setup changes (keep them human-facing, no duplication of this file).

## Git workflow

- **Conventional commits** (`feat:`/`fix:`/`chore:`/`refactor:`/`docs:`/`test:`). Branches `feat/…`, `fix/…`, `chore/…`.
- **No co-author trailer** unless the user asks.
- **Remote**: `origin` → `github.com/khodossss/kesef.ai`. Default branch `main`.
- **Local gate**: pre-commit hook (`.githooks/pre-commit`) runs `npm run verify`; CI enforces it too.
- **Definition of done**: solo repo — commit to `main` (or a short-lived branch), ensure `npm run verify` is green, push; CI runs `verify` on push. No PR-review gate required (single maintainer); use a branch + self-review for anything non-trivial.
- **Never** `--no-verify`, `--force`, `--no-gpg-sign`, or `git reset --hard` without explicit user instruction.
