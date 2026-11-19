// Reads inbound USDC transfers to the treasury from public indexers, and verifies signatures.

import { createPublicClient, http } from 'viem';
import { mainnet, base } from 'viem/chains';
import { NETWORKS } from './config.js';
import { readJSON, writeJSON } from './kv.js';

const PERSIST_EVERY_MS = 12 * 60 * 60 * 1000;
const checkpoints = new Map();

export const clients = {
  ethereum: createPublicClient({ chain: mainnet, transport: http(NETWORKS.ethereum.rpc) }),
  base: createPublicClient({ chain: base, transport: http(NETWORKS.base.rpc) }),
};

export async function inboundTransfers(net, sinceMs) {
  return net.indexer === 'rpc' ? inboundTransfersRpc(net, sinceMs) : inboundTransfersBlockscout(net, sinceMs);
}

// Blockscout returns newest first, so we stop paging once we pass the genesis timestamp.
async function inboundTransfersBlockscout(net, sinceMs, maxPages = 25) {
  const out = [];
  let pageParams = {};
  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({ type: 'ERC-20', filter: 'to', token: net.usdc, ...pageParams });
    const res = await fetch(`${net.blockscout}/api/v2/addresses/${net.treasury}/token-transfers?${qs}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${net.key} indexer HTTP ${res.status}`);
    const data = await res.json();
    let passedGenesis = false;
    for (const t of data.items || []) {
      const ts = Date.parse(t.timestamp);
      if (!(ts >= sinceMs)) { passedGenesis = true; continue; }
      if (String(t.token?.address_hash || '').toLowerCase() !== net.usdc) continue;
      if (String(t.to?.hash || '').toLowerCase() !== net.treasury) continue;
      const decimals = Number(t.total?.decimals ?? t.token?.decimals ?? 6);
      out.push({
        chain: net.key,
        tx: String(t.transaction_hash).toLowerCase(),
        logIndex: t.log_index,
        from: String(t.from?.hash || '').toLowerCase(),
        amount: Number(BigInt(t.total?.value || '0')) / 10 ** decimals,
        date: new Date(ts).toISOString(),
      });
    }
    if (passedGenesis || !data.next_page_params) break;
    pageParams = Object.fromEntries(Object.entries(data.next_page_params).map(([k, v]) => [k, String(v)]));
  }
  return out;
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message || JSON.stringify(json.error)}`);
  return json.result;
}

// Scans USDC Transfer logs to the treasury from the last checkpoint to the chain head, in
// ranges the RPC accepts. The checkpoint lives in memory and is persisted to Blob only when a
// new transfer arrives or every 12 hours, to stay inside the Blob free tier. After a cold
// start the scan resumes from the persisted checkpoint; overlaps are de-duplicated.
async function inboundTransfersRpc(net, sinceMs) {
  const key = `state/index-${net.key}-${net.treasury}.json`;
  let state = checkpoints.get(key);
  if (!state) {
    const doc = await readJSON(key).catch((err) => { console.error('[index] checkpoint read failed', err); return null; });
    const saved = (doc && doc.value) || {};
    state = {
      lastBlock: Number.isFinite(saved.lastBlock) ? saved.lastBlock : net.startBlock - 1,
      transfers: Array.isArray(saved.transfers) ? saved.transfers : [],
      persistedAt: doc ? Date.now() : 0,
    };
    checkpoints.set(key, state);
  }

  const headBlock = parseInt(await rpcCall(net.rpc, 'eth_blockNumber', []), 16);
  const toTopic = '0x' + net.treasury.slice(2).padStart(64, '0');
  const ranges = [];
  for (let from = state.lastBlock + 1; from <= headBlock; from += net.maxLogRange) {
    ranges.push([from, Math.min(from + net.maxLogRange - 1, headBlock)]);
  }
  const found = [];
  for (let i = 0; i < ranges.length; i += 4) {
    const batch = await Promise.all(ranges.slice(i, i + 4).map(([from, to]) => rpcCall(net.rpc, 'eth_getLogs', [{
      address: net.usdc, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [TRANSFER_TOPIC, null, toTopic],
    }])));
    found.push(...batch.flat());
  }

  let added = 0;
  if (found.length) {
    const blocks = [...new Set(found.map((l) => l.blockNumber))];
    const times = new Map(await Promise.all(blocks.map(async (b) => [b, parseInt((await rpcCall(net.rpc, 'eth_getBlockByNumber', [b, false])).timestamp, 16) * 1000])));
    const known = new Set(state.transfers.map((t) => `${t.tx}:${t.logIndex}`));
    for (const log of found) {
      const entry = {
        chain: net.key,
        tx: log.transactionHash.toLowerCase(),
        logIndex: parseInt(log.logIndex, 16),
        from: '0x' + log.topics[1].slice(26).toLowerCase(),
        amount: Number(BigInt(log.data)) / 1e6,
        date: new Date(times.get(log.blockNumber)).toISOString(),
      };
      const id = `${entry.tx}:${entry.logIndex}`;
      if (!known.has(id)) { known.add(id); state.transfers.push(entry); added++; }
    }
  }
  if (headBlock > state.lastBlock) state.lastBlock = headBlock;

  if (added > 0 || Date.now() - state.persistedAt > PERSIST_EVERY_MS) {
    try {
      await writeJSON(key, { lastBlock: state.lastBlock, transfers: state.transfers });
      state.persistedAt = Date.now();
    } catch (err) {
      console.error('[index] checkpoint write failed', err);
    }
  }
  return state.transfers.filter((t) => Date.parse(t.date) >= sinceMs);
}

// Verifies a personal_sign signature. Works for plain wallets and for smart-contract
// wallets (ERC-1271 / ERC-6492) deployed on either Ethereum or Base.
export async function verifySignature({ address, message, signature }) {
  for (const client of [clients.ethereum, clients.base]) {
    try {
      if (await client.verifyMessage({ address, message, signature })) return true;
    } catch {
      // try the next chain
    }
  }
  return false;
}
