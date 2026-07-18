# kesef relay (Cloudflare Worker)

Zero-knowledge store for family snapshots. Holds only the per-room verifier and
E2E-encrypted blobs — it can never read your transactions.

## Deploy once (the owner)

1. `npm i -g wrangler` and `wrangler login`.
2. `wrangler kv namespace create ROOMS` → copy the `id` into `wrangler.toml`.
3. `wrangler deploy` → note the `https://kesef-relay.<you>.workers.dev` URL.
4. Put that URL in `RELAY_URL` in each machine's `.env` (or set `DEFAULT_RELAY_URL` in `config.mjs`).

## Local test

`wrangler dev` then point `RELAY_URL` at `http://127.0.0.1:8787`.

## What it stores

- `room:<hid>:verifier` — HMAC of the token secret (cannot decrypt).
- `room:<hid>:member:<mid>` — AES-256-GCM sealed snapshot. Max 5 MB.
