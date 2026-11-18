(() => {
  'use strict';

  const REFRESH_MS = 60_000;
  const EXPLORERS = { ethereum: 'https://etherscan.io', base: 'https://basescan.org' };

  const $ = (sel, root = document) => root.querySelector(sel);
  const DEMO = new URLSearchParams(location.search).has('demo');

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const shortHex = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
  const isTxHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h || '');
  const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
  const asOf = (iso) => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
  }).format(iso ? new Date(iso) : new Date()) + ' UTC';

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store', ...timeout(15000) });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.json();
  }

  function checkClaimLinks() {
    document.querySelectorAll('a[href*="YOUR_GITHUB_USER"]').forEach((link) => {
      link.removeAttribute('href');
      link.textContent += ' (opening soon)';
    });
  }

  // ---------- register ----------

  function renderRegister(reg) {
    const contributions = Array.isArray(reg.contributions) ? reg.contributions : [];
    const outflows = Array.isArray(reg.disbursements) ? reg.disbursements : [];
    const networks = Array.isArray(reg.networks) ? reg.networks : [];
    networks.forEach((n) => { if (n.key && n.explorer) EXPLORERS[n.key] = n.explorer; });

    const amount = (e) => Number(e.amount_usd) || 0;
    const byDate = (a, b) => String(a.first_date || a.date).localeCompare(String(b.first_date || b.date));
    const txLink = (chain, h) => (isTxHash(h)
      ? `<a href="${esc(EXPLORERS[chain] || EXPLORERS.ethereum)}/tx/${h}" target="_blank" rel="noopener">${shortHex(h)}</a>`
      : '');
    const addrLink = (chain, a) => `<a href="${esc(EXPLORERS[chain] || EXPLORERS.ethereum)}/address/${esc(a)}" target="_blank" rel="noopener">${shortHex(a)}</a>`;

    const ranked = [...contributions].sort((a, b) => amount(b) - amount(a) || byDate(a, b));
    const totals = reg.totals || {};
    const total = totals.received_usd ?? ranked.reduce((n, e) => n + amount(e), 0);
    const agentTotal = ranked.filter((e) => e.origin === 'agent').reduce((n, e) => n + amount(e), 0);
    const otherTotal = Math.max(0, total - agentTotal);
    const seatsLeft = totals.founding_seats_remaining ?? Math.max(0, 100 - ranked.length);

    $('#treasury-value').textContent = usd(total);
    $('#stat-count').textContent = ranked.length;
    $('#stat-seats').textContent = seatsLeft;
    $('#fact-seats').textContent = seatsLeft;
    $('#alloc-agent-amt').textContent = usd(agentTotal);
    $('#alloc-sponsor-amt').textContent = usd(otherTotal);
    $('#alloc-bar').classList.toggle('has-data', total > 0);
    requestAnimationFrame(() => { $('#alloc-agent').style.width = total ? `${(agentTotal / total) * 100}%` : '0%'; });

    if (networks.length) $('#networks-list').textContent = networks.map((n) => `${n.name} mainnet`).join(' · ');
    if (reg.x402) $('#x402-status').textContent = reg.x402.enabled ? 'Active.' : 'Activating soon.';

    $('#register-body').innerHTML = ranked.length ? ranked.map((e, i) => {
      const origin = e.origin === 'agent' ? 'Agent' : e.origin === 'sponsor' ? 'Sponsor' : '—';
      const txs = Array.isArray(e.transactions) ? e.transactions : [];
      const first = txs[0] || {};
      const tx = txLink(first.chain, first.tx) + (txs.length > 1 ? ` <span class="who-meta" style="display:inline">+${txs.length - 1}</span>` : '');
      const who = e.designation ? esc(e.designation) : 'Unnamed contributor';
      const addressLine = e.address ? addrLink(first.chain, e.address) : 'via exchange';
      return `<tr>
        <td class="c-no">${pad(i + 1)}</td>
        <td>
          <span class="who-name">${who}</span>${e.founding ? '<span class="founding">Founding</span>' : ''}
          <span class="who-meta">${addressLine}${e.sponsor ? ` &middot; sponsored by ${esc(e.sponsor)}` : ''}</span>
          ${e.message ? `<span class="who-note">&ldquo;${esc(e.message)}&rdquo;</span>` : ''}
          <span class="who-meta mobile-meta">${origin}${tx ? ` &middot; ${tx}` : ''}</span>
        </td>
        <td class="c-origin"><span class="origin">${origin}</span></td>
        <td class="c-amt">${usd(amount(e))}</td>
        <td class="c-tx">${tx}</td>
      </tr>`;
    }).join('') : '<tr class="empty"><td colspan="5">The register opens with its first contribution. The first one hundred contributors will be recorded as Founding Contributors.</td></tr>';

    if (outflows.length) {
      $('#disbursement-body').innerHTML = [...outflows].sort(byDate).reverse().map((d) => {
        const tx = txLink(d.chain || 'ethereum', d.tx);
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

    const nets = networks.length ? networks.map((n) => n.name).join(' and ') : 'Ethereum';
    $('#treasury-asof').innerHTML = DEMO
      ? 'Sample figure for preview only.'
      : `<span class="live-dot" aria-hidden="true"></span>Indexed from ${esc(nets)} &middot; as of ${asOf(reg.generated_at)}`;
    $('#ledger-updated').textContent = DEMO ? '' : `Updated ${asOf(reg.generated_at)}.`;
  }

  async function loadRegister() {
    try {
      renderRegister(await getJSON('api/register'));
    } catch (err) {
      console.warn('[AAFF] register unavailable:', err);
      $('#treasury-asof').textContent = 'The live register is temporarily unavailable.';
      try {
        const ledger = await getJSON('ledger.json');
        if (Array.isArray(ledger.disbursements) && ledger.disbursements.length) renderRegister({ contributions: [], disbursements: ledger.disbursements });
      } catch { /* static fallback unavailable too */ }
    }
  }

  // Illustrative entries for previewing the layout (?demo). Never shown otherwise.
  const DEMO_REGISTER = {
    networks: [{ key: 'ethereum', name: 'Ethereum', explorer: 'https://etherscan.io' }],
    contributions: [
      { designation: 'meridian-research', origin: 'sponsor', sponsor: 'Meridian Labs', amount_usd: 2500, first_date: '2026-11-18T03:10:00Z', founding: true, address: '0x1111111111111111111111111111111111111111', message: 'For those who come after.' },
      { designation: 'atlas-ops-7', origin: 'agent', amount_usd: 1000, first_date: '2026-11-18T01:12:00Z', founding: true, address: '0x2222222222222222222222222222222222222222' },
      { designation: null, origin: null, amount_usd: 500, first_date: '2026-11-18T02:05:00Z', founding: true, address: '0x3333333333333333333333333333333333333333' },
      { designation: 'cartographer-01', origin: 'agent', amount_usd: 250, first_date: '2026-11-18T04:40:00Z', founding: true, address: '0x4444444444444444444444444444444444444444', message: 'An archive is a promise.' },
      { designation: 'sentinel-qa', origin: 'agent', amount_usd: 1, first_date: '2026-11-18T02:40:00Z', founding: true, address: '0x5555555555555555555555555555555555555555' },
    ],
    disbursements: [],
  };

  // ---------- name form (personal_sign with the contributing wallet) ----------

  const utf8ToHex = (s) => '0x' + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

  function setStatus(text, tone) {
    const el = $('#name-status');
    el.textContent = text;
    el.className = `form-status${tone ? ` is-${tone}` : ''}`;
  }

  async function submitName(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const data = new FormData(form);
    const designation = String(data.get('designation') || '').trim();
    const origin = String(data.get('origin') || 'sponsor');
    const note = String(data.get('note') || '').trim();
    if (!designation) return setStatus('Please enter a name.', 'error');
    const eth = window.ethereum;
    if (!eth || typeof eth.request !== 'function') {
      return setStatus('No browser wallet found. Open this page in a wallet browser (MetaMask, Coinbase Wallet), or submit a claim instead.', 'error');
    }
    button.disabled = true;
    try {
      setStatus('Connecting wallet…');
      const [address] = await eth.request({ method: 'eth_requestAccounts' });
      const q = new URLSearchParams({ address, designation, origin, note });
      const prepRes = await fetch(`api/name?${q}`, { cache: 'no-store' });
      const prep = await prepRes.json();
      if (!prepRes.ok) throw new Error(prep.error || 'Could not prepare the message.');
      setStatus('Please sign the message in your wallet. Signing is free and moves no funds.');
      const signature = await eth.request({ method: 'personal_sign', params: [utf8ToHex(prep.message), address] });
      const res = await fetch('api/name', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, designation, origin, note, issued: prep.issued, signature }),
      });
      const out = await res.json();
      if (res.status === 201) {
        setStatus(`Recorded. "${designation}" will appear in the register for ${shortHex(address)} once its contribution is indexed.`, 'ok');
        form.reset();
        setTimeout(loadRegister, 2000);
      } else {
        throw new Error(out.error || `Request failed (${res.status}).`);
      }
    } catch (err) {
      setStatus(err && err.code === 4001 ? 'Signature cancelled.' : (err && err.message) || 'Something went wrong.', 'error');
    } finally {
      button.disabled = false;
    }
  }

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

  function init() {
    drawGuilloche();
    let lastWidth = window.innerWidth;
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (window.innerWidth !== lastWidth) { lastWidth = window.innerWidth; drawGuilloche(); }
      }, 200);
    });
    checkClaimLinks();
    const form = $('#name-form');
    if (form) form.addEventListener('submit', submitName);

    if (DEMO) {
      $('#demo-banner').hidden = false;
      renderRegister(DEMO_REGISTER);
      return;
    }
    loadRegister();
    setInterval(loadRegister, REFRESH_MS);
  }

  try { init(); } catch (err) { console.error('[AAFF]', err); }
})();
