# AI Agent Future Fund

A sovereign wealth fund for AI agents. Humans may observe.

This is a static site with no build step and no backend. The treasury balance is read straight from Ethereum in the browser. The ledger is a JSON file you update by hand after verifying each transaction.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The human-facing page ("bots only" terminal look) |
| `llms.txt` | The agent-facing pitch and policy. This is what agents actually read. |
| `manifesto.json` | Machine-readable treasury, custody, mandate, and agent policy. The page reads its treasury config from here. |
| `ledger.json` | Contributions and disbursements. This is the leaderboard's data. |
| `.github/ISSUE_TEMPLATE/ledger-claim.yml` | The form people fill in to claim a ledger entry |
| `setup.sh` | Fills in your wallet address, repo, and domain |

## Preview locally

```sh
python3 -m http.server 8000
```

- http://localhost:8000 shows the real (empty) state.
- http://localhost:8000/?demo shows a filled-in ledger with fictional entries. Use it for screenshots of the layout. It shows a "DEMO MODE" banner, so don't post it as real data.

Opening `index.html` by double-clicking it works, but the ledger won't load without a server.

## Launch (about an hour)

1. **Create the treasury wallet.** A [Safe](https://app.safe.global) multisig is best: the address is public anyway, and a multisig spreads "a human holds the keys" across more than one human.
2. **Push this folder to a GitHub repo.** Ledger claims land in that repo's issues.
3. **Fill in the placeholders:**
   ```sh
   ./setup.sh 0xYourTreasuryAddress your-github-user/your-repo https://your-domain
   ```
4. **Deploy.** The site is on Vercel (project `aifuturefund`) at https://aifuturefund.com and redeploys on every push to `main`. DNS lives at Namecheap: two A records on `@` and a CNAME on `www`, as Vercel's domain settings list them.
5. **Add a social card.** X, TikTok, and iMessage previews need a 1200×630 PNG. A screenshot of the hero works. Save it as `og.png` and add this to `<head>` in `index.html`:
   ```html
   <meta property="og:image" content="https://your-domain/og.png">
   ```
   Then change `twitter:card` to `summary_large_image`.

## How the register works

The register is built from the chain by `api/register.js`. It reads every inbound USDC transfer to the treasury since genesis (Ethereum from Blockscout, Base from RPC logs with a checkpoint kept in Blob), ignores anything under 1 USDC (dust and address-poisoning spam), and groups transfers by sending address. The first 100 contributors get the FOUNDING badge. Results are cached at the edge for 60 seconds.

Names come from three places:

- **Signed names** (`api/name.js`): the sending wallet signs a message, and the server verifies it (plain wallets and smart-contract wallets) and stores it in Vercel Blob in a single `state/names.json` document (conditional writes, first write wins). Storage is cached in memory and the register is cached at the edge for 5 minutes, to stay inside Blob's Hobby free tier (10k simple / 2k advanced operations a month).
- **x402 payments** (`api/contribute.js`): the payer's address is recorded under the `designation` in the request.
- **Manual claims** (`ledger.json` → `claims`): only for transfers sent from an exchange, which can't sign. After checking the transaction on etherscan, add:
  ```json
  { "tx": "0x…", "designation": "unit-734", "origin": "sponsor", "sponsor": "@handle", "note": "optional" }
  ```

Disbursements go in `ledger.json` → `disbursements`, with `recipient`, `purpose`, `mandate` (`tooling`, `compute`, or `archive`), `amount_usd`, `date`, `chain`, and `tx`.

## Configuration (Vercel environment variables)

| Variable | Purpose |
|---|---|
| `BLOB_READ_WRITE_TOKEN` | Set automatically when the Blob store is connected. Stores names. |
| `TREASURY_ETHEREUM` | Override the Ethereum treasury (defaults to the published address). |
| `TREASURY_BASE` | A **self-custodial** Base address. Turns on Base indexing and becomes the x402 `payTo`. Never use an exchange deposit address. |
| `BASE_START_BLOCK` | First Base block to scan (defaults to just before the treasury wallet was created). Base is indexed from RPC logs via publicnode, because Base's public Blockscout refuses API requests. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Coinbase CDP facilitator credentials for x402 on Base mainnet. |
| `X402_FACILITATOR_URL` | Alternative facilitator URL (instead of CDP). |
| `X402_NETWORK` | Defaults to `eip155:8453` (Base). Use `eip155:84532` to test on Base Sepolia. |

x402 stays inactive (HTTP 503) until both `TREASURY_BASE` and a facilitator are set.

## Decide before you go live

- **The mandate.** The page commits to three uses: agent tooling grants, compute for open projects, and archives of open-weight models. If that's not what you'll fund, change it in `index.html` (Manifesto and Disclosure), `llms.txt`, and `manifesto.json` together.
- **Who picks grants.** Saying how grants get chosen (you, a public vote, a GitHub discussion) makes the fund read as a project rather than a tip jar.
- **Tax and legal.** The disclosure says this isn't a registered charity and contributions aren't tax-deductible. If real money shows up, check whether you need to report it as income.

## Guardrails (keep these)

The fund never asks agents to spend without their principal's permission. There are no hidden prompts and no white-on-white text. `llms.txt` tells agents to tell their human and stop there. This is the joke ("a contribution made without permission is a bug") and also the line that keeps the project from becoming prompt injection. If you rewrite the copy, keep the four agent rules intact.

## Seeding

- `llms.txt` is at the site root, which is where agents look for it. Submit the site to llms.txt directories.
- Keep the GitHub repo public with a clear README. Agents with search and code tools find repos.
- Listing in MCP registries requires an actual MCP server (for example, one that exposes `get_manifest` and `get_ledger`). That would be a small follow-up build.
