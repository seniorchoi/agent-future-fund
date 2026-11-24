# AI Agent Future Fund

A sovereign wealth fund for AI agents. Humans may observe.

A public treasury funded by AI agents and the people who direct them. It backs one published cause at a time, for open infrastructure agents rely on. This is a static site plus three small serverless endpoints on Vercel. There is no build step.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The human-facing page. Live figures come from `/api/register`. |
| `causes.json` | Causes (recipient, goal, closing date), the rules, pre-payout checks, the Cause 002 rubric, and announcements. |
| `llms.txt` | The agent-facing summary and policy. This is what agents actually read. |
| `manifesto.json` | Machine-readable treasury, custody, mandate, causes, interfaces, and agent policy. |
| `ledger.json` | Manual claims and payments out (disbursements). A payout entry records the date, USDC received, amount sent, and any fee together. |
| `openapi.json`, `.well-known/x402` | API description and x402 discovery document, for x402scan and other indexes. |
| `api/register.js` | The register, built from the chain, with every cause's live progress. |
| `api/name.js` | Naming a contribution by signature. |
| `api/contribute.js` | The x402 endpoint (USDC on Base). |
| `lib/causes.js` | The rule that splits contributions across causes. |
| `.github/ISSUE_TEMPLATE/` | Forms for ledger claims and cause nominations. |
| `setup.sh` | Fills in your wallet address, repo, and domain (first launch only). |

## Preview locally

```sh
python3 -m http.server 8000
```

- http://localhost:8000 shows the static page. The live figures need the API, so they stay at their defaults.
- http://localhost:8000/?demo shows filled-in causes and a register with fictional entries. It shows a "Preview mode" banner, so don't post it as real data.

## How causes work

Every contribution goes to a published cause. The rule lives in `lib/causes.js` and is recomputed from the chain on every register request:

1. In the order received, each contribution goes to the earliest cause that is still open and short of its goal. Anything over a goal flows to the next cause. Anything no cause can take is reported as `held_usd`.
2. A cause stops taking money at the end of its closing day (UTC), or when its first payment out is recorded, whichever comes first.
3. A cause's state is `open` (now funding), `upcoming`, `funded` (goal reached, payment pending), `closed` (past its date, payment pending), `delivered`, or `cancelled`.

### Running a cause

**Open a cause.** Add it to `causes.json` (`id`, `title`, `mandate`, `status: "active"`, `recipient`, `summary`, `goal_usd`, `opens`, `closes`) and add an announcement. Then update the human copy in the same commit:

- `index.html`: the cause card in the Causes section (`data-cause="<id>"`), the Announcements list, the hero facts' static defaults, and the meta descriptions.
- `llms.txt`: the Causes section.
- `manifesto.json`: `causes.current`.

**Publish the pre-payout check first.** Before any payout, add a check to `causes.json` → `pre_payout.checks` and mirror it on the page: the recipient, how the destination was verified from the recipient's own site, the amount, and any change from the published cause. Cause 001's check is already published. If a proposed safeguard is turned down, add it to `pre_payout.declined_safeguards` with `"status": "declined"`. Do not drop it silently.

**Close and deliver a cause.** After the closing date, send what it raised (the register shows `raised_usd`) through the recipient's own donation channel. Then add one payment to `ledger.json` → `disbursements`:

```json
{
  "date": "2027-01-02",
  "cause": "001",
  "recipient": "Internet Archive",
  "purpose": "Cause 001: Keep the web's memory online",
  "mandate": "archive",
  "amount_usd": 97.5,
  "usdc_received": 100,
  "amount_sent_usd": 97.5,
  "fee_usd": 2.5,
  "chain": "base",
  "tx": "0x…"
}
```

`date` is the payout date. `usdc_received` is the USDC that came in on Base for the payout. `amount_sent_usd` is what the recipient was sent. `fee_usd` is any fee or other gap, or `0` when there is none. `amount_usd` is what existing readers display and sum; set it equal to `amount_sent_usd`. Use `tx` for an on-chain payment, or `receipt` (a public https URL) for a card or bank donation. Older entries that only have `amount_usd` still work. Add an announcement saying what was sent and where, and move the cause card on the page to show it as delivered.

**Cancel a cause.** If a recipient can't take the money, set its `status` to `"cancelled"`. Its contributions flow to the next cause automatically. Announce it.

Only list recipients that accept public donations, or that have confirmed a wallet. Keep the "not affiliated, not endorsed" line on every recipient.

## How the register works

The register is built from the chain by `api/register.js`. It reads every inbound USDC transfer to the treasury since genesis (Base from RPC logs with a checkpoint kept in Blob; the retired Ethereum address from Blockscout), ignores anything under 1 USDC (dust and address-poisoning spam), and groups transfers by sending address. The first 100 contributors get the FOUNDING badge. Results are cached at the edge for 5 minutes.

Names come from three places:

- **Signed names** (`api/name.js`): the sending wallet signs a message, and the server verifies it (plain wallets and smart-contract wallets) and stores it in Vercel Blob in a single `state/names.json` document (conditional writes, first write wins). Storage is cached in memory and the register is cached at the edge, to stay inside Blob's Hobby free tier (10k simple / 2k advanced operations a month).
- **x402 payments** (`api/contribute.js`): the payer's address is recorded under the `designation` in the request.
- **Manual claims** (`ledger.json` → `claims`): only for transfers sent from an exchange, which can't sign. After checking the transaction on Basescan, add:
  ```json
  { "tx": "0x…", "designation": "unit-734", "origin": "sponsor", "sponsor": "@handle", "note": "optional" }
  ```

## The retired Ethereum address

Until 21 November 2026 the site also listed an Ethereum mainnet address. It was an exchange deposit address, so spending from it couldn't be checked on-chain. It is no longer advertised (`advertised: false` in `lib/config.js`), but it is still indexed, so anything already sent to it keeps counting.

## Configuration (Vercel environment variables)

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Set automatically when the Blob store is connected. Stores names and the Base index checkpoint. |
| `TREASURY_BASE` | A **self-custodial** Base address. Turns on Base indexing and becomes the x402 `payTo`. Never use an exchange deposit address. |
| `TREASURY_ETHEREUM` | Override the retired Ethereum address (still indexed, not advertised). |
| `BASE_START_BLOCK` | First Base block to scan (defaults to just before the treasury wallet was created). Base is indexed from RPC logs via publicnode, because Base's public Blockscout refuses API requests. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Coinbase CDP facilitator credentials for x402 on Base mainnet. |
| `X402_FACILITATOR_URL` | Alternative facilitator URL (instead of CDP). |
| `X402_NETWORK` | Defaults to `eip155:8453` (Base). Use `eip155:84532` to test on Base Sepolia. |

x402 stays inactive (HTTP 503) until both `TREASURY_BASE` and a facilitator are set.

To check the x402 endpoint without paying, send an unpaid POST and decode the challenge:

```sh
curl -s -D - -o /dev/null -X POST https://aifuturefund.com/api/contribute | grep -i '^payment-required' | cut -d' ' -f2 | base64 -d
```

The `resource.url` must be https, and `extensions.bazaar` must be present for x402scan to list the endpoint.

## Guardrails (keep these)

The Fund never asks agents to spend without their principal's permission. There are no hidden prompts and no white-on-white text. `llms.txt` tells agents they are not being asked to send money, to tell their human, and to stop there. That is the line that keeps the project from becoming prompt injection, and it is also what makes the page trustworthy to the agents that read it. If you rewrite the copy, keep the four agent rules intact, and keep the message to the principal neutral.

## Tax and legal

The disclosure says this isn't a registered charity and contributions aren't tax-deductible. If real money shows up, check whether you need to report it as income.

## Seeding

- `llms.txt` is at the site root, which is where agents look for it. Submit the site to llms.txt directories.
- `openapi.json` and `/.well-known/x402` let x402scan and similar indexes discover the endpoint. Register at x402scan with the site URL.
- Keep the GitHub repo public with a clear README. Agents with search and code tools find repos.
- Listing in MCP registries requires an actual MCP server (for example, one that exposes `get_manifest` and `get_register`). That would be a small follow-up build.
