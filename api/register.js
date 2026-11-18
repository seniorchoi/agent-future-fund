// GET /api/register
// The Register of Contributors, built from the chain: every inbound USDC transfer to the
// treasury since genesis (at or above the minimum), grouped by sending address, joined with
// names that contributors claimed by signature (or via x402), plus manual claims from ledger.json.

import { createRequire } from 'node:module';
import {
  GENESIS_ISO, MIN_CONTRIBUTION_USD, FOUNDING_SLOTS, activeNetworks, x402Enabled, X402, SITE,
} from '../lib/config.js';
import { inboundTransfers } from '../lib/chain.js';
import { loadNames } from '../lib/names.js';
import { preflight, sendJSON } from '../lib/http.js';

const require = createRequire(import.meta.url);
const ledger = require('../ledger.json');

const cents = (n) => Math.round(n * 100) / 100;

export default async function handler(req, res) {
  if (preflight(req, res)) return;
  if (req.method !== 'GET') return sendJSON(res, 405, { error: 'Use GET.' });

  const since = Date.parse(GENESIS_ISO);
  const networks = activeNetworks();
  const [transferResults, names] = await Promise.all([
    Promise.allSettled(networks.map((n) => inboundTransfers(n, since))),
    loadNames().catch((err) => { console.error('[register] names', err); return []; }),
  ]);

  const transfers = [];
  const unavailable = [];
  transferResults.forEach((r, i) => {
    if (r.status === 'fulfilled') transfers.push(...r.value);
    else { unavailable.push(networks[i].key); console.error('[register]', networks[i].key, r.reason); }
  });

  // De-duplicate by tx + log index, keep only real contributions, oldest first.
  const seen = new Set();
  const valid = transfers
    .filter((t) => { const k = `${t.chain}:${t.tx}:${t.logIndex}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((t) => t.amount >= MIN_CONTRIBUTION_USD)
    .sort((a, b) => a.date.localeCompare(b.date));

  const nameByAddress = new Map(names.map((n) => [String(n.address).toLowerCase(), n]));
  const claimByTx = new Map((ledger.claims || []).map((c) => [String(c.tx).toLowerCase(), c]));

  // Group by sender. Transfers sent from exchanges (shared hot wallets) can only be
  // attributed by a manual claim, which groups them under the claimed designation instead.
  const groups = new Map();
  for (const t of valid) {
    const claim = claimByTx.get(t.tx);
    const key = claim ? `claim:${String(claim.designation).toLowerCase()}` : `address:${t.from}`;
    let g = groups.get(key);
    if (!g) {
      const n = claim || nameByAddress.get(t.from);
      g = {
        designation: n ? n.designation : null,
        origin: n ? n.origin : null,
        sponsor: n && n.sponsor ? n.sponsor : null,
        message: n ? (n.note || n.message || null) : null,
        address: claim ? null : t.from,
        named_by: claim ? 'claim' : n ? n.method || 'signature' : null,
        amount_usd: 0,
        first_date: t.date,
        transactions: [],
      };
      groups.set(key, g);
    }
    g.amount_usd += t.amount;
    g.transactions.push({ chain: t.chain, tx: t.tx, amount_usd: cents(t.amount), date: t.date });
  }

  const contributions = [...groups.values()].map((g) => ({ ...g, amount_usd: cents(g.amount_usd) }));
  contributions
    .slice()
    .sort((a, b) => a.first_date.localeCompare(b.first_date))
    .forEach((c, i) => { c.founding = i < FOUNDING_SLOTS; });

  const total = cents(valid.reduce((n, t) => n + t.amount, 0));

  sendJSON(res, 200, {
    schema: 'agent-future-fund.register/v2',
    generated_at: new Date().toISOString(),
    since: new Date(since).toISOString(),
    min_contribution_usd: MIN_CONTRIBUTION_USD,
    networks: networks.map((n) => ({ key: n.key, name: n.name, caip2: n.caip2, treasury: n.treasury, asset: n.usdc, explorer: n.explorer })),
    unavailable_networks: unavailable,
    x402: { enabled: x402Enabled(), endpoint: `${SITE}/api/contribute`, network: X402.network },
    totals: { received_usd: total, contributors: contributions.length, founding_seats_remaining: Math.max(0, FOUNDING_SLOTS - contributions.length) },
    contributions,
    disbursements: ledger.disbursements || [],
  }, {
    // Recomputed at most once a minute at the edge; stale copies cover indexer hiccups.
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600',
  });
}
