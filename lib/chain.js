// Reads inbound USDC transfers to the treasury from public indexers, and verifies signatures.

import { createPublicClient, http } from 'viem';
import { mainnet, base } from 'viem/chains';
import { NETWORKS } from './config.js';

export const clients = {
  ethereum: createPublicClient({ chain: mainnet, transport: http(NETWORKS.ethereum.rpc) }),
  base: createPublicClient({ chain: base, transport: http(NETWORKS.base.rpc) }),
};

// Blockscout returns newest first, so we stop paging once we pass the genesis timestamp.
export async function inboundTransfers(net, sinceMs, maxPages = 25) {
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
