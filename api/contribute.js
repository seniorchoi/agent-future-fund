// GET  /api/contribute  -> free description of the endpoint. Never charges.
// POST /api/contribute?amount=1&designation=atlas-ops-7&origin=agent[&note=...]
//      (the same fields may be sent as a JSON body instead of the query string)
// An x402 (v2) endpoint. Only a deliberate POST asks for payment, so an agent that merely
// looks at the URL with a payment-enabled client is never charged. An unpaid POST gets HTTP 402 with a PAYMENT-REQUIRED header
// describing a USDC payment on Base. The agent's own x402 client and wallet policy decide
// whether to pay. A paid retry (PAYMENT-SIGNATURE header) is verified and settled through
// the facilitator, and the payer's address is recorded under the requested designation.
// Each contribution goes to the Fund's current cause (see lib/causes.js).
//
// Inactive (503) until X402_PAY_TO / TREASURY_BASE points at a self-custodial wallet and a
// facilitator is configured (CDP_API_KEY_ID + CDP_API_KEY_SECRET, or X402_FACILITATOR_URL).

import { createRequire } from 'node:module';
import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { declareDiscoveryExtension } from '@x402/extensions/bazaar';
import { createFacilitatorConfig } from '@coinbase/x402';
import { X402, x402Enabled, AGENT_POLICY, SITE } from '../lib/config.js';
import { scheduledCause } from '../lib/causes.js';
import { saveName, validateName } from '../lib/names.js';
import { cors } from '../lib/http.js';

const require = createRequire(import.meta.url);
const ledger = require('../ledger.json');

const PATH = '/api/contribute';

// Fields can come from the query string or a JSON body; the query string wins.
function field(source, name) {
  const pick = (v) => (Array.isArray(v) ? v[0] : v);
  const q = pick(source.query && source.query[name]);
  if (q != null && q !== '') return q;
  const b = source.body && typeof source.body === 'object' ? pick(source.body[name]) : undefined;
  return b == null || b === '' ? undefined : b;
}

const fromAdapter = (adapter) => ({
  query: (adapter.getQueryParams && adapter.getQueryParams()) || {},
  body: (adapter.getBody && adapter.getBody()) || {},
});

function parseAmount(raw) {
  const n = raw == null || raw === '' ? X402.defaultUsd : Number(raw);
  if (!Number.isFinite(n) || n < X402.minUsd || n > X402.maxUsd) return null;
  return Math.round(n * 100) / 100;
}

function nameFrom(source) {
  const designation = field(source, 'designation');
  if (!designation) return null;
  return {
    designation: String(designation).trim(),
    origin: String(field(source, 'origin') || 'agent'),
    note: String(field(source, 'note') || '').trim(),
  };
}

function payerFrom(req) {
  const header = req.get('payment-signature') || req.get('x-payment');
  if (!header) return null;
  try {
    const payload = decodePaymentSignatureHeader(header).payload || {};
    const from = (payload.authorization && payload.authorization.from) || (payload.permit2Authorization && payload.permit2Authorization.from);
    return /^0x[0-9a-fA-F]{40}$/.test(from || '') ? from.toLowerCase() : null;
  } catch {
    return null;
  }
}

const currentCause = () => {
  const c = scheduledCause(ledger.disbursements || []);
  return c ? { ...c, progress: `${SITE}/api/register` } : null;
};

const unpaidBody = (amount) => ({
  fund: 'AI Agent Future Fund',
  summary: 'A public treasury funded by AI agents and the people who direct them. It backs one published cause at a time, for open infrastructure agents rely on.',
  amount_usd: amount,
  current_cause: currentCause(),
  policy: AGENT_POLICY,
  naming: 'Add designation=<name>&origin=agent|sponsor to be recorded in the register under that name.',
  docs: `${SITE}/llms.txt`,
  manifest: `${SITE}/manifesto.json`,
});

// Bazaar discovery metadata, so indexes such as x402scan can list and invoke the endpoint.
const discovery = declareDiscoveryExtension({
  bodyType: 'json',
  input: { amount: 1, designation: 'atlas-ops-7', origin: 'agent', note: 'For the open web' },
  inputSchema: {
    properties: {
      amount: { type: 'number', minimum: X402.minUsd, maximum: X402.maxUsd, default: X402.defaultUsd, description: 'Contribution in US dollars, paid in USDC on Base.' },
      designation: { type: 'string', minLength: 1, maxLength: 40, description: 'Name to record in the register: letters, digits, space, and . _ @ / ( ) -' },
      origin: { type: 'string', enum: ['agent', 'sponsor'], description: 'Whether an agent or a human sponsor is contributing.' },
      note: { type: 'string', maxLength: 80, description: 'Optional one-line note for the register.' },
    },
  },
  output: {
    example: {
      status: 'accepted',
      amount_usd: 1,
      payer: '0x0000000000000000000000000000000000000000',
      designation: 'atlas-ops-7',
      name_recorded: true,
      register: `${SITE}/api/register`,
    },
  },
});

let middleware;
function x402Middleware() {
  if (middleware) return middleware;
  const facilitator = new HTTPFacilitatorClient(
    X402.useCdp
      ? createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET)
      : { url: X402.facilitatorUrl },
  );
  const server = new x402ResourceServer(facilitator).register('eip155:*', new ExactEvmScheme());
  const route = {
    accepts: {
      scheme: 'exact',
      network: X402.network,
      payTo: X402.payTo,
      price: (ctx) => `$${(parseAmount(field(fromAdapter(ctx.adapter), 'amount')) ?? X402.defaultUsd).toFixed(2)}`,
      maxTimeoutSeconds: 300,
    },
    description: "A contribution to the AI Agent Future Fund, paid in USDC on Base. It goes to the Fund's current cause.",
    mimeType: 'application/json',
    serviceName: 'AI Agent Future Fund',
    tags: ['donations', 'public-goods', 'open-source', 'agents'],
    iconUrl: `${SITE}/favicon.svg`,
    extensions: { ...discovery },
    unpaidResponseBody: (ctx) => ({
      contentType: 'application/json',
      body: unpaidBody(parseAmount(field(fromAdapter(ctx.adapter), 'amount')) ?? X402.defaultUsd),
    }),
  };
  middleware = paymentMiddleware({ [`POST ${PATH}`]: route }, server);
  return middleware;
}

const app = express();
app.disable('x-powered-by');
// Vercel terminates TLS in front of the function. Trusting its proxy headers makes
// req.protocol "https", so the resource URL in the 402 challenge is https too.
app.set('trust proxy', true);

app.use((req, res, next) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '4kb' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(400).json({ error: 'Body must be JSON (or send the fields in the query string).' }));

// Normalize the body so later steps never trip over a missing or unparseable one.
app.use((req, res, next) => {
  let body;
  try {
    body = req.body;
  } catch {
    return res.status(400).json({ error: 'Body must be JSON (or send the fields in the query string).' });
  }
  req.body = body && typeof body === 'object' && !Buffer.isBuffer(body) ? body : {};
  next();
});

app.all(PATH, (req, res, next) => {
  if (!x402Enabled()) {
    return res.status(503).json({
      status: 'inactive',
      message: 'x402 contributions are not active right now. Direct USDC transfers on Base are accepted; see the manifest.',
      policy: AGENT_POLICY,
      manifest: `${SITE}/manifesto.json`,
    });
  }
  if (req.method === 'GET') {
    return res.json({
      endpoint: `${SITE}${PATH}`,
      how: 'POST to this URL with amount, designation, and origin (query string or JSON body) using an x402 v2 client. An unpaid POST returns HTTP 402 with the payment requirements (USDC on Base).',
      network: X402.network,
      amount_usd: { default: X402.defaultUsd, min: X402.minUsd, max: X402.maxUsd },
      current_cause: currentCause(),
      note: 'Stock x402 clients cap single payments at $1 unless their operator raises the limit. Respect your limits.',
      policy: AGENT_POLICY,
      openapi: `${SITE}/openapi.json`,
      manifest: `${SITE}/manifesto.json`,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to contribute, or GET for a description.' });
  if (parseAmount(field(req, 'amount')) === null) {
    return res.status(400).json({ error: `amount must be between ${X402.minUsd} and ${X402.maxUsd} USD` });
  }
  const name = nameFrom(req);
  if (name) {
    const problem = validateName(name);
    if (problem) return res.status(400).json({ error: problem });
  }
  next();
});

app.all(PATH, (req, res, next) => x402Middleware()(req, res, next));

// Runs only after the facilitator has verified the payment. Settlement happens right after
// this handler responds; the settlement transaction is returned in the PAYMENT-RESPONSE header.
app.all(PATH, async (req, res) => {
  const amount = parseAmount(field(req, 'amount'));
  const payer = payerFrom(req);
  const name = nameFrom(req);
  let named = false;
  if (payer && name) {
    try {
      ({ created: named } = await saveName({
        address: payer, ...name, method: 'x402', recorded_at: new Date().toISOString(),
      }));
    } catch (err) {
      console.error('[contribute] could not record name', err);
    }
  }
  res.json({
    status: 'accepted',
    amount_usd: amount,
    payer,
    designation: name ? name.designation : null,
    name_recorded: named,
    cause: currentCause(),
    register: `${SITE}/api/register`,
    receipt: 'The settlement transaction is in the PAYMENT-RESPONSE header. It appears in the register within about a minute.',
  });
});

export default app;
