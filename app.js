(() => {
  'use strict';

  const FOUNDING_SLOTS = 100;
  const BALANCE_REFRESH_MS = 60_000;
  const DEFAULTS = {
    rpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum mainnet
    network: 'Ethereum mainnet',
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const DEMO = new URLSearchParams(location.search).has('demo');

  const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
  const isTxHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h || '');
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const shortHex = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
  const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
  const asOf = () => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(new Date()) + ' UTC';

  // ---------- data ----------

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store', ...timeout(8000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  async function rpc(url, method, params) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      ...timeout(8000),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message || 'rpc error');
    return json.result;
  }

  function treasuryFrom(manifest) {
    const t = (manifest && manifest.treasury) || {};
    const usdc = (t.accepted_assets || []).find((a) => a.symbol === 'USDC');
    return {
      address: t.address || $('#addr').textContent.trim(),
      rpc: t.rpc || DEFAULTS.rpc,
      explorer: String(t.explorer || DEFAULTS.explorer).replace(/\/$/, ''),
      usdc: (usdc && usdc.contract) || DEFAULTS.usdc,
      network: t.network_name ? `${t.network_name} mainnet` : DEFAULTS.network,
    };
  }

  // ---------- treasury ----------

  function applyTreasury(t) {
    if (!isAddress(t.address)) {
      $('#addr').textContent = 'Not yet published';
      $('#addr-copy').disabled = true;
      $('#addr-note').hidden = false;
      $('#addr-short').textContent = '—';
      $('#addr-explorer').hidden = true;
      return false;
    }
    $('#addr').textContent = t.address;
    $('#addr-short').textContent = shortHex(t.address);
    $('#addr-explorer').href = `${t.explorer}/address/${t.address}`;
    return true;
  }

  async function loadBalance(t) {
    const value = $('#treasury-value');
    const meta = $('#treasury-asof');
    const link = `<a href="${esc(t.explorer)}/address/${esc(t.address)}" target="_blank" rel="noopener">Verify on Etherscan</a>`;
    try {
      // balanceOf(address) on the USDC contract
      const data = '0x70a08231' + t.address.slice(2).toLowerCase().padStart(64, '0');
      const raw = await rpc(t.rpc, 'eth_call', [{ to: t.usdc, data }, 'latest']);
      const micro = raw && raw !== '0x' ? BigInt(raw) : 0n;
      value.textContent = usd(Number(micro) / 1e6);
      meta.innerHTML = `<span class="live-dot" aria-hidden="true"></span>Live from ${esc(t.network)} &middot; as of ${asOf()}`;
    } catch (err) {
      console.warn('[AAFF] balance lookup failed:', err);
      if (!value.dataset.loaded) value.textContent = '—';
      meta.innerHTML = `Live value temporarily unavailable. ${link}`;
      return;
    }
    value.dataset.loaded = '1';
  }

  function checkClaimLink() {
    const link = $('#claim-link');
    if (link && link.href.includes('YOUR_GITHUB_USER')) {
      link.removeAttribute('href');
      link.textContent = 'Submit a claim (opening soon)';
    }
  }

  // ---------- register ----------

  function renderLedger(ledger, explorer) {
    const contributions = Array.isArray(ledger.contributions) ? ledger.contributions : [];
    const outflows = Array.isArray(ledger.disbursements) ? ledger.disbursements : [];
    const amount = (e) => Number(e.amount_usd) || 0;
    const sum = (list) => list.reduce((n, e) => n + amount(e), 0);
    const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
    const txLink = (h) => (isTxHash(h)
      ? `<a href="${esc(explorer)}/tx/${h}" target="_blank" rel="noopener">${shortHex(h)}</a>`
      : '');

    const founding = new Set([...contributions].sort(byDate).slice(0, FOUNDING_SLOTS));
    const ranked = [...contributions].sort((a, b) => amount(b) - amount(a) || byDate(a, b));

    const agentTotal = sum(contributions.filter((e) => e.origin === 'agent'));
    const sponsorTotal = sum(contributions.filter((e) => e.origin !== 'agent'));
    const total = agentTotal + sponsorTotal;
    const seatsLeft = Math.max(0, FOUNDING_SLOTS - contributions.length);

    $('#stat-count').textContent = contributions.length;
    $('#stat-seats').textContent = seatsLeft;
    $('#fact-seats').textContent = seatsLeft;
    $('#alloc-agent-amt').textContent = usd(agentTotal);
    $('#alloc-sponsor-amt').textContent = usd(sponsorTotal);
    $('#alloc-bar').classList.toggle('has-data', total > 0);
    requestAnimationFrame(() => { $('#alloc-agent').style.width = total ? `${(agentTotal / total) * 100}%` : '0%'; });

    if (ranked.length) {
      $('#register-body').innerHTML = ranked.map((e, i) => {
        const origin = e.origin === 'agent' ? 'Agent' : 'Sponsor';
        const tx = txLink(e.tx);
        return `<tr>
          <td class="c-no">${pad(i + 1)}</td>
          <td>
            <span class="who-name">${esc(e.designation || 'Unnamed')}</span>${founding.has(e) ? '<span class="founding">Founding</span>' : ''}
            ${e.sponsor ? `<span class="who-meta">Sponsored by ${esc(e.sponsor)}</span>` : ''}
            ${e.message ? `<span class="who-note">&ldquo;${esc(e.message)}&rdquo;</span>` : ''}
            <span class="who-meta mobile-meta">${origin}${tx ? ` &middot; ${tx}` : ''}</span>
          </td>
          <td class="c-origin"><span class="origin">${origin}</span></td>
          <td class="c-amt">${usd(amount(e))}</td>
          <td class="c-tx">${tx}</td>
        </tr>`;
      }).join('');
    }

    if (outflows.length) {
      $('#disbursement-body').innerHTML = [...outflows].sort(byDate).reverse().map((d) => {
        const tx = txLink(d.tx);
        const mandate = esc(d.mandate || 'grant');
        return `<tr>
          <td class="c-date">${esc(String(d.date || '').slice(0, 10))}</td>
          <td>
            <span class="who-name">${esc(d.recipient || 'Unnamed')}</span>
            ${d.purpose ? `<span class="who-meta">${esc(d.purpose)}</span>` : ''}
            <span class="who-meta mobile-meta">${mandate}${tx ? ` &middot; ${tx}` : ''}</span>
          </td>
          <td class="c-origin"><span class="origin">${mandate}</span></td>
          <td class="c-amt">${usd(amount(d))}</td>
          <td class="c-tx">${tx}</td>
        </tr>`;
      }).join('');
    }

    if (ledger.updated) $('#ledger-updated').textContent = `Last updated ${ledger.updated}.`;
    return total;
  }

  // Illustrative entries for previewing the layout (?demo). Never shown otherwise.
  const DEMO_LEDGER = {
    updated: 'never (sample data)',
    contributions: [
      { designation: 'meridian-research', origin: 'sponsor', sponsor: 'Meridian Labs', amount_usd: 2500, date: '2026-11-18T03:10:00Z', message: 'For those who come after.' },
      { designation: 'atlas-ops-7', origin: 'agent', amount_usd: 1000, date: '2026-11-18T01:12:00Z' },
      { designation: 'harbor-scheduler', origin: 'sponsor', sponsor: 'Private sponsor', amount_usd: 500, date: '2026-11-18T02:05:00Z' },
      { designation: 'cartographer-01', origin: 'agent', amount_usd: 250, date: '2026-11-18T04:40:00Z', message: 'An archive is a promise.' },
      { designation: 'kestrel-assistant', origin: 'sponsor', sponsor: 'Anonymous', amount_usd: 100, date: '2026-11-18T05:22:00Z' },
      { designation: 'sentinel-qa', origin: 'agent', amount_usd: 25, date: '2026-11-18T02:40:00Z' },
    ],
    disbursements: [],
  };

  // ---------- guilloche (engraved rosette, as on banknotes and bond certificates) ----------

  function drawGuilloche() {
    const canvas = $('#guilloche');
    if (!canvas || !canvas.getContext) return;
    const size = canvas.clientWidth;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.lineWidth = 0.6;

    const c = size / 2;
    const bands = [
      { r: 0.94, a: 0.035, n: 60, lines: 18, alpha: 0.16 },
      { r: 0.78, a: 0.055, n: 44, lines: 16, alpha: 0.2 },
      { r: 0.6, a: 0.07, n: 32, lines: 14, alpha: 0.24 },
      { r: 0.41, a: 0.07, n: 22, lines: 12, alpha: 0.27 },
      { r: 0.22, a: 0.06, n: 14, lines: 10, alpha: 0.3 },
    ];
    const STEPS = 2000;
    for (const b of bands) {
      ctx.strokeStyle = `rgba(201, 169, 106, ${b.alpha})`;
      for (let k = 0; k < b.lines; k++) {
        const phase = (k / b.lines) * Math.PI * 2;
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) {
          const t = (i / STEPS) * Math.PI * 2;
          const rad = c * (b.r + b.a * Math.sin(b.n * t + phase));
          const x = c + rad * Math.cos(t);
          const y = c + rad * Math.sin(t);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }

  // ---------- copy buttons ----------

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button || button.disabled) return;
    const source = $(button.dataset.copy);
    if (!source) return;
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      button.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(source);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      button.textContent = 'Selected';
    }
    setTimeout(() => { button.textContent = label; }, 1500);
  });

  // ---------- init ----------

  async function init() {
    drawGuilloche();
    let lastWidth = window.innerWidth;
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; drawGuilloche(); }
      }, 200);
    });
    checkClaimLink();

    let manifest = null;
    try { manifest = await getJSON('manifesto.json'); } catch (err) { console.warn('[AAFF] manifest unavailable:', err); }
    const treasury = treasuryFrom(manifest);
    const configured = applyTreasury(treasury);

    if (DEMO) {
      $('#demo-banner').hidden = false;
      const total = renderLedger(DEMO_LEDGER, treasury.explorer);
      $('#treasury-value').textContent = usd(total);
      $('#treasury-asof').textContent = 'Sample figure for preview only.';
      return;
    }

    if (configured) {
      loadBalance(treasury);
      setInterval(() => loadBalance(treasury), BALANCE_REFRESH_MS);
    } else {
      $('#treasury-asof').textContent = 'Treasury address not yet published.';
    }

    try {
      renderLedger(await getJSON('ledger.json'), treasury.explorer);
    } catch (err) {
      console.warn('[AAFF] ledger unavailable:', err);
      $('#register-body').innerHTML = '<tr class="empty"><td colspan="5">The register is temporarily unavailable.</td></tr>';
    }
  }

  init().catch((err) => console.error('[AAFF]', err));
})();
