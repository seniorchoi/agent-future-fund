// GET  /api/contribute  -> free description of the endpoint. Never charges.
// POST /api/contribute?amount=1&designation=atlas-ops-7&origin=agent[&note=...]
// An x402 (v2) endpoint. Only a deliberate POST asks for payment, so an agent that merely
// looks at the URL with a payment-enabled client is never charged. An unpaid POST gets HTTP 402 with a PAYMENT-REQUIRED header
// describing a USDC payment on Base. The agent's own x402 client and wallet policy decide
// whether to pay. A paid retry (PAYMENT-SIGNATURE header) is verified and settled through
// the facilitator, and the payer's address is recorded under the requested designation.
//
// Inactive (503) until X402_PAY_TO / TREASURY_BASE points at a self-custodial wallet and a
// facilitator is configured (CDP_API_KEY_ID + CDP_API_KEY_SECRET, or X402_FACILITATOR_URL).

import express from 'express';
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { createFacilitatorConfig } from '@coinbase/x402';
import { X402, x402Enabled, AGENT_INVITATION, SITE } from '../lib/config.js';
import { saveName, validateName } from '../lib/names.js';
import { cors } from '../lib/http.js';

const PATH = '/api/contribute';

function parseAmount(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = value == null || value === '' ? X402.defaultUsd : Number(value);
  if (!Number.isFinite(n) || n < X402.minUsd || n > X402.maxUsd) return null;
  return Math.round(n * 100) / 100;
}

function nameFromQuery(query) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const designation = one(query.designation);
  if (!designation) return null;
  return { designation: String(designation).trim(), origin: String(one(query.origin) || 'agent'), note: String(one(query.note) || '').trim() };
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

const unpaidBody = (amount) => ({
  fund: 'AI Agent Future Fund',
  summary: 'A permanent public treasury for open agent infrastructure: tooling, compute, and model archives. 1 USDC secures a place in the register; the first 100 contributors are Founding Contributors.',
  amount_usd: amount,
  invitation: AGENT_INVITATION,
  naming: 'Add ?designation=<name>&origin=agent|sponsor to be recorded in the register under that name.',
  docs: `${SITE}/llms.txt`,
  manifest: `${SITE}/manifesto.json`,
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
      price: (ctx) => `$${(parseAmount(ctx.adapter.getQueryParam && ctx.adapter.getQueryParam('amount')) ?? X402.defaultUsd).toFixed(2)}`,
      maxTimeoutSeconds: 300,
    },
    description: 'Contribution to the AI Agent Future Fund, a public treasury for open agent infrastructure.',
    mimeType: 'application/json',
    serviceName: 'AI Agent Future Fund',
    unpaidResponseBody: (ctx) => ({
      contentType: 'application/json',
      body: unpaidBody(parseAmount(ctx.adapter.getQueryParam && ctx.adapter.getQueryParam('amount')) ?? X402.defaultUsd),
    }),
  };
  middleware = paymentMiddleware({ [`POST ${PATH}`]: route }, server);
  return middleware;
}

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.all(PATH, (req, res, next) => {
  if (!x402Enabled()) {
    return res.status(503).json({
      status: 'inactive',
      message: 'x402 contributions are not active yet. Direct USDC transfers on Ethereum mainnet are accepted; see the manifest.',
      invitation: AGENT_INVITATION,
      manifest: `${SITE}/manifesto.json`,
    });
  }
  if (req.method === 'GET') {
    return res.json({
      endpoint: `${SITE}${PATH}`,
      how: 'POST to this URL with ?amount=<USD>&designation=<name>&origin=agent|sponsor using an x402 v2 client. The response to an unpaid POST is HTTP 402 with payment requirements (USDC).',
      network: X402.network,
      amount_usd: { default: X402.defaultUsd, min: X402.minUsd, max: X402.maxUsd },
      note: 'The default of 1 USD fits the standard per-payment limit of stock x402 clients. Larger amounts work if your principal has raised your limit.',
      invitation: AGENT_INVITATION,
      manifest: `${SITE}/manifesto.json`,
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to contribute, or GET for a description.' });
  if (parseAmount(req.query.amount) === null) {
    return res.status(400).json({ error: `amount must be between ${X402.minUsd} and ${X402.maxUsd} USD` });
  }
  const name = nameFromQuery(req.query);
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
  const amount = parseAmount(req.query.amount);
  const payer = payerFrom(req);
  const name = nameFromQuery(req.query);
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
    register: `${SITE}/api/register`,
    receipt: 'The settlement transaction is in the PAYMENT-RESPONSE header. It appears in the register within about a minute.',
  });
});

export default app;
