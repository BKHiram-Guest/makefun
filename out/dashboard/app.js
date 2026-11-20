// Token Radar Dashboard — Polished UI with multi-column sorting, filtering, detail drawer,
// keyboard navigation, dark/light/auto theme, and farm plan display.
// Reads window.RADAR (from data.js) and window.MODEL_CONSTANTS (from model-constants.json).
// Zero network: all data is embedded at build time.

(function () {
  'use strict';

  const DATA = window.RADAR;
  if (!DATA) {
    console.warn('[Token Radar] No RADAR data found on window');
    return;
  }

  // ---- State ----
  const state = {
    // Filters
    q: '',
    category: 'all',
    chain: 'all',
    tvlMin: 0,
    tvlMax: Infinity,
    // View
    tab: 'pre-token', // 'pre-token' | 'live'
    sort: { key: 'implied', dir: -1 }, // dir: -1 = desc, 1 = asc
    selected: null, // slug of selected row
    theme: 'auto', // 'light' | 'dark' | 'auto'
    // Internal
    _focusedIndex: -1,
  };

  // ---- Formatters ----
  const USD_FMT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    const abs = Math.abs(n);
    if (abs >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return USD_FMT.format(n);
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  function fmtRank(n) { return String(n); }

  // ---- Model computation (mirrors main.ts / lib/model.ts) ----
  function impliedOf(row, model) {
    const m = model || DATA.model;
    const growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    const growthMult = 1 + (growth / 100) * m.growth_weight;
    const age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    const maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * m.base_multiple * growthMult * maturity));
  }

  // ---- DOM Helpers ----
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(c => c && node.appendChild(c));
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function svg(path, size = 16) {
    return el('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      el('path', { d: path })
    );
  }

  // ---- Farm Plan Generation (mirrors main.ts logic) ----
  function chainOf(p) { return (p.chains && p.chains.length > 0) ? p.chains[0] : 'its main chain'; }

  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  function actionFor(p, capital, chain) {
    const c = (p.category || '').toLowerCase();
    if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
      return `Supply $${capital} of USDC to ${p.name} on ${chain} and keep the position open.`;
    if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
      return `Provide $${capital} of liquidity to ${p.name}'s main pool on ${chain} and keep the position open.`;
    if (c.includes('bridge'))
      return `Bridge $${capital} of USDC to ${chain} through ${p.name} and use the bridged funds in its app.`;
    if (c.includes('staking') || c.includes('restak'))
      return `Stake $${capital} of the chain's staking asset through ${p.name} and keep the receipt.`;
    if (c.includes('perpetual') || c.includes('derivative'))
      return `Deposit $${capital} of USDC as margin on ${p.name} and open one small hedge.`;
    if (c.includes('prediction'))
      return `Fund $${capital} and place a market position on ${p.name}.`;
    if (c.includes('curator') || c.includes('allocator'))
      return `Deposit $${capital} into a ${p.name} vault on ${chain} and keep the shares.`;
    if (c.includes('stable'))
      return `Mint or deposit $${capital} of the stable asset through ${p.name} on ${chain}.`;
    if (c.includes('rwa'))
      return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
    if (c.includes('insurance'))
      return `Buy $${capital} of cover from ${p.name} on ${chain} and keep the policy.`;
    return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
  }

  function farmSteps(p) {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(p.age_days);
    const steps = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
      { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ];
    return steps.map((s, i) => ({ ...s, index: i + 1 }));
  }

  // ---- URL Hash Sync ----
  function readHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    const params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvlMin')) state.tvlMin = parseFloat(params.get('tvlMin')) || 0;
    if (params.get('tvlMax')) state.tvlMax = parseFloat(params.get('tvlMax')) || Infinity;
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('sort')) {
      const [key, dir] = params.get('sort').split(',');
      if (key) state.sort.key = key;
      if (dir) state.sort.dir = parseInt(dir, 10) || -1;
    }
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('theme')) state.theme = params.get('theme');
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvlMin > 0) params.set('tvlMin', String(state.tvlMin));
    if (state.tvlMax < Infinity) params.set('tvlMax', String(state.tvlMax));
    if (state.selected) params.set('p', state.selected);
    params.set('sort', state.sort.key + ',' + state.sort.dir);
    params.set('tab', state.tab);
    if (state.theme !== 'auto') params.set('theme', state.theme);
    const next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- Filtering ----
  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return DATA.rows.filter((r) => {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (r.tvl_usd < state.tvlMin || r.tvl_usd > state.tvlMax) return false;
      if (!q) return true;
      const hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  // ---- Multi-column Sorting ----
  const SORT_KEYS = ['implied', 'name', 'tvl', 'growth', 'age', 'category', 'chain'];

  function sortedRows(list) {
    const { key, dir } = state.sort;
    if (!SORT_KEYS.includes(key)) return list;
    return list.slice().sort((a, b) => {
      let av, bv;
      switch (key) {
        case 'name':
          av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
        case 'tvl':
          av = a.tvl_usd; bv = b.tvl_usd; break;
        case 'growth':
          av = a.change_7d === null ? -Infinity : a.change_7d;
          bv = b.change_7d === null ? -Infinity : b.change_7d; break;
        case 'age':
          av = a.age_days === null ? Infinity : a.age_days;
          bv = b.age_days === null ? Infinity : b.age_days; break;
        case 'category':
          av = (a.category || '').toLowerCase();
          bv = (b.category || '').toLowerCase(); break;
        case 'chain':
          av = (a.chains || [])[0] || '';
          bv = (b.chains || [])[0] || ''; break;
        default: // 'implied'
          av = a.implied_value_usd; bv = b.implied_value_usd;
      }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      // Tie-breaker: slug for stability
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- Unique values for filter dropdowns ----
  function getCategories() {
    return Array.from(new Set(DATA.rows.map(r => r.category || 'Other'))).sort();
  }

  function getChains() {
    const chains = new Set();
    DATA.rows.forEach(r => (r.chains || []).forEach(c => chains.add(c)));
    return Array.from(chains).sort();
  }

  // ---- Theme Handling ----
  function applyTheme(theme) {
    state.theme = theme;
    const root = document.documentElement;
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = theme === 'dark' || (theme === 'auto' && prefersDark);
    root.setAttribute('data-theme', isDark ? 'dark' : 'light');
    updateThemeButton();
    writeHash();
  }

  function toggleTheme() {
    const order = ['auto', 'light', 'dark'];
    const idx = order.indexOf(state.theme);
    applyTheme(order[(idx + 1) % order.length]);
  }

  function updateThemeButton() {
    const btn = document.querySelector('.theme-toggle');
    if (!btn) return;
    const icons = {
      auto: '⚙️',
      light: '☀️',
      dark: '🌙',
    };
    btn.innerHTML = icons[state.theme];
    btn.setAttribute('aria-label', `Theme: ${state.theme} (click to cycle)`);
    btn.title = `Theme: ${state.theme}`;
  }

  // ---- Sort Header Helper ----
  function sortHeader(key, label, index) {
    const isActive = state.sort.key === key;
    return el('th', { scope: 'col', 'aria-sort': isActive ? (state.sort.dir < 0 ? 'descending' : 'ascending') : 'none' },
      el('button', {
        type: 'button',
        onclick: () => {
          if (state.sort.key === key) state.sort.dir = -state.sort.dir;
          else { state.sort.key = key; state.sort.dir = -1; }
          writeHash();
          render();
        },
        class: 'sort-btn'
      },
        label,
        isActive ? svg(state.sort.dir < 0 ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7', 12) : null
      )
    );
  }

  // ---- Render Functions ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: `Snapshot ${DATA.as_of}` }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: `${DATA.model_version} model` })
      ),
      el('button', {
        class: 'theme-toggle',
        type: 'button',
        'aria-label': `Theme: ${state.theme} (click to cycle)`,
        onclick: toggleTheme,
        title: `Theme: ${state.theme}`
      }, ['auto', 'light', 'dark'].includes(state.theme) ? (state.theme === 'auto' ? '⚙️' : state.theme === 'light' ? '☀️' : '🌙') : '⚙️')
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: `${DATA.watchlist_size} watchlist protocols, ranked by implied value` }),
        el('p', { text: `The watchlist is the floor: every protocol with at least $${Math.round(DATA.floor_usd / 1e6)}M of TVL and no token on record. The early radar adds ${DATA.early_size} pre-token protocols below that floor. Implied value is a model, not a promise.` }),
        el('p', { class: 'subtitle', text: `${DATA.board_size} total rows • Updated ${DATA.as_of}` })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: `${DATA.watchlist_size} / ${DATA.watchlist_size}` })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    const categories = getCategories();
    const chains = getChains();

    const search = el('input', {
      type: 'search',
      id: 'q',
      placeholder: 'Search name, category or chain…',
      value: state.q,
      'aria-label': 'Search the board',
      autocomplete: 'off'
    });
    search.addEventListener('input', () => {
      state.q = search.value;
      state._focusedIndex = -1;
      writeHash();
      render();
    });

    const catSelect = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(c => el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }))
    );
    catSelect.addEventListener('change', () => {
      state.category = catSelect.value;
      state._focusedIndex = -1;
      writeHash();
      render();
    });

    const chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(c => el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }))
    );
    chainSelect.addEventListener('change', () => {
      state.chain = chainSelect.value;
      state._focusedIndex = -1;
      writeHash();
      render();
    });

    const tvlMin = el('input', {
      type: 'number',
      id: 'tvlMin',
      placeholder: 'Min TVL ($)',
      value: state.tvlMin > 0 ? state.tvlMin : '',
      min: 0,
      step: 1e6,
      'aria-label': 'Minimum TVL'
    });
    tvlMin.addEventListener('input', () => {
      state.tvlMin = parseFloat(tvlMin.value) || 0;
      state._focusedIndex = -1;
      writeHash();
      render();
    });

    const tvlMax = el('input', {
      type: 'number',
      id: 'tvlMax',
      placeholder: 'Max TVL ($)',
      value: state.tvlMax < Infinity ? state.tvlMax : '',
      min: 0,
      step: 1e6,
      'aria-label': 'Maximum TVL'
    });
    tvlMax.addEventListener('input', () => {
      state.tvlMax = parseFloat(tvlMax.value) || Infinity;
      state._focusedIndex = -1;
      writeHash();
      render();
    });

    const preTab = el('button', {
      type: 'button',
      class: 'tab',
      'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false',
      text: 'Pre-token',
      onclick: () => { state.tab = 'pre-token'; state._focusedIndex = -1; writeHash(); render(); }
    });
    const liveTab = el('button', {
      type: 'button',
      class: 'tab',
      'aria-pressed': state.tab === 'live' ? 'true' : 'false',
      text: 'Live token',
      onclick: () => { state.tab = 'live'; state._focusedIndex = -1; writeHash(); render(); }
    });

    const rowCount = state.tab === 'pre-token' ? filteredRows().length : DATA.live.length;
    const countText = state.tab === 'pre-token' ? `${rowCount} rows shown` : `${rowCount} live-token protocols`;

    return el('div', { class: 'controls' },
      el('div', { class: 'field-group' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSelect),
        el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect)
      ),
      el('div', { class: 'field-group' },
        el('div', { class: 'field' }, el('label', { for: 'tvlMin', text: 'TVL min' }), tvlMin),
        el('div', { class: 'field' }, el('label', { for: 'tvlMax', text: 'TVL max' }), tvlMax)
      ),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, preTab, liveTab)),
      el('span', { class: 'count', text: countText })
    );
  }

  function boardTable() {
    const list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' },
        el('div', { class: 'empty' },
          svg('M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z', 64),
          el('h2', { text: 'No protocol matches that filter' }),
          el('p', { text: 'Clear the search or adjust filters to see the board again.' }),
          el('button', {
            class: 'button primary',
            type: 'button',
            text: 'Clear filters',
            onclick: () => {
              state.q = '';
              state.category = 'all';
              state.chain = 'all';
              state.tvlMin = 0;
              state.tvlMax = Infinity;
              state._focusedIndex = -1;
              writeHash();
              render();
            }
          })
        )
      );
    }

    const maxImplied = list[0].implied_value_usd || 1;
    const tbody = el('tbody');

    list.forEach((r, idx) => {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      const isSelected = state.selected === r.slug;
      const barPct = Math.max(3, Math.round((r.implied_value_usd / maxImplied) * 100));

      const tr = el('tr', {
        'data-selected': isSelected ? 'true' : 'false',
        tabindex: '0',
        'data-index': idx,
        onclick: () => openDetail(r.slug),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(r.slug);
          }
        }
      },
        el('td', { class: 'num', text: fmtRank(r.rank) }),
        el('td', null,
          el('div', { class: 'name' },
            el('b', { text: r.name }),
            el('span', { class: 'sub', text: `${r.category || 'Other'} on ${(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain')}` })
          )
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: `num ${growthClass}`, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null,
          el('div', { class: 'implied' },
            el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: `width:${barPct}%` })),
            el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
          )
        ),
        el('td', null, el('span', { class: 'status', 'data-status': 'watchlist', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });

    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', 0),
            sortHeader('name', 'Protocol', 1),
            sortHeader('tvl', 'TVL', 2),
            sortHeader('growth', '7d %', 3),
            sortHeader('age', 'Age', 4),
            sortHeader('implied', 'Implied', 5),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    const tbody = el('tbody');
    DATA.live.forEach((r) => {
      const growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      const growthClass = r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg';
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null,
          el('div', { class: 'name' },
            el('b', { text: r.name }),
            el('span', { class: 'sub', text: `${r.category || 'Other'} on ${(r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain')}` })
          )
        ),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: `num ${growthClass}`, text: growth }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', 'data-status': 'live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d %' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    const m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        `implied = round( tvl_usd × ${m.base_multiple} × (1 + clamp(change_7d, ${m.growth_floor}, ${m.growth_cap}) / 100 × ${m.growth_weight}) × (${m.maturity_floor} + min(age_days, ${m.maturity_days}) / ${m.maturity_days} × ${m.maturity_range}) )`
      ),
      el('p', { class: 'sub', text: `TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ${m.unknown_age_days} days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.` })
    );
  }

  // ---- Detail Drawer ----
  const dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', () => {
    state.selected = null;
    state._focusedIndex = -1;
    writeHash();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  function openDetail(slug) {
    const row = DATA.rows.find(r => r.slug === slug);
    if (!row) return;
    state.selected = slug;
    writeHash();

    dialog.textContent = '';
    const steps = farmSteps(row);
    const m = DATA.model;

    // Recompute model breakdown for this row
    const rawGrowth = row.change_7d === null ? 0 : row.change_7d;
    const growthPct = Math.min(m.growth_cap, Math.max(m.growth_floor, rawGrowth));
    const growthMult = 1 + (growthPct / 100) * m.growth_weight;
    const ageForModel = row.age_days ?? m.unknown_age_days;
    const maturityMult = m.maturity_floor + (Math.min(Math.max(ageForModel, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    const base = row.tvl_usd * m.base_multiple;
    const recomputed = Math.max(1, Math.round(base * growthMult * maturityMult));

    // Header
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: `Rank ${row.rank} of ${DATA.board_size}` }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: `${row.category || 'Other'} on ${(row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain')}` })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: () => dialog.close() })
    ));

    // Model Breakdown Section
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value breakdown' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Base multiple' }), el('b', { class: 'num', text: String(m.base_multiple) })),
        el('div', null, el('span', { text: 'Base value (TVL × base)' }), el('b', { class: 'num', text: fmtUsd(base) })),
        el('div', null, el('span', { text: '7d growth (clamped)' }), el('b', { class: `num ${growthPct >= 0 ? 'pos' : 'neg'}`, text: fmtPct(growthPct) })),
        el('div', null, el('span', { text: 'Growth weight' }), el('b', { class: 'num', text: String(m.growth_weight) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: growthMult.toFixed(4) })),
        el('div', null, el('span', { text: 'Age (days)' }), el('b', { class: 'num', text: row.age_days === null ? `unknown (${m.unknown_age_days} default)` : String(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity floor' }), el('b', { class: 'num', text: String(m.maturity_floor) })),
        el('div', null, el('span', { text: 'Maturity range' }), el('b', { class: 'num', text: String(m.maturity_range) })),
        el('div', null, el('span', { text: 'Maturity days' }), el('b', { class: 'num', text: String(m.maturity_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: maturityMult.toFixed(4) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: `Model ${DATA.model_version}: the page recomputes this row as ${fmtUsd(recomputed)}${recomputed === row.implied_value_usd ? ', matching board.json exactly.' : ', which differs — data would be stale.'} This is an estimate, not a price.` })
    ));

    // Farm Plan Section
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('div', { class: 'farm-plan' },
        el('div', { class: 'farm-plan-header' },
          el('span', { class: 'farm-plan-title', text: 'Farm Plan' }),
          el('span', { class: 'farm-plan-apr', text: 'Est. APR varies' })
        ),
        el('ol', { class: 'farm-plan-items' }, steps.map(s =>
          el('li', { class: 'farm-plan-item' },
            el('div', { class: 'farm-plan-item-info' },
              el('span', { class: 'farm-plan-item-name', text: `${s.index}. ${s.text.split(' Cost: ')[0]}` }),
              el('span', { class: 'farm-plan-item-chain', text: `Cost: ${s.cost} • Time: ${s.time}` })
            ),
            el('span', { class: 'farm-plan-item-apr', text: '→' })
          )
        ))
      )
    ));

    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // ---- Main Render ----
  function render() {
    const app = document.getElementById('board');
    app.textContent = '';

    const shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);

    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);

    app.setAttribute('aria-busy', 'false');
  }

  // ---- Keyboard Navigation ----
  window.addEventListener('keydown', (e) => {
    // Escape closes detail drawer
    if (e.key === 'Escape' && dialog.open) {
      dialog.close();
      return;
    }

    // Arrow keys / Home / End for table navigation (pre-token tab only, when no modifier keys)
    if (state.tab === 'pre-token' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const list = sortedRows(filteredRows());
      if (list.length === 0) return;

      let currentIdx = state._focusedIndex;
      if (currentIdx < 0) {
        // Find currently selected row
        const selectedIdx = list.findIndex(r => r.slug === state.selected);
        currentIdx = selectedIdx >= 0 ? selectedIdx : 0;
      }

      let nextIdx = currentIdx;
      switch (e.key) {
        case 'ArrowDown':
          nextIdx = Math.min(list.length - 1, currentIdx + 1);
          break;
        case 'ArrowUp':
          nextIdx = Math.max(0, currentIdx - 1);
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = list.length - 1;
          break;
        case 'Enter':
        case ' ':
          if (state.selected) return; // Let the row's own handler deal with it
          nextIdx = currentIdx;
          break;
        default:
          return;
      }

      if (nextIdx !== currentIdx || (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        state._focusedIndex = nextIdx;
        openDetail(list[nextIdx].slug);

        // Scroll the row into view
        const rowEl = document.querySelector(`tbody tr[data-index="${nextIdx}"]`);
        if (rowEl) rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  });

  // ---- Init ----
  readHash();
  applyTheme(state.theme);
  render();

  // Auto-apply system theme changes when in 'auto' mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.theme === 'auto') applyTheme('auto');
    });
  }
})();