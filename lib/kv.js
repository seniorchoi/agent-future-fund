// Tiny JSON document store on Vercel Blob (memory fallback for local development).
//
// Built to stay inside the Hobby free tier (10k simple / 2k advanced operations a month):
// a read is one head() (simple) plus a fetch of an etag-versioned URL, which the CDN serves
// from cache until the document changes. Writes are conditional (ifMatch) so concurrent
// writers cannot silently overwrite each other.

import { put, head, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';

export class PreconditionError extends Error {}

const memory = new Map();
const hasBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

// Returns { value, etag }, or null if the document does not exist.
export async function readJSON(key) {
  if (!hasBlob()) {
    const doc = memory.get(key);
    return doc ? { value: structuredClone(doc.value), etag: doc.etag } : null;
  }
  let meta;
  try {
    meta = await head(key);
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
  const res = await fetch(`${meta.url}?etag=${encodeURIComponent(meta.etag)}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`blob read ${key}: HTTP ${res.status}`);
  return { value: await res.json(), etag: meta.etag };
}

// ifMatch: only write if the stored etag still matches. expectAbsent: only create.
export async function writeJSON(key, value, { ifMatch, expectAbsent } = {}) {
  if (!hasBlob()) {
    const current = memory.get(key);
    if ((ifMatch && (!current || current.etag !== ifMatch)) || (expectAbsent && current)) throw new PreconditionError(key);
    memory.set(key, { value: structuredClone(value), etag: `${Date.now()}-${Math.random()}` });
    return;
  }
  try {
    await put(key, JSON.stringify(value), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: !expectAbsent,
      cacheControlMaxAge: 60,
      ...(ifMatch ? { ifMatch } : {}),
    });
  } catch (err) {
    if (err instanceof BlobPreconditionFailedError) throw new PreconditionError(key);
    if (expectAbsent && /exist/i.test(String(err && err.message))) throw new PreconditionError(key);
    throw err;
  }
}
