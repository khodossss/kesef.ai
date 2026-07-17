// MCP server (stdio) for the user-assisted Israeli-bank connector.
// Tools: refresh (interactive, opens a browser), and read-only queries over the
// local SQLite store. Only JSON-RPC goes to stdout; progress goes to stderr.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { refresh, warmup } from './refresh.mjs';
import * as store from './store.mjs';
import { inspect } from 'node:util';
import { PROVIDERS, listProviders } from '../config.mjs';

// MCP stdio: stdout must carry ONLY JSON-RPC. Route any stray console.log/info/
// debug/warn (from puppeteer, the scraper library, or our code) to stderr so it
// can't corrupt the protocol stream and drop the connection ("Connection closed").
// MUST be bulletproof: it runs inside library code, so it must never throw (use
// util.inspect for circular objects, and swallow any write error). The SDK writes
// protocol frames via process.stdout directly, unaffected by this.
for (const m of ['log', 'info', 'debug', 'warn']) {
  console[m] = (...a) => {
    try {
      process.stderr.write(a.map(x => (typeof x === 'string' ? x : inspect(x))).join(' ') + '\n');
    } catch {
      /* never throw into caller */
    }
  };
}
// Never let a stray async error kill the server.
process.on('unhandledRejection', e => process.stderr.write(`[il-bank-live] unhandledRejection: ${e?.stack || e}\n`));
process.on('uncaughtException', e => process.stderr.write(`[il-bank-live] uncaughtException: ${e?.stack || e}\n`));

const PROVIDER_ENUM = Object.keys(PROVIDERS); // e.g. hapoalim, leumi, isracard

const TOOLS = [
  {
    name: 'providers',
    description:
      'List which providers are configured on THIS machine (credentials present) and their login mode. ALWAYS call this first — the bank/card combination differs per user; never assume a fixed set. Each entry: provider, kind (bank|card), configured, loginMode, humanStep. Ask the user only about configured providers.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'warmup',
    description:
      'One-time manual login for a provider. Opens a real browser; the user logs in and ticks "trust this device" (and passes Cloudflare for cards), then closes the window. Persists the trust/cf_clearance cookie in the profile so later refresh() runs go through without OTP/Cloudflare. Use this first for banks whose automated login needs a trusted device (e.g. Leumi), or when refresh reports a login failure. Blocks until the user closes the window.',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string', enum: PROVIDER_ENUM } },
      required: ['provider'],
    },
  },
  {
    name: 'refresh',
    description:
      'Fetch fresh balance + transactions for a provider. Opens a REAL browser window on the user’s screen; the user completes only the human step there (Hapoalim: enter the SMS OTP — user/password are auto-filled; Isracard: pass the Cloudflare check). Long-running (up to a few minutes). Data is stored locally.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: PROVIDER_ENUM, description: 'Which provider to refresh' },
        monthsBack: { type: 'number', description: 'How many months of history (default 12)' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'list_accounts',
    description:
      'List stored accounts/cards with their latest balance and when they were last updated. Reads local data only — no browser.',
    inputSchema: { type: 'object', properties: { provider: { type: 'string', enum: PROVIDER_ENUM } } },
  },
  {
    name: 'get_transactions',
    description:
      'Query stored transactions. Filters: provider, from/to (ISO date), search (matches description/memo), limit. Reads local data only — no browser.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: PROVIDER_ENUM },
        from: { type: 'string', description: 'ISO date lower bound (transaction date)' },
        to: { type: 'string', description: 'ISO date upper bound' },
        search: { type: 'string', description: 'substring in description/memo' },
        limit: { type: 'number', description: 'max rows (default 500)' },
      },
    },
  },
  {
    name: 'status',
    description: 'Show, per provider, when data was last refreshed and how many accounts/transactions are stored.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'reconcile',
    description:
      'Concrete balance reconciliation. Returns currentBalance, pendingCardBill (recent card purchases not yet debited), and availableBalance (= balance − upcoming bill). IMPORTANT: spending (Isracard itemized) is a DIFFERENT number from the balance change — the balance moves via lump card repayments, never sum both. Pass from/to for a period ledger check (implied start balance, repayments vs consumption). Use this whenever reporting balance/spending so figures are concrete.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO date lower bound for the ledger check' },
        to: { type: 'string', description: 'ISO date upper bound for the ledger check' },
      },
    },
  },
];

const server = new Server({ name: 'il-bank-live', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

const text = obj => ({
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }],
});

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args = {} } = request.params;
  try {
    switch (name) {
      case 'providers':
        return text(listProviders());
      case 'warmup': {
        if (!PROVIDER_ENUM.includes(args.provider))
          throw new Error(`provider must be one of: ${PROVIDER_ENUM.join(', ')}`);
        return text(await warmup(args.provider, { onProgress: m => console.error(`[warmup:${args.provider}] ${m}`) }));
      }
      case 'refresh': {
        const provider = args.provider;
        if (!PROVIDER_ENUM.includes(provider)) throw new Error(`provider must be one of: ${PROVIDER_ENUM.join(', ')}`);
        const onProgress = m => console.error(`[refresh:${provider}] ${m}`);
        const result = await refresh(provider, { monthsBack: args.monthsBack, onProgress });
        const saved = store.save(result, new Date().toISOString());
        return text({
          ok: true,
          provider,
          ...saved,
          note: 'stored locally; query with get_transactions / list_accounts',
        });
      }
      case 'list_accounts':
        return text(store.listAccounts(args.provider));
      case 'get_transactions':
        return text(store.getTransactions(args));
      case 'status':
        return text(store.status());
      case 'reconcile':
        return text(store.reconcile(args));
      default:
        throw new Error(`unknown tool: ${name}`);
    }
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error in ${name}: ${e.message}` }] };
  }
});

await server.connect(new StdioServerTransport());
console.error('[il-bank-live] MCP server ready (stdio)');
