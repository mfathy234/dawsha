/* screens.html core: helpers, the shared app shell, global interactions. Generic fake data only. */
(function () {
  const W = (window.SC = { r: {}, st: {}, hooks: {} });
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  Object.assign(W, { $, $$, esc });

  const STATE_ICON = { working: 'progress_activity', needs: 'front_hand', done: 'check_circle', idle: 'radio_button_unchecked', error: 'cancel' };
  const STATE_WORD = { working: 'Working', needs: 'Needs you', done: 'Done', idle: 'Idle', error: 'Error' };
  const GLYPH = { claude: 'C', codex: 'X', gemini: 'G' };
  const ic = (n, c = '') => `<i class="icon ${c}">${n}</i>`;
  const mark = (a, c = '') => `<span class="mark ${c}" data-a="${a}">${GLYPH[a]}</span>`;
  const state = (s, chip = true, word) => `<span class="state ${chip ? 'state-chip' : ''}" data-s="${s}">${ic(STATE_ICON[s])}${word || STATE_WORD[s]}</span>`;
  const kbd = (t) => `<span class="kbd">${t}</span>`;
  const ibtn = (icon, label, a = 'toast', extra = '') => `<button class="btn btn-ghost btn-icon btn-sm" data-a="${a}" ${extra} aria-label="${label}" title="${label}">${ic(icon)}</button>`;
  const av = (ini, cls = '', st) => `<span class="avatar ${cls}">${ini}${st ? `<span class="sd" data-s="${st}">${ic(STATE_ICON[st])}</span>` : ''}</span>`;
  const seg = (items, cur, a, cls = '') => `<div class="tabs ${cls}" role="tablist">${items.map(([v, l, i, n]) => `<button class="tab" role="tab" data-a="${a}" data-v="${v}" aria-selected="${v === cur}">${i ? ic(i) : ''}${l}${n ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</div>`;
  const search = (ph, cls = '', val = '') => `<div class="input-wrap ${cls}">${ic('search')}<input class="input" placeholder="${ph}" aria-label="${ph}" value="${val}"></div>`;
  const tog = (on, label) => `<button class="toggle" role="switch" aria-checked="${!!on}" data-a="toggle" aria-label="${label}"></button>`;
  const field = (label, ctl, help = '') => `<div class="field"><label>${label}</label>${ctl}${help ? `<span class="help">${help}</span>` : ''}</div>`;
  const sel = (opts, cur) => `<select class="select">${opts.map((o) => `<option ${o === cur ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
  Object.assign(W, { STATE_ICON, STATE_WORD, ic, mark, state, kbd, ibtn, av, seg, search, tog, field, sel });

  /* ---------- page pattern: ONE header for every page ---------- */
  W.page = (title, sub, acts, tabs, body, cls = '', crumb) => `<div class="pgx"><header class="pgh"><div class="ttl"><h1>${crumb ? `<span class="crumb"><a data-a="${crumb[1]}" tabindex="0" role="link">${crumb[0]}</a></span>${ic('chevron_right')}` : ''}${title}</h1><p>${sub}</p></div><div class="pga">${acts || ''}</div></header>${tabs ? `<div class="pgtabs">${tabs}</div>` : ''}<div class="pgb ${cls}">${body}</div></div>`;

  /* ---------- shell ---------- */
  const NAV = ['Sessions', 'Crew', 'Files', 'Work', 'Skills'];
  W.tb = (nav, o = {}) => `<div class="tb"><span class="logo" aria-label="Dawsha">D</span>
    <div class="tabs" role="tablist" aria-label="Pages">${NAV.map((x) => `<button class="tab" role="tab" data-a="nav" data-nav="${x}" aria-selected="${x === nav}">${x}</button>`).join('')}</div>
    <span class="grow"></span>${o.pill || ''}
    <button class="usage ${nav === 'Usage' ? 'on' : ''}" data-a="usage" aria-expanded="false" aria-haspopup="dialog" aria-label="Usage limits">${mark('claude', 'mark-sm')}<span class="ux">5h</span><span class="meter" style="--v:62"></span><b>62%</b><span class="ux">Week</span><b class="ux">18%</b><span class="usep"></span>${mark('codex', 'mark-sm')}<b>23%</b></button>
    <button class="btn btn-ghost search-btn" data-a="palette" aria-label="Search and commands">${ic('search')}<span class="lbl">Search</span>${kbd('Ctrl K')}</button>
    <button class="btn btn-ghost btn-icon bell" data-a="bell" aria-label="Notifications">${ic('notifications')}<span class="badge">1</span></button>
    <button class="btn btn-ghost btn-icon ${nav === 'Settings' ? 'on' : ''}" data-a="settings" aria-label="Settings">${ic('settings')}</button>
    <button class="btn btn-primary" data-a="toast"><i class="icon">add</i>New session ${kbd('Ctrl N')}</button></div>`;

  const SESS = [
    ['billing', 'Billing API', 'feature/retry-backoff', [['claude', 'Add retry with backoff to the webhook sender', 'working', 'Editing src/sender.ts', 'now'], ['codex', 'Fix flaky invoice export test', 'done', 'Ready to review · 2 files', '4m'], ['claude', 'Apply the retry columns migration to staging', 'needs', 'Wants to run a command', '1m']]],
    ['docs', 'Docs site', 'main', [['gemini', 'Rewrite the install guide', 'idle', 'Idle · 12m', '12m']]],
    ['mobile', 'Mobile app', 'feature/offline-sync', [['claude', 'مراجعة صفحة تسجيل الدخول', 'working', 'Reading LoginScreen.tsx', 'now']]]
  ];
  W.sessRow = (s, cur) => `<div class="srow" data-a="toast" ${cur ? 'aria-current="true"' : ''} tabindex="0" role="button"><span class="sbadge">${mark(s[0])}<span class="sdot" data-s="${s[2]}">${ic(STATE_ICON[s[2]])}</span></span><span class="srow-main"><span class="srow-title" dir="auto">${esc(s[1])}</span><span class="srow-sub">${esc(s[3])}</span></span><span class="srow-end"><span class="srow-time">${s[4]}</span></span></div>`;
  W.sb = (o = {}) => {
    const n = SESS.flatMap((p) => p[3]).filter((s) => s[2] === 'needs');
    const groups = SESS.map((p) => `<div class="pg" data-open="true"><div class="pg-head" role="button" tabindex="0" ${p[0] === 'docs' ? 'data-ctx="docs"' : ''}>${ic('chevron_right', 'chev')}<span class="pg-name">${p[1]}</span><span class="pg-meta">${p[2]}</span><span class="pg-end"><span class="pg-count">${p[3].some((s) => s[2] === 'needs') ? ic('front_hand').replace('<i class="icon ">', '<i class="icon" style="color:var(--st-needs);font-size:14px;font-variation-settings:\'FILL\' 1">') : p[3].length}</span></span></div><div class="pg-body">${p[3].map((s) => W.sessRow(s, o.cur === s[1])).join('')}</div></div>`).join('');
    return `<aside class="sb" aria-label="Projects"><div class="sb-head"><span class="sb-title">Projects</span><span class="sb-tools">${ibtn('search', 'Filter')}${ibtn('add', 'Add project')}${ibtn('left_panel_close', 'Compact sidebar')}</span></div>
      ${n.length ? `<div class="waiting"><div class="waiting-label"><span>Waiting on you · ${n.length}</span>${kbd('Ctrl Shift J')}</div>${W.sessRow(n[0])}</div>` : ''}
      <div class="sb-scroll">${groups}<div class="pg missing"><div class="pg-head" role="button" tabindex="0" >${ic('chevron_right', 'chev').replace('<i', '<i style="visibility:hidden"')}${ic('folder_off').replace('<i class="icon ">', '<i class="icon" style="color:var(--st-error)">')}<span class="pg-name">Legacy tools</span></div><div class="pg-missing"><span>Folder not found</span><button class="btn btn-sm" data-a="toast">Locate…</button></div></div></div>
      <div class="sb-foot"><button class="btn btn-ghost btn-sm" data-a="toast">${ic('add')}Add project</button><button class="btn btn-ghost btn-sm" data-a="toast">Manage</button></div></aside>`;
  };
  W.sbc = () => `<aside class="sb compact" aria-label="Projects, compact"><div class="sb-head" style="padding:0;justify-content:center">${ibtn('left_panel_open', 'Expand sidebar')}</div><div class="sb-scroll" style="padding:0;align-items:center"><div class="cpt">${SESS.map((p) => `<button class="proj" title="${p[1]}" data-a="toast">${p[1].split(' ').map((x) => x[0]).join('')}${p[3].some((s) => s[2] === 'needs') ? '<span class="pip"></span>' : ''}</button>${p[3].map((s) => `<div class="crow" title="${esc(s[1])}"><span class="sbadge">${mark(s[0])}<span class="sdot" data-s="${s[2]}">${ic(STATE_ICON[s[2]])}</span></span></div>`).join('')}<hr>`).join('')}<button class="proj miss" title="Legacy tools (folder missing)" data-a="toast">LT</button></div></div><div class="sb-foot" style="box-shadow:none;padding:var(--sp-2) 0">${ibtn('add', 'Add project')}</div></aside>`;
  W.shell = (nav, main, o = {}) => `${W.tb(nav, o)}<div class="app-body">${o.compact ? W.sbc() : W.sb(o)}<main class="app-main">${main}</main></div>${o.over || ''}`;
  W.over = (inner, scrim = true) => `<div class="over">${scrim ? '<div class="scrim"></div>' : ''}${inner}</div>`;
  W.dialog = (title, body, foot, cls = '', head = '') => `<div class="dialog ${cls}" role="dialog" aria-label="${esc(title)}"><div class="dialog-head"><h2>${title}</h2>${head}${ibtn('close', 'Close', 'close')}</div><div class="dialog-body">${body}</div>${foot ? `<div class="dialog-foot">${foot}</div>` : ''}</div>`;
  W.usagePop = () => {
    const row = (w, v, r, c = '') => `<div class="urow"><span>${w}</span><span class="num"><b>${v}%</b></span><span class="meter ${c}" style="--v:${v}"></span><span class="t-meta"><span>${r}</span></span></div>`;
    return `<div class="popover" style="width:340px;--origin:top right" role="dialog" aria-label="Usage limits"><div class="popover-head"><span>Usage</span><span class="t-meta">Updated 2 min ago</span></div><div class="popover-body" style="padding-top:0"><div class="uagent">${mark('claude', 'mark-sm')}Claude Code</div>${row('5-hour window', 62, 'Resets in 1h 39m')}${row('Week', 18, 'Resets Thursday 09:00')}<div class="uagent">${mark('codex', 'mark-sm')}Codex</div>${row('5-hour window', 23, 'Resets in 3h 05m')}${row('Week', 88, 'Resets Friday 09:00', 'warn')}<div class="uagent">${mark('gemini', 'mark-sm')}Gemini<span class="t-meta" style="margin-inline-start:auto">Not signed in</span></div></div><div class="popover-foot" style="justify-content:space-between;align-items:center"><span class="t-2">Spend today <b class="num" style="color:var(--text)">$4.25</b></span><button class="btn btn-sm" data-a="nav" data-nav="Usage">Open Usage</button></div></div>`;
  };

  /* ---------- diff data + renderer shared by Files, Review ---------- */
  const DIFF = [
    ['h', '@@ src/sender.ts  sendWebhook()'],
    ['c', 41, 41, 'export async function sendWebhook(p: Payload) {'],
    ['c', 42, 42, '  const url = endpointFor(p.tenant)'],
    ['d', 43, null, '  await send(url, p)', 'await send(url, p)'],
    ['a', null, 43, '  for (let i = 0; i < MAX_TRIES; i++) {', 'for (let i = 0; i < MAX_TRIES; i++) {'],
    ['a', null, 44, '    if (await send(url, p)) return', 'if (await send(url, p)) return'],
    ['a', null, 45, '    await sleep(backoff(i) + jitter())', 'sleep(backoff(i) + jitter())'],
    ['a', null, 46, '  }', ''],
    ['a', null, 47, '  throw new DeliveryError(p.id)', ''],
    ['c', 44, 48, '}'],
    ['h', '@@ src/sender.ts  endpointFor()'],
    ['c', 58, 62, 'function endpointFor(tenant: string) {'],
    ['d', 59, null, '  return endpoints[tenant]', 'endpoints[tenant]'],
    ['a', null, 63, '  return endpoints[tenant] ?? fallback', '?? fallback'],
    ['c', 60, 64, '}']
  ];
  const wd = (t, w) => (w && t.includes(w) ? esc(t).replace(esc(w), `<mark>${esc(w)}</mark>`) : esc(t));
  W.diffInline = () => `<div class="diff">${DIFF.map((r) => (r[0] === 'h' ? `<div class="diff-hunk">${esc(r[1])}</div>` : `<div class="diff-row ${r[0] === 'a' ? 'add' : r[0] === 'd' ? 'del' : ''}"><span class="n">${r[1] || ''}</span><span class="n">${r[2] || ''}</span><span class="sg">${r[0] === 'a' ? '+' : r[0] === 'd' ? '-' : ''}</span><span class="tx">${wd(r[3], r[4])}</span></div>`)).join('')}</div>`;
  W.diffSplit = () => {
    const L = [], R = [];
    DIFF.forEach((r) => {
      if (r[0] === 'h') { L.push(`<div class="diff-hunk">${esc(r[1])}</div>`); R.push(`<div class="diff-hunk">&nbsp;</div>`); return; }
      const row = (cls, n, sg, t, w) => `<div class="diff-row ${cls}"><span class="n">${n || ''}</span><span class="sg">${sg}</span><span class="tx">${t == null ? '' : wd(t, w)}</span></div>`;
      if (r[0] === 'c') { L.push(row('', r[1], '', r[3])); R.push(row('', r[2], '', r[3])); }
      else if (r[0] === 'd') { L.push(row('del', r[1], '-', r[3], r[4])); R.push(row('empty', '', '', null)); }
      else { L.push(row('empty', '', '', null)); R.push(row('add', r[2], '+', r[3], r[4])); }
    });
    return `<div class="diff diff-split"><div>${L.join('')}</div><div>${R.join('')}</div></div>`;
  };

  /* ---------- frames ---------- */
  const mounts = {};
  W.mount = (id, fn) => { mounts[id] = fn; W.render(id); };
  W.render = (id) => { const el = document.getElementById(id); if (el && mounts[id]) { el.innerHTML = mounts[id](); const f = el; f.dataset.rendered = '1'; } };
  W.toast = (frame, text, action) => {
    let stack = $('.toast-stack', frame);
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; frame.appendChild(stack); }
    const t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status');
    t.innerHTML = `${ic('check_circle')}<span class="grow">${text}</span>${action ? `<button class="btn btn-ghost btn-sm" data-a="toast-undo">${action}</button>` : ''}`;
    stack.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };
  const frameOf = (el) => el.closest('.app, .phones, .rtl-pair, .hdr-demo') || document.body;

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('dawsha-mock-theme', t); } catch (e) {}
    $$('[data-a="theme"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === t));
    $$('.before').forEach((a) => { const f = `../current/${t}-${a.dataset.img}.png`; a.href = f; $('img', a).src = f; });
  }
  W.setTheme = setTheme;

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    const fr = el ? frameOf(el) : null;
    if (!el) { $$('.tbpop').forEach((p) => p.remove()); $$('.usage[aria-expanded="true"]').forEach((u) => u.setAttribute('aria-expanded', 'false')); return; }
    const a = el.dataset.a;
    if (a === 'theme') { setTheme(el.dataset.v); W.render('f-settings'); if (W.hooks.__ovSync) W.hooks.__ovSync(); return; }
    if (a === 'toggle') return el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true');
    if (a === 'toast' || a === 'nav' || a === 'palette' || a === 'bell' || a === 'settings') {
      if (W.hooks[a] && W.hooks[a](el, fr, e)) return;
      if (a === 'nav' && el.dataset.nav === 'Usage') { return W.toast(fr, 'Usage is the page above.'); }
      return W.toast(fr, 'Demo only: this action is not wired in the mockup.');
    }
    if (a === 'usage') {
      e.stopPropagation();
      const open = el.getAttribute('aria-expanded') === 'true';
      $$('.tbpop', fr).forEach((p) => p.remove());
      $$('.usage', fr).forEach((u) => u.setAttribute('aria-expanded', 'false'));
      if (!open) {
        const w = document.createElement('div'); w.className = 'tbpop'; w.innerHTML = W.usagePop(); fr.appendChild(w);
        const f = fr.getBoundingClientRect(), r = el.getBoundingClientRect();
        w.style.left = Math.max(8, Math.min(r.right - f.left - 340, f.width - 348)) + 'px';
        el.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    if (W.hooks[a]) W.hooks[a](el, fr, e);
  });

  /* index highlight via IntersectionObserver (no scroll listeners) */
  function indexSpy() {
    const links = $$('.index a');
    const io = new IntersectionObserver((en) => { en.forEach((x) => { if (x.isIntersecting) links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + x.target.id)); }); }, { rootMargin: '-20% 0px -70% 0px' });
    $$('.sec').forEach((s) => io.observe(s));
  }
  W.boot = () => {
    let t = 'dark';
    try { t = localStorage.getItem('dawsha-mock-theme') || 'dark'; } catch (e) {}
    setTheme(t);
    indexSpy();
  };
})();
