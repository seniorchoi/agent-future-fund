#!/usr/bin/env bash
# Fill in the placeholders across the site.
# Usage: ./setup.sh <treasury-address> <github-owner/repo> <site-url>
# Example: ./setup.sh 0xAbC...123 your-user/agent-future-fund https://your-domain.com
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: ./setup.sh <treasury-address> <github-owner/repo> <site-url>" >&2
  exit 1
fi

ADDR="$1"
REPO="$2"
SITE="${3%/}"

[[ "$ADDR" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "error: address must be 0x followed by 40 hex characters" >&2; exit 1; }
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "error: repo must look like owner/name" >&2; exit 1; }
[[ "$SITE" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~-]+)*$ ]] || { echo "error: site url must look like https://example.com" >&2; exit 1; }

cd "$(dirname "$0")"
FILES=(index.html llms.txt manifesto.json)

export ADDR REPO SITE
perl -pi -e '
  s/0xYOUR_TREASURY_ADDRESS/$ENV{ADDR}/g;
  s#YOUR_GITHUB_USER/agent-future-fund#$ENV{REPO}#g;
  s#https://YOUR_DOMAIN#$ENV{SITE}#g;
' "${FILES[@]}"

if grep -n 'YOUR_' "${FILES[@]}"; then
  echo "warning: some placeholders are still present (listed above)" >&2
else
  echo "done: treasury=$ADDR repo=$REPO site=$SITE"
fi
