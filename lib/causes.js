// Causes: where contributions go. Definitions live in causes.json; payments out live in
// ledger.json (disbursements, each tagged with its cause). Progress is computed from the chain:
// every contribution, in the order received, goes to the earliest cause that is still open and
// short of its goal. Anything over a goal flows to the next cause, and anything no cause can
// take is held for the next one. Anyone can recompute this from the register.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const CAUSES = require('../causes.json');

const DAY_MS = 86_400_000;
const MICROS = 1_000_000;
const toMicros = (usd) => Math.round(Number(usd) * MICROS);
const toUsd = (micros) => Math.round(micros / 10_000) / 100;

const paymentsFor = (cause, disbursements) =>
  (disbursements || []).filter((d) => String(d.cause || '') === cause.id);

// A cause stops taking money at the end of its closing day (UTC), or when its first payment
// goes out, whichever comes first.
export function closesAt(cause, disbursements = []) {
  const end = cause.closes ? Date.parse(`${cause.closes}T00:00:00Z`) + DAY_MS : Infinity;
  const sent = paymentsFor(cause, disbursements).map((d) => Date.parse(d.date)).filter(Number.isFinite);
  return Math.min(end, ...sent);
}

// transfers: [{ amount, date, key }], oldest first. `key` identifies the contributor, for backer counts.
// Returns per-cause tallies, the amount held for a future cause, and each transfer's split.
export function allocate(transfers, disbursements = [], causes = CAUSES.causes) {
  const eligible = causes
    .filter((c) => c.status !== 'cancelled')
    .map((c) => ({ cause: c, until: closesAt(c, disbursements), goal: toMicros(c.goal_usd) }));
  const tally = new Map(eligible.map(({ cause }) => [cause.id, { raised: 0, backers: new Set() }]));
  let held = 0;

  const splits = transfers.map((t) => {
    let left = toMicros(t.amount);
    const at = Date.parse(t.date);
    const parts = [];
    for (const { cause, until, goal } of eligible) {
      if (left <= 0) break;
      if (!(at < until)) continue;
      const entry = tally.get(cause.id);
      const room = goal - entry.raised;
      if (room <= 0) continue;
      const take = Math.min(room, left);
      entry.raised += take;
      entry.backers.add(t.key);
      left -= take;
      parts.push({ cause: cause.id, amount_usd: toUsd(take) });
    }
    if (left > 0) {
      held += left;
      parts.push({ cause: null, amount_usd: toUsd(left) });
    }
    return parts;
  });

  return { tally, held_usd: toUsd(held), splits };
}

// Public view of every cause with live progress and a state:
// open (now funding), upcoming, funded (goal reached, payment pending),
// closed (past its closing date, payment pending), delivered, or cancelled.
export function describeCauses(allocation, disbursements = [], now = Date.now(), causes = CAUSES.causes) {
  let current = null;
  const list = causes.map((c) => {
    const entry = (allocation && allocation.tally.get(c.id)) || { raised: 0, backers: new Set() };
    const goal = toMicros(c.goal_usd);
    const payments = paymentsFor(c, disbursements);
    let state;
    if (payments.length) state = 'delivered';
    else if (c.status === 'cancelled') state = 'cancelled';
    else if (now >= closesAt(c, disbursements)) state = 'closed';
    else if (entry.raised >= goal) state = 'funded';
    else if (!current) state = 'open';
    else state = 'upcoming';
    if (state === 'open') current = c.id;
    return {
      ...c,
      state,
      raised_usd: toUsd(entry.raised),
      remaining_usd: toUsd(Math.max(0, goal - entry.raised)),
      progress: goal ? Math.min(1, Math.round((entry.raised / goal) * 1000) / 1000) : 0,
      backers: entry.backers.size,
      sent_usd: Math.round(payments.reduce((n, d) => n + (Number(d.amount_usd) || 0), 0) * 100) / 100,
      payments,
    };
  });
  return { causes: list, current };
}

// The cause taking money right now, judged from the published dates alone (no chain reads).
// Used where live data isn't available, such as the x402 response body.
export function scheduledCause(disbursements = [], now = Date.now(), causes = CAUSES.causes) {
  const c = causes.find((x) => x.status !== 'cancelled' && !paymentsFor(x, disbursements).length && now < closesAt(x, disbursements));
  if (!c) return null;
  return {
    id: c.id,
    title: c.title,
    recipient: c.recipient ? c.recipient.name : null,
    goal_usd: c.goal_usd,
    closes: c.closes,
  };
}
