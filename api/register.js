// GET /api/register
// The Register of Contributors, built from the chain: every inbound USDC transfer to the
// treasury since genesis (at or above the minimum), grouped by sending address, joined with
// names that contributors claimed by signature (or via x402), plus manual claims from ledger.json.
// Also reports every cause with its live progress (see lib/causes.js for the allocation rule),
// the payments out, and the Fund's announcements.

import { createRequire } from 'node:module';
import {
  GENESIS_ISO, MIN_CONTRIBUTION_USD, FOUNDING_SLOTS, activeNetworks, x402Enabled, X402, SITE,
} from '../lib/config.js';
import { inboundTransfers } from '../lib/chain.js';
import { loadNames } from '../lib/names.js';
import { CAUSES, allocate, describeCauses, payoutAmountUsd } from '../lib/causes.js';
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
  const disbursements = ledger.disbursements || [];

  // Transfers sent from exchanges (shared hot wallets) can only be attributed by a manual
  // claim, which groups them under the claimed designation instead of the sending address.
  const keyOf = (t) => {
    const claim = claimByTx.get(t.tx);
    return claim ? `claim:${String(claim.designation).toLowerCase()}` : `address:${t.from}`;
  };

  // Split every contribution across causes, in the order received.
  const allocation = allocate(valid.map((t) => ({ amount: t.amount, date: t.date, key: keyOf(t) })), disbursements);
  const { causes, current } = describeCauses(allocation, disbursements);

  const groups = new Map();
  valid.forEach((t, i) => {
    const claim = claimByTx.get(t.tx);
    const key = keyOf(t);
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
        causes: [],
        transactions: [],
      };
      groups.set(key, g);
    }
    const split = allocation.splits[i];
    g.amount_usd += t.amount;
    for (const part of split) if (part.cause && !g.causes.includes(part.cause)) g.causes.push(part.cause);
    g.transactions.push({ chain: t.chain, tx: t.tx, amount_usd: cents(t.amount), date: t.date, causes: split });
  });

  const contributions = [...groups.values()].map((g) => ({ ...g, amount_usd: cents(g.amount_usd) }));
  contributions
    .slice()
    .sort((a, b) => a.first_date.localeCompare(b.first_date))
    .forEach((c, i) => { c.founding = i < FOUNDING_SLOTS; });

  const total = cents(valid.reduce((n, t) => n + t.amount, 0));
  const sent = cents(disbursements.reduce((n, d) => n + payoutAmountUsd(d), 0));

  sendJSON(res, 200, {
    schema: 'agent-future-fund.register/v3',
    generated_at: new Date().toISOString(),
    since: new Date(since).toISOString(),
    min_contribution_usd: MIN_CONTRIBUTION_USD,
    networks: networks.map((n) => ({
      key: n.key, name: n.name, caip2: n.caip2, treasury: n.treasury, asset: n.usdc, explorer: n.explorer,
      advertised: n.advertised !== false,
    })),
    unavailable_networks: unavailable,
    x402: { enabled: x402Enabled(), endpoint: `${SITE}/api/contribute`, network: X402.network },
    totals: {
      received_usd: total,
      sent_usd: sent,
      held_usd: allocation.held_usd,
      contributors: contributions.length,
      founding_seats_remaining: Math.max(0, FOUNDING_SLOTS - contributions.length),
    },
    current_cause: current,
    causes,
    cause_rules: CAUSES.rules,
    pre_payout: CAUSES.pre_payout || null,
    contributions,
    disbursements,
    announcements: CAUSES.announcements || [],
  }, {
    // Recomputed at most every 5 minutes at the edge (keeps Blob usage in the free tier);
    // stale copies cover indexer hiccups.
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800',
  });
}
