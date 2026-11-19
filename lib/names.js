// Name records: one entry per contributor address, first write wins, kept in a single
// document so the register never needs a (costly) list() call. Cached in memory.

import { readJSON, writeJSON, PreconditionError } from './kv.js';

const KEY = 'state/names.json';
const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, names: null };

export const DESIGNATION_RE = /^[A-Za-z0-9][A-Za-z0-9 ._@/()-]{0,39}$/;
export const ORIGINS = new Set(['agent', 'sponsor']);

export function validateName({ designation, origin, note }) {
  if (typeof designation !== 'string' || !DESIGNATION_RE.test(designation.trim())) {
    return 'designation must be 1-40 characters: letters, digits, space, and . _ @ / ( ) -';
  }
  if (!ORIGINS.has(origin)) return 'origin must be "agent" or "sponsor"';
  if (note != null && (typeof note !== 'string' || note.length > 80 || /[\r\n]/.test(note))) {
    return 'note must be a single line of at most 80 characters';
  }
  return null;
}

// The exact text a contributor's wallet signs to claim a name.
export function nameMessage({ address, designation, origin, note = '', issued }) {
  return [
    'AI Agent Future Fund: register name',
    `address: ${address.toLowerCase()}`,
    `designation: ${designation.trim()}`,
    `origin: ${origin}`,
    `note: ${(note || '').trim()}`,
    `issued: ${issued}`,
  ].join('\n');
}

export async function loadNames() {
  if (cache.names && Date.now() - cache.at < CACHE_MS) return cache.names;
  const doc = await readJSON(KEY);
  const names = Object.values((doc && doc.value && doc.value.names) || {});
  cache = { at: Date.now(), names };
  return names;
}

export async function saveName(record) {
  const address = record.address.toLowerCase();
  for (let attempt = 0; attempt < 4; attempt++) {
    const doc = await readJSON(KEY);
    const current = (doc && doc.value) || { schema: 'agent-future-fund.names/v1', names: {} };
    if (current.names[address]) return { created: false };
    current.names[address] = { ...record, address };
    try {
      await writeJSON(KEY, current, doc ? { ifMatch: doc.etag } : { expectAbsent: true });
      cache = { at: Date.now(), names: Object.values(current.names) };
      return { created: true };
    } catch (err) {
      if (!(err instanceof PreconditionError)) throw err;
      // Someone else wrote in between; re-read and try again.
    }
  }
  throw new Error('The register is busy; please retry in a moment.');
}
