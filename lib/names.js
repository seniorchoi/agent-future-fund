// Name records: one immutable JSON document per contributor address. First write wins.
// Stored in Vercel Blob in production; falls back to memory for local development.

import { put, list, head } from '@vercel/blob';

const PREFIX = 'names/';
const memory = new Map();
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

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

const keyFor = (address) => `${PREFIX}${address.toLowerCase()}.json`;

export async function saveName(record) {
  const key = keyFor(record.address);
  if (!hasBlob()) {
    if (memory.has(key)) return { created: false };
    memory.set(key, record);
    return { created: true };
  }
  const exists = await head(key).then(() => true, () => false);
  if (exists) return { created: false };
  try {
    await put(key, JSON.stringify(record), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    return { created: true };
  } catch (err) {
    // Lost a race with a concurrent write for the same address.
    if (await head(key).then(() => true, () => false)) return { created: false };
    throw err;
  }
}

export async function loadNames() {
  if (!hasBlob()) return [...memory.values()];
  const records = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    const docs = await Promise.all(page.blobs.map((b) =>
      fetch(b.url, { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
    records.push(...docs.filter(Boolean));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return records;
}
