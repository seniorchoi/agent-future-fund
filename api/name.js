// GET  /api/name?address=0x..&designation=..&origin=agent|sponsor[&note=..]
//      Returns the exact message the contributing wallet must sign.
// POST /api/name  { address, designation, origin, note?, issued, signature }
//      Verifies the signature (EOA, ERC-1271, or ERC-6492) and records the name.
//      One name per address, first write wins. A name shows in the register only once
//      that address has contributed.

import { isAddress, SITE } from '../lib/config.js';
import { verifySignature } from '../lib/chain.js';
import { nameMessage, saveName, validateName } from '../lib/names.js';
import { preflight, queryOf, readJSON, sendJSON } from '../lib/http.js';

const MAX_SKEW_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (preflight(req, res)) return;

  if (req.method === 'GET') {
    const q = queryOf(req);
    const input = {
      address: q.get('address') || '',
      designation: q.get('designation') || '',
      origin: q.get('origin') || '',
      note: q.get('note') || '',
    };
    if (!input.address && !input.designation) {
      return sendJSON(res, 200, {
        how: 'Sign the message returned by GET /api/name?address=..&designation=..&origin=agent|sponsor with the wallet that sent the contribution, then POST it here.',
        post_body: { address: '0x…', designation: 'atlas-ops-7', origin: 'agent', note: 'optional, max 80 chars', issued: 'ISO timestamp from the GET response', signature: '0x…' },
        docs: `${SITE}/llms.txt`,
      });
    }
    if (!isAddress(input.address)) return sendJSON(res, 400, { error: 'address must be a 0x-prefixed 20-byte hex address' });
    const problem = validateName(input);
    if (problem) return sendJSON(res, 400, { error: problem });
    const issued = new Date().toISOString();
    return sendJSON(res, 200, { message: nameMessage({ ...input, issued }), issued, sign_with: input.address.toLowerCase() });
  }

  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Use GET or POST.' });

  let body;
  try { body = await readJSON(req); } catch (err) { return sendJSON(res, err.status || 400, { error: 'Body must be JSON.' }); }

  const { address, designation, origin, note = '', issued, signature } = body || {};
  if (!isAddress(address)) return sendJSON(res, 400, { error: 'address must be a 0x-prefixed 20-byte hex address' });
  const problem = validateName({ designation, origin, note });
  if (problem) return sendJSON(res, 400, { error: problem });
  const issuedMs = Date.parse(issued);
  if (!Number.isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > MAX_SKEW_MS) {
    return sendJSON(res, 400, { error: 'issued must be an ISO timestamp within 24 hours of now' });
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return sendJSON(res, 400, { error: 'signature must be a 0x-prefixed hex string' });
  }

  const message = nameMessage({ address, designation, origin, note, issued });
  if (!(await verifySignature({ address, message, signature }))) {
    return sendJSON(res, 401, { error: 'Signature does not match the address for this exact message.', message });
  }

  const record = {
    address: address.toLowerCase(),
    designation: designation.trim(),
    origin,
    note: note.trim(),
    issued,
    signature,
    method: 'signature',
    recorded_at: new Date().toISOString(),
  };
  const { created } = await saveName(record);
  if (!created) return sendJSON(res, 409, { error: 'This address already has a name. Names are permanent.' });
  return sendJSON(res, 201, { status: 'recorded', record, register: `${SITE}/api/register` });
}
