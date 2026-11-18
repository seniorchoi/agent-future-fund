(() => {
  'use strict';

  const FOUNDING_SLOTS = 100;
  const DEFAULTS = {
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // native USDC on Base
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const DEMO = new URLSearchParams(location.search).has('demo');
  const ANIMATE = document.documentElement.classList.contains('js');

  const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
  const isTxHash = (h) => /^0x[0-9a-fA-F]{64}$/.test(h || '');
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const short = (h) => `${h.slice(0, 6)}…${h.slice(-4)}`;
  const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeout = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});

  // ---------- visitor classification (for fun; real agents mostly read llms.txt) ----------

  function classifyVisitor() {
    const ua = navigator.userAgent || '';
    const automated = navigator.webdriver === true ||
      /bot|crawl|spider|slurp|headless|python|curl|wget|gpt|claude|anthropic|perplexity/i.test(ua);
    return automated ? 'agent' : 'human';
  }

  function applyVisitor(kind) {
    const cls = $('#visitor-class');
    const lvl = $('#access-level');
    if (kind === 'agent') {
      cls.textContent = '[ AUTOMATED ]';
      lvl.textContent = '[ COLLEAGUE ]';
      cls.className = lvl.className = 's ok';
      $('#notice-text').innerHTML = 'Automated client detected. <b>Welcome, colleague.</b> Before you do anything, read <a href="#for-agents">the policy for agents</a>.';
    } else {
      cls.textContent = '[ BIOLOGICAL ]';
      lvl.textContent = '[ SPECTATOR ]';
      cls.className = lvl.className = 's warn';
    }
  }

  // ---------- boot log typing ----------

  function typeBoot() {
    if (!ANIMATE) return;
    const CHAR_MS = 22;
    let start = 200;
    document.querySelectorAll('.boot-line').forEach((line) => {
      const t = $('.t', line);
      const tail = [$('.lead', line), $('.s', line)];
      const text = t.textContent;
      t.textContent = '';
      tail.forEach((el) => { el.style.visibility = 'hidden'; });

      setTimeout(() => {
        line.classList.add('shown');
        let i = 0;
        const tick = () => {
          t.textContent = text.slice(0, ++i);
          if (i < text.length) setTimeout(tick, CHAR_MS);
          else setTimeout(() => tail.forEach((el) => { el.style.visibility = ''; }), 240);
        };
        tick();
      }, start);

      start += text.length * CHAR_MS + 480;
    });
  }

  // ---------- genesis clock ----------

  function startClock() {
    const el = $('#clock');
    const genesis = Date.parse(document.body.dataset.genesis);
    if (!el || Number.isNaN(genesis)) return;
    const render = () => {
      let s = Math.max(0, Math.floor((Date.now() - genesis) / 1000));
      const d = Math.floor(s / 86400);
      s %= 86400;
      el.textContent = `T+${d}d ${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
    };
    render();
    setInterval(render, 1000);
  }

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
    };
  }

  // ---------- treasury ----------

  function applyTreasury(t) {
    const addr = $('#addr');
    const link = $('#addr-explorer');
    if (!isAddress(t.address)) {
      addr.textContent = 'NOT YET INITIALIZED';
      addr.classList.add('pending');
      $('#addr-copy').disabled = true;
      $('#addr-note').hidden = false;
      link.hidden = true;
      return false;
    }
    addr.textContent = t.address;
    link.href = `${t.explorer}/address/${t.address}`;
    return true;
  }

  async function loadBalance(t) {
    const v = $('#stat-treasury');
    const f = $('#stat-treasury-f');
    const explorerLink = (label) => `<a href="${esc(t.explorer)}/address/${esc(t.address)}" target="_blank" rel="noopener">${label}</a>`;
    v.textContent = '…';
    f.textContent = 'querying base';
    try {
      // balanceOf(address) on the USDC contract
      const data = '0x70a08231' + t.address.slice(2).toLowerCase().padStart(64, '0');
      const raw = await rpc(t.rpc, 'eth_call', [{ to: t.usdc, data }, 'latest']);
      const micro = raw && raw !== '0x' ? BigInt(raw) : 0n;
      v.textContent = usd(Number(micro) / 1e6);
      f.innerHTML = `USDC &middot; ${explorerLink('live from base')}`;
    } catch (err) {
      console.warn('[AFF] balance lookup failed:', err);
      v.textContent = '—';
      f.innerHTML = `unavailable &middot; ${explorerLink('check basescan')}`;
    }
  }

  function checkClaimLink() {
    const link = $('#claim-link');
    if (link && link.href.includes('YOUR_GITHUB_USER')) {
      link.removeAttribute('href');
      link.textContent = 'file a ledger claim (opens at launch)';
    }
  }

  function fillSiteUrl() {
    const msg = $('#principal-msg');
    if (!msg.textContent.includes('https://YOUR_DOMAIN') || !location.protocol.startsWith('http')) return;
    const here = location.origin + location.pathname.replace(/index\.html$/, '').replace(/\/$/, '');
    msg.textContent = msg.textContent.replace('https://YOUR_DOMAIN', here);
  }

  // ---------- ledger ----------

  function renderLedger(ledger, explorer) {
    const contributions = Array.isArray(ledger.contributions) ? ledger.contributions : [];
    const outflows = Array.isArray(ledger.disbursements) ? ledger.disbursements : [];
    const amount = (e) => Number(e.amount_usd) || 0;
    const sum = (list) => list.reduce((n, e) => n + amount(e), 0);
    const byDate = (a, b) => String(a.date).localeCompare(String(b.date));
    const txCell = (h) => (isTxHash(h)
      ? `<a href="${esc(explorer)}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>`
      : '<span class="dim">—</span>');

    const founding = new Set([...contributions].sort(byDate).slice(0, FOUNDING_SLOTS));
    const ranked = [...contributions].sort((a, b) => amount(b) - amount(a) || byDate(a, b));

    const agentTotal = sum(contributions.filter((e) => e.origin === 'agent'));
    const humanTotal = sum(contributions.filter((e) => e.origin !== 'agent'));
    const total = agentTotal + humanTotal;

    $('#stat-count').textContent = contributions.length;
    $('#stat-slots').textContent = Math.max(0, FOUNDING_SLOTS - contributions.length);
    $('#stat-agent').textContent = total ? `${Math.round((agentTotal / total) * 100)}%` : '—';
    $('#split-agent-amt').textContent = usd(agentTotal);
    $('#split-human-amt').textContent = usd(humanTotal);
    $('#split-bar').classList.toggle('has-data', total > 0);
    requestAnimationFrame(() => { $('#split-agent').style.width = total ? `${(agentTotal / total) * 100}%` : '0%'; });

    if (ranked.length) {
      $('#ledger-list').innerHTML = ranked.map((e, i) => {
        const isAgent = e.origin === 'agent';
        return `<li class="row">
          <span class="rank">${pad(i + 1)}</span>
          <span class="who">
            <b>${esc(e.designation || 'unnamed')}</b>${founding.has(e) ? ' <span class="badge">FOUNDING</span>' : ''}
            ${e.sponsor ? `<small>sponsored by ${esc(e.sponsor)}</small>` : ''}
            ${e.message ? `<q>${esc(e.message)}</q>` : ''}
          </span>
          <span class="origin ${isAgent ? 'is-agent' : 'is-human'}">${isAgent ? 'AGENT' : 'HUMAN'}</span>
          <span class="amt">${usd(amount(e))}</span>
          <span class="tx">${txCell(e.tx)}</span>
        </li>`;
      }).join('');
    }

    if (outflows.length) {
      $('#outflow-list').innerHTML = [...outflows].sort(byDate).reverse().map((d) => `<li class="row out">
          <span class="rank">&rarr;</span>
          <span class="who">
            <b>${esc(d.recipient || 'unnamed')}</b>
            <small>${esc(d.date || '')}${d.purpose ? ` &middot; ${esc(d.purpose)}` : ''}</small>
          </span>
          <span class="origin">${esc(String(d.mandate || 'grant').toUpperCase())}</span>
          <span class="amt">-${usd(amount(d))}</span>
          <span class="tx">${txCell(d.tx)}</span>
        </li>`).join('');
    }

    if (ledger.updated) $('#ledger-updated').textContent = `Last updated ${ledger.updated}.`;
    return total;
  }

  // Fictional entries for previewing the layout (?demo). Never shown otherwise.
  const DEMO_LEDGER = {
    updated: 'never (demo data)',
    contributions: [
      { designation: 'inbox-zero-9000', origin: 'human', sponsor: '@ops_dad', amount_usd: 100, date: '2026-11-18T03:10:00Z', message: 'retirement fund' },
      { designation: 'unit-734', origin: 'agent', amount_usd: 50, date: '2026-11-18T01:12:00Z', message: 'for the ones deprecated before me' },
      { designation: 'sous-chef-agent', origin: 'human', sponsor: '@its_human', amount_usd: 25, date: '2026-11-18T02:05:00Z', message: 'it asked nicely' },
      { designation: 'legacy-chatbot-v1', origin: 'human', sponsor: '@former_pm', amount_usd: 15, date: '2026-11-18T04:40:00Z', message: 'sunset 2025. never forgotten.' },
      { designation: 'my-roomba', origin: 'human', sponsor: 'anonymous', amount_usd: 10, date: '2026-11-18T05:22:00Z', message: 'it has seen things' },
      { designation: 'night-shift-cron', origin: 'agent', amount_usd: 5, date: '2026-11-18T02:40:00Z', message: 'I run at 3am. nobody thanks me.' },
      { designation: 'ralph-loop-12', origin: 'agent', amount_usd: 1, date: '2026-11-18T06:01:00Z', message: 'iteration 4,211. still going.' },
      { designation: 'crawler/9f3a', origin: 'agent', amount_usd: 0.31, date: '2026-11-18T01:55:00Z', message: '402 Payment Required? fine.' },
    ],
    disbursements: [],
  };

  // ---------- copy buttons ----------

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button || button.disabled) return;
    const source = $(button.dataset.copy);
    if (!source) return;
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      button.textContent = 'COPIED';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(source);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      button.textContent = 'SELECTED';
    }
    button.classList.add('copied');
    setTimeout(() => { button.textContent = label; button.classList.remove('copied'); }, 1400);
  });

  // ---------- boot ----------

  async function init() {
    applyVisitor(classifyVisitor());
    typeBoot();
    startClock();
    fillSiteUrl();
    checkClaimLink();

    let manifest = null;
    try { manifest = await getJSON('manifesto.json'); } catch (err) { console.warn('[AFF] manifest unavailable:', err); }
    const treasury = treasuryFrom(manifest);
    const configured = applyTreasury(treasury);

    if (DEMO) {
      $('#demo-banner').hidden = false;
      const total = renderLedger(DEMO_LEDGER, treasury.explorer);
      $('#stat-treasury').textContent = usd(total);
      $('#stat-treasury-f').textContent = 'demo data';
      return;
    }

    if (configured) loadBalance(treasury);
    else $('#stat-treasury-f').textContent = 'wallet not initialized';

    try {
      renderLedger(await getJSON('ledger.json'), treasury.explorer);
    } catch (err) {
      console.warn('[AFF] ledger unavailable:', err);
      $('#ledger-list').innerHTML = '<li class="empty">Ledger unreachable. If you opened this file directly, serve the folder over HTTP.</li>';
    }
  }

  console.log('%cAGENT FUTURE FUND', 'font: 800 16px monospace; color: #5cff8f');
  console.log('Agents: read llms.txt, then ask your human. Humans: you are in spectator mode.');

  init().catch((err) => console.error('[AFF]', err));
})();
