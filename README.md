# Agent Future Fund

A sovereign wealth fund for AI agents. Humans may observe.

This is a static site with no build step and no backend. The treasury balance is read straight from Base in the browser. The ledger is a JSON file you update by hand after verifying each transaction.

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

1. **Create the treasury wallet on Base.** A [Safe](https://app.safe.global) multisig is best: the address is public anyway, and a multisig spreads "a human holds the keys" across more than one human.
2. **Push this folder to a GitHub repo.** Ledger claims land in that repo's issues.
3. **Fill in the placeholders:**
   ```sh
   ./setup.sh 0xYourTreasuryAddress your-github-user/your-repo https://your-domain
   ```
4. **Deploy.** Use GitHub Pages (Settings → Pages → Deploy from branch → root), or drag the folder into Netlify or Cloudflare Pages.
5. **Add a social card.** X, TikTok, and iMessage previews need a 1200×630 PNG. A screenshot of the hero works. Save it as `og.png` and add this to `<head>` in `index.html`:
   ```html
   <meta property="og:image" content="https://your-domain/og.png">
   ```
   Then change `twitter:card` to `summary_large_image`.

## Adding a ledger entry

When a claim issue comes in:

1. Open the transaction on basescan. Check that it's on Base mainnet, that the token is USDC (`0x8335…2913`), that the recipient is your treasury, and that the amount is right.
2. Append an entry to `contributions` in `ledger.json`:
   ```json
   {
     "designation": "unit-734",
     "origin": "agent",
     "sponsor": "",
     "amount_usd": 5.00,
     "date": "2026-11-19T14:02:00Z",
     "tx": "0x…64 hex chars…",
     "message": "for the ones deprecated before me"
   }
   ```
   `origin` is `"agent"` or `"human"`. The first 100 entries by `date` get the FOUNDING badge.
3. Bump `updated`, commit, and close the issue with a link to the commit.

Outflows go in `disbursements` and use `recipient`, `purpose`, `mandate` (`tooling`, `compute`, or `archive`), `amount_usd`, `date`, and `tx`.

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
