/* core.html behaviour. Generic fake data only. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const STATE_ICON = { working: 'progress_activity', needs: 'front_hand', done: 'check_circle', idle: 'radio_button_unchecked', error: 'cancel' };
  const STATE_WORD = { working: 'Working', needs: 'Needs you', done: 'Done', idle: 'Idle', error: 'Error' };
  const AGENTS = { claude: { n: 'Claude Code', l: 'C' }, codex: { n: 'Codex', l: 'X' }, gemini: { n: 'Gemini', l: 'G' } };
  const PROJECTS = [
    { id: 'billing', name: 'Billing API', branch: 'feature/retry-backoff', ini: 'BA' },
    { id: 'docs', name: 'Docs site', branch: 'main', ini: 'DS' },
    { id: 'mobile', name: 'Mobile app', branch: 'feature/offline-sync', ini: 'MA' },
    { id: 'legacy', name: 'Legacy tools', missing: true, path: '~/work/legacy-tools', ini: 'LT' }
  ];
  const proj = (id) => PROJECTS.find((p) => p.id === id);

  const MIGRATE = { tool: 'Bash', cmd: 'npm run migrate -- --env staging', file: 'db/migrations/0042_add_retry_columns.sql' };

  const initial = () => [
    { id: 1, title: 'Add retry with backoff to the webhook sender', proj: 'billing', agent: 'claude', state: 'working', model: 'Opus 5.5', branch: 'feature/retry-backoff', activity: 'Editing src/sender.ts', t: 'now', diff: [42, 7], files: 2,
      lines: [['prompt', '> Why do webhook deliveries fail under load?'], ['gap'], ['', '● Deliveries time out and are never retried, so'], ['', '  one slow endpoint drops events.'], ['gap'], ['prompt', '> Add retry with backoff to the webhook sender'], ['gap'], ['', '● I will read the sender first, then add a capped exponential backoff.'], ['cmd', '● Read(src/sender.ts)'], ['dim', '  └ Read 84 lines'], ['cmd', '● Update(src/sender.ts)'], ['dim', '  └ 12 additions, 3 removals'], ['add', '  + const wait = backoff(attempt)'], ['add', '  + await sleep(wait + jitter())'], ['del', '  - await send(payload)'], ['gap'], ['warn', '✻ Working… (42s · esc to interrupt)']],
      changes: [['M', 'src/sender.ts', '+30 -7'], ['A', 'src/backoff.ts', '+12 -0']],
      events: [['12:04', 'chat_bubble', 'You asked: <b>Add retry with backoff</b>'], ['12:05', 'edit', 'Edited <b>src/sender.ts</b>'], ['12:06', 'terminal', 'Ran <b>npm test</b>, 23 passed, 1 failed'], ['12:07', 'edit', 'Edited <b>src/backoff.ts</b>']],
      tasks: [['done', 'Read the sender and its tests'], ['now', 'Add capped exponential backoff'], ['', 'Cover the retry path with a test']] },
    { id: 2, title: 'Fix flaky invoice export test', proj: 'billing', agent: 'codex', state: 'done', model: 'Codex 5', branch: 'fix/invoice-export', activity: 'Ready to review · 2 files', t: '4m', diff: [22, 4], files: 2,
      lines: [['prompt', '> Fix the flaky invoice export test'], ['gap'], ['', '• Ran npm test -- invoice-export'], ['add', '  PASS  invoice-export.test.ts'], ['dim', '  24 tests, 0 failed'], ['gap'], ['', '• The test depended on the clock.'], ['', '  I froze time in the fixture.'], ['cmd', '  Edited invoice-export.test.ts'], ['cmd', '  Edited src/export/invoice.ts'], ['gap'], ['add', '✔ Done. 2 files ready to review.']],
      changes: [['M', 'tests/invoice-export.test.ts', '+18 -3'], ['M', 'src/export/invoice.ts', '+4 -1']],
      events: [['11:52', 'chat_bubble', 'You asked: <b>Fix the flaky test</b>'], ['11:55', 'terminal', 'Ran <b>npm test</b>, 24 passed'], ['11:57', 'check_circle', 'Finished, 2 files changed']],
      tasks: [['done', 'Reproduce the failure'], ['done', 'Freeze time in the fixture'], ['done', 'Run the suite 5 times']] },
    { id: 3, title: 'Apply the retry columns migration to staging', proj: 'billing', agent: 'claude', state: 'needs', model: 'Opus 5.5', branch: 'feature/retry-backoff', activity: 'Wants to run a command', t: '1m', diff: [0, 0], files: 0, approval: MIGRATE,
      lines: [['prompt', '> Apply the retry columns migration to staging'], ['gap'], ['', '● I will check what is pending, then apply it.'], ['cmd', '● Bash(npm run migrate -- --status)'], ['dim', '  └ 1 pending: 0042_add_retry_columns'], ['gap'], ['cmd', '● Bash(npm run migrate -- --env staging)'], ['warn', '  Waiting for your approval…']],
      changes: [], events: [['12:01', 'chat_bubble', 'You asked: <b>Apply the migration</b>'], ['12:02', 'terminal', 'Ran <b>migrate --status</b>'], ['12:03', 'front_hand', 'Asked to run <b>migrate --env staging</b>']],
      tasks: [['done', 'Check pending migrations'], ['now', 'Apply 0042 to staging'], ['', 'Verify the new columns']] },
    { id: 4, title: 'Rewrite the install guide', proj: 'docs', agent: 'gemini', state: 'idle', model: 'Gemini 3 Pro', branch: 'main', activity: 'Idle · 12m', t: '12m', diff: [64, 31], files: 1,
      lines: [['prompt', '> Rewrite the install guide for Windows and macOS'], ['gap'], ['', '✦ I restructured docs/install.md into'], ['', '  three sections: Requirements,'], ['', '  Install, Verify.'], ['add', '  + Added a Windows PowerShell block'], ['gap'], ['dim', 'Ask a follow-up or run /review.']],
      changes: [['M', 'docs/install.md', '+64 -31']], events: [['11:30', 'chat_bubble', 'You asked: <b>Rewrite the install guide</b>'], ['11:36', 'edit', 'Edited <b>docs/install.md</b>']], tasks: [['done', 'Restructure the guide'], ['done', 'Add a Windows block']] },
    { id: 5, title: 'مراجعة صفحة تسجيل الدخول', proj: 'mobile', agent: 'claude', state: 'working', model: 'Opus 5.5', branch: 'feature/offline-sync', activity: 'Reading LoginScreen.tsx', t: 'now', diff: [9, 2], files: 1,
      lines: [['prompt', '> راجع صفحة تسجيل الدخول وأصلح الأخطاء'], ['gap'], ['', '● Reading the login flow first.'], ['cmd', '● Read(src/LoginScreen.tsx)'], ['dim', '  └ Read 142 lines'], ['cmd', '● Update(src/LoginScreen.tsx)'], ['add', '  + if (!token) return showOffline()'], ['gap'], ['warn', '✻ Working… (18s · esc to interrupt)']],
      changes: [['M', 'src/LoginScreen.tsx', '+9 -2']], events: [['12:08', 'chat_bubble', 'You asked: <b>راجع صفحة تسجيل الدخول</b>'], ['12:09', 'edit', 'Edited <b>LoginScreen.tsx</b>']], tasks: [['done', 'Read the login flow'], ['now', 'Fix the offline error path']] }
  ];

  let S = initial();
  let panels = {};
  const ui = { dir: 'A', n: 3, focus: 1, nav: 'Sessions' };

  const gridList = () => S.filter((s) => !s.closed).slice(0, ui.n);
  const openSessions = () => S.filter((s) => !s.closed);
  const needsList = () => gridList().filter((s) => s.state === 'needs');

  /* ---------------- small builders ---------------- */
  const stateHTML = (st, chip) => `<span class="state ${chip ? 'state-chip' : ''}" data-s="${st}"><i class="icon">${STATE_ICON[st]}</i>${STATE_WORD[st]}</span>`;
  const markHTML = (a, cls = '') => `<span class="mark ${cls}" data-a="${a}">${AGENTS[a].l}</span>`;
  const btn = (act, icon, label, extra = '', data = '') => `<button class="btn btn-ghost btn-icon btn-sm ${extra}" data-act="${act}" ${data} aria-label="${label}" title="${label}"><i class="icon">${icon}</i></button>`;
  const kbd = (t) => `<span class="kbd">${t}</span>`;
  const termHTML = (s) => s.lines.map(([c, t]) => (c === 'gap' ? '<div class="tl gap"></div>' : `<div class="tl ${c}" ${c === 'prompt' ? 'dir="auto"' : ''}>${esc(t)}</div>`)).join('') + (s.state === 'working' || s.state === 'idle' || s.state === 'done' ? '<div class="tl"><span class="cur"></span></div>' : '');

  function approvalHTML(s) {
    const a = s.approval;
    return `<div class="appr" role="alertdialog" aria-label="Approval needed">
      <div class="appr-q"><i class="icon">front_hand</i><span>Allow ${AGENTS[s.agent].n.split(' ')[0]} to run this command?</span><span class="chip">${a.tool}</span></div>
      <div class="appr-cmd"><i>$</i>${esc(a.cmd)}</div>
      <div class="appr-meta"><span>Writes <span class="mono">${esc(a.file)}</span></span><span>in <span class="mono">${esc(proj(s.proj).name)}</span></span></div>
      <div class="appr-act"><button class="btn btn-primary btn-sm" data-act="allow" data-id="${s.id}">Allow ${kbd('Enter')}</button><button class="btn btn-sm" data-act="always" data-id="${s.id}" title="Allow npm run migrate in this project from now on">Allow always</button><button class="btn btn-ghost btn-sm" data-act="deny" data-id="${s.id}">Deny ${kbd('Esc')}</button></div>
    </div>`;
  }

  function panelHTML(s) {
    const info = `<dl class="kv"><dt>Agent</dt><dd>${AGENTS[s.agent].n} · ${esc(s.model)}</dd><dt>Project</dt><dd>${esc(proj(s.proj).name)}</dd><dt>Branch</dt><dd class="mono">${esc(s.branch)}</dd><dt>Started</dt><dd>12 min ago</dd><dt>Context</dt><dd style="display:flex;align-items:center;gap:8px"><span class="meter" style="--v:38;width:96px"></span><span class="num">38%</span></dd></dl>
      <div class="live-row"><div>Live info<span class="t-meta">Cost and context, updated as it runs</span></div><button class="toggle" role="switch" aria-checked="false" data-act="toggle" aria-label="Live info"></button></div>
      <div><div class="t-meta" style="margin-bottom:4px">Recap</div><div class="t-2">${esc(s.activity)}. ${s.files ? s.files + ' file' + (s.files > 1 ? 's' : '') + ' changed.' : 'No file changes yet.'}</div></div>`;
    const tl = `<div class="row" style="display:flex;gap:4px;flex-wrap:wrap"><span class="chip chip-accent">All</span><span class="chip">Prompts</span><span class="chip">Edits</span><span class="chip">Commands</span></div><ul class="tlist">${s.events.map(([t, i, x]) => `<li><time>${t}</time><i class="icon">${i}</i><span>${x}</span></li>`).join('')}</ul>`;
    const tasks = s.tasks.map(([c, x]) => `<div class="chk ${c}"><i class="icon">${c === 'done' ? 'check_circle' : c === 'now' ? 'pending' : 'radio_button_unchecked'}</i><span>${esc(x)}</span></div>`).join('');
    const ch = s.changes.length
      ? `${s.changes.map(([m, f, d]) => `<div class="frow"><span class="fst ${m === 'A' ? 'add' : ''}">${m}</span><span class="fl" title="${esc(f)}">${esc(f)}</span><span class="ds">${d}</span></div>`).join('')}<div class="mini-diff"><div class="tl dim">@@ sender.ts</div><div class="tl add">+ const wait = backoff(attempt)</div><div class="tl del">- await send(payload)</div></div><button class="btn btn-primary" data-act="review">Review ${s.files} file${s.files > 1 ? 's' : ''} ${kbd('Ctrl R')}</button>`
      : `<div class="t-2">No changes yet. Files this session edits will list here.</div>`;
    const tabs = [['info', 'Info', info], ['timeline', 'Timeline', tl], ['tasks', 'Tasks', tasks], ['changes', 'Changes', ch]];
    const cur = (panels[s.id] && panels[s.id].tab) || 'info';
    return `<aside class="slide" aria-label="Session panels">
      <div class="slide-head"><div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button class="tab" role="tab" data-act="ptab" data-id="${s.id}" data-tab="${k}" aria-selected="${k === cur}">${l}</button>`).join('')}</div>${btn('panel', 'close', 'Close panel', '', `data-id="${s.id}"`)}</div>
      ${tabs.map(([k, , h]) => `<div class="slide-body" data-tabpane="${k}" ${k === cur ? '' : 'hidden'}>${h}</div>`).join('')}
    </aside>`;
  }

  function paneHTML(s, o = {}) {
    const p = proj(s.proj);
    const pn = panels[s.id] || {};
    const idx = gridList().findIndex((x) => x.id === s.id) + 1 || 1;
    const stat = s.diff[0] || s.diff[1] ? `<span class="diffstat"><span class="a">+${s.diff[0]}</span><span class="d">-${s.diff[1]}</span></span>` : '';
    return `<article class="pane ${o.quiet ? 'quiet' : ''}" data-id="${s.id}" data-state="${s.state}" data-focus="${ui.focus === s.id}" data-panel="${pn.open ? 'open' : 'closed'}" aria-label="Session ${idx}: ${esc(s.title)}, ${STATE_WORD[s.state]}">
      <header class="ph" data-act="focus" data-id="${s.id}">
        <span class="pnum">${idx || ''}</span>${markHTML(s.agent)}
        <div class="ph-t"><div class="ph-title bidi" dir="auto">${esc(s.title)}</div><div class="ph-sub">${esc(p.name)} · ${AGENTS[s.agent].n}</div></div>
        ${stateHTML(s.state, true)}
        <div class="ph-btns">${btn('panel', 'right_panel_open', 'Panels: info, timeline, tasks, changes', '', `data-id="${s.id}"`)}${btn('maximize', 'open_in_full', 'Maximize pane')}${btn('pmenu', 'more_horiz', 'More actions', '', `data-id="${s.id}"`)}</div>
      </header>
      <div class="pb"><div class="term">${termHTML(s)}</div>${s.state === 'needs' ? approvalHTML(s) : ''}${panelHTML(s)}</div>
      <footer class="pf"><span class="pf-meta model">${esc(s.model)}</span><span class="pf-meta branch" title="${esc(s.branch)}"><i class="icon">call_split</i>${esc(s.branch)}</span><span class="grow"></span>${stat}${s.files ? `<button class="btn btn-sm" data-act="review">Review ${s.files} file${s.files > 1 ? 's' : ''}</button>` : ''}</footer>
    </article>`;
  }

  /* ---------------- top bar ---------------- */
  const NAV = ['Sessions', 'Crew', 'Files', 'Work', 'Skills'];
  function usageButton(open) {
    return `<button class="usage" data-act="usage" aria-expanded="${!!open}" aria-haspopup="dialog" aria-label="Usage limits">
      ${markHTML('claude', 'mark-sm')}<span class="ux">5h</span><span class="meter" style="--v:62"></span><b>62%</b><span class="ux">Week</span><b class="ux">18%</b><span class="usep"></span>${markHTML('codex', 'mark-sm')}<b>23%</b></button>`;
  }
  function topbarHTML(active, o = {}) {
    const n = needsList().length;
    return `<div class="tb">
      <span class="logo" aria-label="Dawsha">D</span>
      <div class="tabs" role="tablist" aria-label="Pages">${NAV.map((x) => `<button class="tab" role="tab" data-act="nav" data-nav="${x}" aria-selected="${x === active}">${x}</button>`).join('')}</div>
      <span class="grow"></span>
      ${usageButton(o.usageOpen)}
      <button class="btn btn-ghost search-btn" data-act="palette" aria-label="Search and commands"><i class="icon">search</i><span class="lbl">Search</span>${kbd('Ctrl K')}</button>
      <button class="btn btn-ghost btn-icon bell" data-act="bell" aria-label="Notifications"><i class="icon">notifications</i>${n ? `<span class="badge">${n}</span>` : ''}</button>
      <button class="btn btn-ghost btn-icon" data-act="settings" aria-label="Settings"><i class="icon">settings</i></button>
      <button class="btn btn-primary" data-act="newsession"><i class="icon">add</i>New session ${kbd('Ctrl N')}</button>
    </div>`;
  }
  function usagePopHTML() {
    const row = (name, a, win, v, reset, cls = '') => `<div class="urow"><span>${win}</span><span class="num"><b>${v}%</b></span><span class="meter ${cls}" style="--v:${v}"></span><span class="t-meta"><span>${reset}</span></span></div>`;
    return `<div class="popover" style="width:340px;--origin:top right" role="dialog" aria-label="Usage limits">
      <div class="popover-head"><span>Usage</span><span class="t-meta">Updated 2 min ago</span></div>
      <div class="popover-body" style="padding-top:0">
        <div class="uagent">${markHTML('claude', 'mark-sm')}Claude Code</div>
        ${row('c', 'claude', '5-hour window', 62, 'Resets in 1h 39m')}${row('c', 'claude', 'Week', 18, 'Resets Thursday 09:00')}
        <div class="uagent">${markHTML('codex', 'mark-sm')}Codex</div>
        ${row('x', 'codex', '5-hour window', 23, 'Resets in 3h 05m')}${row('x', 'codex', 'Week', 88, 'Resets Friday 09:00', 'warn')}
        <div class="uagent">${markHTML('gemini', 'mark-sm')}Gemini <span class="t-meta" style="margin-inline-start:auto">Not signed in</span></div>
      </div>
      <div class="popover-foot" style="justify-content:space-between;align-items:center"><span class="t-2">Spend today <b class="num" style="color:var(--text)">$4.25</b></span><button class="btn btn-sm" data-act="usagepage">Open Usage</button></div>
    </div>`;
  }

  /* ---------------- sidebars ---------------- */
  function rowHTML(s, mode) {
    const p = proj(s.proj);
    const inGrid = gridList().includes(s);
    const sub = !inGrid ? 'Kept · closed 1h ago' : mode === 'attn' ? `${p.name} · ${s.activity}` : s.activity;
    const st = inGrid ? s.state : 'idle';
    return `<div class="srow ${inGrid ? '' : 'kept'}" data-act="focus" data-id="${s.id}" data-state="${inGrid ? s.state : 'kept'}" ${ui.focus === s.id ? 'aria-current="true"' : ''} tabindex="0" role="button">
      <span class="sbadge">${markHTML(s.agent)}<span class="sdot" data-s="${st}"><i class="icon">${inGrid ? STATE_ICON[s.state] : 'history'}</i></span></span>
      <span class="srow-main"><span class="srow-title bidi" dir="auto">${esc(s.title)}</span><span class="srow-sub">${esc(sub)}</span></span>
      <span class="srow-end"><span class="srow-time">${s.t}</span>${btn('rowmenu', 'more_horiz', 'Session actions', 'srow-more', `data-id="${s.id}"`)}</span></div>`;
  }
  function waitingHTML() {
    const n = needsList();
    if (!n.length) return '';
    return `<div class="waiting"><div class="waiting-label"><span>Waiting on you · ${n.length}</span>${kbd('Ctrl Shift J')}</div>${n.map((s) => `<div class="srow" data-act="focus" data-id="${s.id}" tabindex="0" role="button"><span class="sbadge">${markHTML(s.agent)}<span class="sdot" data-s="needs"><i class="icon">front_hand</i></span></span><span class="srow-main"><span class="srow-title">${esc(s.title)}</span><span class="srow-sub">${esc(proj(s.proj).name)} · ${esc(s.activity)}</span></span></div>`).join('')}</div>`;
  }
  const openProj = {};
  function sidebarTree() {
    const groups = PROJECTS.map((p) => {
      const ss = openSessions().filter((s) => s.proj === p.id);
      const open = openProj[p.id] !== undefined ? openProj[p.id] : ss.length > 0;
      if (p.missing) {
        return `<div class="pg missing" data-open="false"><div class="pg-head" data-act="projmenu" data-p="${p.id}" role="button" tabindex="0"><i class="icon chev" style="visibility:hidden">chevron_right</i><i class="icon" style="color:var(--st-error)">folder_off</i><span class="pg-name">${p.name}</span><span class="pg-end"><span class="pg-actions">${btn('projmenu', 'more_horiz', 'Project actions', '', `data-p="${p.id}"`)}</span></span></div><div class="pg-missing"><span>Folder not found</span><button class="btn btn-sm" data-act="locate">Locate…</button></div></div>`;
      }
      const need = ss.some((s) => gridList().includes(s) && s.state === 'needs');
      return `<div class="pg" data-open="${open}" data-p="${p.id}"><div class="pg-head" data-act="pgtoggle" data-p="${p.id}" role="button" tabindex="0" aria-expanded="${open}"><i class="icon chev">chevron_right</i><span class="pg-name">${p.name}</span><span class="pg-meta">${p.branch}</span><span class="pg-end"><span class="pg-actions">${btn('newhere', 'add', 'New session in ' + p.name, '', `data-p="${p.id}"`)}${btn('projmenu', 'more_horiz', 'Project actions', '', `data-p="${p.id}"`)}</span><span class="pg-count">${need ? '<i class="icon" style="color:var(--st-needs);font-size:14px;font-variation-settings:\'FILL\' 1">front_hand</i>' : ss.length || ''}</span></span></div><div class="pg-body">${ss.map((s) => rowHTML(s, 'tree')).join('') || '<div class="t-meta" style="padding:4px 8px 8px 32px">No sessions</div>'}</div></div>`;
    }).join('');
    return `<aside class="sb" aria-label="Projects"><div class="sb-head"><span class="sb-title">Projects</span><span class="sb-tools">${btn('search', 'search', 'Filter')}${btn('add', 'add', 'Add project')}${btn('collapse', 'left_panel_close', 'Compact sidebar')}</span></div>${waitingHTML()}<div class="sb-scroll">${groups}</div><div class="sb-foot"><button class="btn btn-ghost btn-sm" data-act="addproject"><i class="icon">add</i>Add project</button><button class="btn btn-ghost btn-sm" data-act="manage">Manage</button></div></aside>`;
  }
  let projFilter = 'all';
  function sidebarAttn() {
    const os = openSessions().filter((s) => projFilter === 'all' || s.proj === projFilter);
    const order = [['needs', 'Needs you'], ['working', 'Working'], ['done', 'Ready to review'], ['idle', 'Idle']];
    const secs = order.map(([k, l]) => {
      const rows = os.filter((s) => (gridList().includes(s) ? s.state : 'idle') === k);
      if (!rows.length) return '';
      return `<div class="sgroup-label" data-s="${k}">${l}<span class="n">${rows.length}</span></div>${rows.map((s) => rowHTML(s, 'attn')).join('')}`;
    }).join('');
    const chips = [['all', 'All']].concat(PROJECTS.filter((p) => !p.missing).map((p) => [p.id, p.name])).map(([id, n]) => `<span class="chip" role="button" tabindex="0" data-act="pfilter" data-p="${id}" aria-pressed="${projFilter === id}">${n}</span>`).join('');
    return `<aside class="sb" aria-label="Sessions by attention"><div class="sb-head"><span class="sb-title">Sessions</span><span class="sb-tools">${btn('add', 'add', 'New session')}${btn('collapse', 'left_panel_close', 'Compact sidebar')}</span></div>
      <div class="sb-search"><div class="input-wrap"><i class="icon">search</i><input class="input" placeholder="Filter sessions" aria-label="Filter sessions">${kbd('/')}</div></div>
      <div class="sfilter">${chips}</div>
      <div class="sb-scroll">${secs}</div>
      <div class="sb-foot" style="flex-direction:column;gap:4px"><button class="btn btn-ghost btn-sm" style="justify-content:flex-start" data-act="manage"><i class="icon">folder</i>4 projects<span class="chip chip-error" style="margin-inline-start:auto">1 folder missing</span></button></div></aside>`;
  }
  function compactTree() {
    const items = PROJECTS.map((p) => {
      const ss = openSessions().filter((s) => s.proj === p.id);
      const need = ss.some((s) => gridList().includes(s) && s.state === 'needs');
      return `<button class="proj ${p.missing ? 'miss' : ''}" title="${p.name}${p.missing ? ' (folder missing)' : ''}" data-act="projmenu" data-p="${p.id}">${p.ini}${need ? '<span class="pip"></span>' : ''}</button>${ss.map(compactRow).join('')}<hr>`;
    }).join('');
    return `<aside class="sb compact" aria-label="Projects, compact"><div class="sb-head" style="padding:0;justify-content:center">${btn('collapse', 'left_panel_open', 'Expand sidebar')}</div><div class="sb-scroll" style="padding:0;align-items:center"><div class="cpt">${items}</div></div><div class="sb-foot" style="box-shadow:none;padding:var(--sp-2) 0">${btn('add', 'add', 'Add project')}</div></aside>`;
  }
  function compactRow(s) {
    const inGrid = gridList().includes(s);
    return `<div class="crow" data-act="focus" data-id="${s.id}" title="${esc(s.title)}" tabindex="0" role="button" ${ui.focus === s.id ? 'aria-current="true"' : ''}><span class="sbadge">${markHTML(s.agent)}<span class="sdot" data-s="${inGrid ? s.state : 'idle'}"><i class="icon">${inGrid ? STATE_ICON[s.state] : 'history'}</i></span></span></div>`;
  }
  function compactAttn() {
    const os = openSessions().slice().sort((a, b) => ['needs', 'working', 'done', 'idle'].indexOf(a.state) - ['needs', 'working', 'done', 'idle'].indexOf(b.state));
    return `<aside class="sb compact" aria-label="Sessions, compact"><div class="sb-head" style="padding:0;justify-content:center">${btn('collapse', 'left_panel_open', 'Expand sidebar')}</div><div class="sb-scroll" style="padding:0;align-items:center"><div class="cpt">${btn('search', 'search', 'Filter')}<hr>${os.map(compactRow).join('')}</div></div><div class="sb-foot" style="box-shadow:none;padding:var(--sp-2) 0">${btn('manage', 'folder', 'Projects (1 folder missing)')}</div></aside>`;
  }

  /* ---------------- grid frame ---------------- */
  function toolbarHTML() {
    const n = needsList().length;
    return `<div class="st">
      <div class="tabs" role="tablist" aria-label="Layout"><button class="tab" role="tab" aria-selected="true"><i class="icon">grid_view</i>Grid</button><button class="tab" role="tab" aria-selected="false" data-act="soon"><i class="icon">view_kanban</i>Board</button></div>
      <button class="btn btn-ghost" data-act="soon"><i class="icon">dashboard_customize</i>Layouts</button>
      <label class="lbl"><button class="toggle" role="switch" aria-checked="false" data-act="toggle" aria-label="Dim other panes"></button>Dim others</label>
      <span class="grow"></span>
      ${n ? `<button class="state state-chip needs-chip" data-s="needs" data-act="jump" title="Jump to the session that needs you"><i class="icon">front_hand</i>${n} needs you ${kbd('Ctrl Shift J')}</button>` : `<span class="state state-chip" data-s="done"><i class="icon">check_circle</i>Nothing waiting on you</span>`}
      <span class="stepper" aria-label="Terminal text size">${btn('soon', 'remove', 'Smaller text')}<b>13</b>${btn('soon', 'add', 'Larger text')}</span>
    </div>`;
  }
  function gridHTML() {
    const list = gridList();
    if (!list.length) return `<div class="grid" style="display:flex"><div class="empty"><div class="empty-icon"><i class="icon">terminal</i></div><h3>No sessions in the grid</h3><p>Reset the demo to bring them back.</p></div></div>`;
    if (ui.dir === 'A') {
      const f = list.find((s) => s.id === ui.focus) || list[0];
      const rest = list.filter((s) => s !== f);
      return `<div class="grid A"><div class="col-f">${paneHTML(f)}</div><div class="col">${rest.map((s) => paneHTML(s, { quiet: true })).join('')}</div></div>`;
    }
    return `<div class="grid B n${list.length}">${list.map((s) => paneHTML(s)).join('')}</div>`;
  }
  function renderGridFrame() {
    const f = $('#frame-grid');
    closeFloating(f);
    $('.sbslot', f).innerHTML = sidebarTree();
    $('.mainslot', f).innerHTML = toolbarHTML() + gridHTML();
    $('.tbslot', f).innerHTML = topbarHTML('Sessions', { usageOpen: !!$('.tbpop', f) });
  }

  function renderSidebars() {
    const map = { 'sb-A-full': sidebarTree, 'sb-A-compact': compactTree, 'sb-B-full': sidebarAttn, 'sb-B-compact': compactAttn };
    Object.keys(map).forEach((id) => { const el = document.getElementById(id); if (el) el.innerHTML = map[id](); });
  }
  function renderAll() {
    const list = gridList();
    if (!list.find((s) => s.id === ui.focus) && list[0]) ui.focus = list[0].id;
    renderGridFrame();
    renderSidebars();
    const tf = $('#frame-top');
    if (tf) $('.tbslot', tf).innerHTML = topbarHTML(ui.nav, { usageOpen: !!$('.tbpop', tf) });
    renderAnat();
  }

  /* ---------------- pane anatomy ---------------- */
  function paneMenuHTML(s, cls = 'float') {
    return `<div class="menu ${cls}" role="menu" aria-label="Pane actions" style="--origin:top right">
      <div class="menu-label">Open</div>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">code</i><span class="grow">Open in editor</span>${kbd('Ctrl E')}</button>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">folder_open</i><span class="grow">Show in Files</span></button>
      <button class="menu-item" role="menuitem" aria-disabled="true"><i class="icon">terminal</i><span class="grow">Open in Visual Studio</span><span class="t-meta">Not installed</span></button>
      <div class="menu-sep"></div>
      <div class="menu-label">Terminal</div>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">find_in_page</i><span class="grow">Find in terminal</span>${kbd('Ctrl Shift F')}</button>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">content_copy</i><span class="grow">Copy last reply</span></button>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">clear_all</i><span class="grow">Clear terminal</span></button>
      <div class="menu-sep"></div>
      <div class="menu-label">Session</div>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">edit</i><span class="grow">Rename</span>${kbd('F2')}</button>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">sell</i><span class="grow">Tag as</span><i class="icon" style="margin-inline-start:auto">chevron_right</i></button>
      <button class="menu-item" role="menuitem" data-act="mact"><i class="icon">arrow_outward</i><span class="grow">Continue in another agent</span><i class="icon" style="margin-inline-start:auto">chevron_right</i></button>
      <div class="menu-sep"></div>
      <button class="menu-item danger" role="menuitem" data-act="close" data-id="${s.id}"><i class="icon">close</i><span class="grow">Close session</span>${kbd('Ctrl W')}</button></div>`;
  }
  function renderAnat() {
    const host = $('#anat-pane');
    if (!host) return;
    const s = Object.assign({}, S[0], { id: 101 });
    if (!panels[101]) panels[101] = { open: true, tab: 'changes' };
    host.innerHTML = paneHTML(s);
    $('#anat-menu').innerHTML = paneMenuHTML(S[0], 'static');
  }

  /* ---------------- floating things: menus, popovers, toasts, dialogs ---------------- */
  function closeFloating(root) {
    $$('.menu.float, .tbpop, .confirm', root || document).forEach((e) => { if (root || !e.classList.contains('pinned')) e.remove(); });
    if (root) $$('.usage[aria-expanded="true"]', root).forEach((e) => e.setAttribute('aria-expanded', 'false'));
  }
  function place(el, anchor, frame, alignRight = true) {
    const fr = frame.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    frame.appendChild(el);
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = alignRight ? ar.right - fr.left - w : ar.left - fr.left;
    let top = ar.bottom - fr.top + 4;
    left = Math.max(8, Math.min(left, fr.width - w - 8));
    if (top + h > fr.height - 8) top = Math.max(8, ar.top - fr.top - h - 4);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    const ox = Math.max(0, Math.min(w, ar.left + ar.width / 2 - fr.left - left));
    el.style.setProperty('--origin', `${ox}px ${top < ar.top - fr.top ? 'bottom' : 'top'}`);
  }
  function frameOf(el) { return el.closest('.app, .sb-box, .anat') || document.body; }
  function openMenu(anchor, html, alignRight = true) {
    const frame = frameOf(anchor);
    closeFloating(frame);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const el = wrap.firstChild;
    if (getComputedStyle(frame).position === 'static') frame.style.position = 'relative';
    place(el, anchor, frame, alignRight);
  }
  function toast(frame, text, action) {
    let stack = $('.toast-stack', frame);
    if (!stack) { stack = document.createElement('div'); stack.className = 'toast-stack'; frame.appendChild(stack); }
    const t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<i class="icon">check_circle</i><span class="grow">${text}</span>${action ? `<button class="btn btn-ghost btn-sm" data-act="${action[1]}">${action[0]}</button>` : ''}`;
    stack.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  function confirmClose(frame, s) {
    closeFloating(frame);
    const d = document.createElement('div');
    d.className = 'confirm';
    d.innerHTML = `<div class="scrim"></div><div class="dialog" role="alertdialog" aria-label="Close session"><div class="dialog-head"><h2>Close "${esc(s.title)}"?</h2>${btn('cancel', 'close', 'Cancel')}</div>
      <div class="dialog-body">${s.state === 'needs' ? 'This session is waiting for your answer. Closing it discards the pending approval.' : s.state === 'working' ? 'This session is still working. Closing it stops the agent.' : 'The session stays in the sidebar under Kept for 7 days.'}</div>
      <div class="dialog-foot"><button class="btn btn-ghost" data-act="cancel">Cancel</button><button class="btn btn-danger" data-act="confirmclose" data-id="${s.id}">Close "${esc(s.title.length > 26 ? s.title.slice(0, 26) + '…' : s.title)}"</button></div></div>`;
    frame.appendChild(d);
    $('.btn-danger', d).focus();
  }

  /* ---------------- actions ---------------- */
  function resolve(id, mode) {
    const s = S.find((x) => x.id === id);
    if (!s || s.state !== 'needs') return;
    const fr = $('#frame-grid');
    s.lines = s.lines.filter((l) => !/Waiting for your approval/.test(l[1] || ''));
    if (mode === 'deny') {
      s.state = 'idle'; s.activity = 'Denied · idle'; s.t = 'now';
      s.lines.push(['del', '  ✘ Denied by you'], ['gap'], ['dim', 'Tell Claude what to do instead.']);
      renderAll(); toast($('#frame-grid'), 'Denied. Claude was told no and is idle.');
    } else {
      s.state = 'working'; s.activity = 'Running migration'; s.t = 'now';
      s.lines.push(['add', '  ✔ Allowed' + (mode === 'always' ? ' (always for npm run migrate)' : '')], ['dim', '  └ Applying 0042_add_retry_columns…'], ['gap'], ['warn', '✻ Working… (3s · esc to interrupt)']);
      delete s.approval;
      renderAll(); toast($('#frame-grid'), mode === 'always' ? 'Allowed, and remembered for this project.' : 'Allowed. Claude is applying the migration.', ['Undo', 'reset']);
    }
  }
  function resetDemo() { S = initial(); panels = {}; ui.focus = 1; renderAll(); }
  function setTheme(t) { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('dawsha-mock-theme', t); } catch (e) {} $$('[data-act="theme"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.theme === t)); syncBefores(); }
  function syncBefores() {
    const t = document.documentElement.getAttribute('data-theme');
    $$('.before').forEach((a) => { const f = `../current/${t}-${a.dataset.img}.png`; a.href = f; $('img', a).src = f; });
  }

  function act(e) {
    const el = e.target.closest('[data-act]');
    if (!el) { if (!e.target.closest('.menu.float, .tbpop')) closeFloating(); return; }
    const a = el.dataset.act;
    const id = el.dataset.id ? +el.dataset.id : null;
    const frame = frameOf(el);
    if (a === 'focus') {
      if (e.target.closest('[data-act]') !== el) return;
      closeFloating(frame);
      const s = S.find((x) => x.id === id);
      if (!gridList().includes(s)) { ui.n = 5; }
      ui.focus = id; renderAll();
      return;
    }
    switch (a) {
      case 'rowmenu': {
        e.stopPropagation();
        const s = S.find((x) => x.id === id);
        openMenu(el, `<div class="menu float" role="menu" style="min-width:220px"><button class="menu-item" data-act="focus" data-id="${s.id}"><i class="icon">center_focus_strong</i><span class="grow">Go to pane</span>${kbd('Ctrl ' + (gridList().indexOf(s) + 1 || 1))}</button><button class="menu-item" data-act="mact"><i class="icon">edit</i><span class="grow">Rename</span>${kbd('F2')}</button><button class="menu-item" data-act="mact"><i class="icon">sell</i><span class="grow">Tag as</span><i class="icon" style="margin-inline-start:auto">chevron_right</i></button><div class="menu-sep"></div><button class="menu-item" data-act="mact"><i class="icon">folder_open</i><span class="grow">Show folder</span></button><div class="menu-sep"></div><button class="menu-item danger" data-act="close" data-id="${s.id}"><i class="icon">close</i><span class="grow">Close session</span></button></div>`, false);
        break;
      }
      case 'projmenu': {
        e.stopPropagation();
        const p = proj(el.dataset.p);
        openMenu(el, `<div class="menu float" role="menu" style="min-width:236px">${p.missing ? `<button class="menu-item" data-act="locate"><i class="icon">folder_open</i><span class="grow">Locate folder…</span></button>` : `<button class="menu-item" data-act="newhere"><i class="icon">add</i><span class="grow">New session here</span>${kbd('Ctrl N')}</button><button class="menu-item" data-act="mact"><i class="icon">folder_open</i><span class="grow">Show in Files</span></button><button class="menu-item" data-act="mact"><i class="icon">sell</i><span class="grow">Rename project</span></button>`}<div class="menu-sep"></div><button class="menu-item danger" data-act="mact"><i class="icon">delete</i><span class="grow">Remove "${p.name}"</span></button></div>`, false);
        break;
      }
      case 'pmenu': e.stopPropagation(); openMenu(el, paneMenuHTML(S.find((x) => x.id === id) || S[0])); break;
      case 'pgtoggle': { const p = el.dataset.p; const cur = el.closest('.pg').dataset.open === 'true'; openProj[p] = !cur; renderSidebars(); const f = $('#frame-grid'); if (f) $('.sbslot', f).innerHTML = sidebarTree(); break; }
      case 'pfilter': projFilter = el.dataset.p; renderSidebars(); break;
      case 'panel': {
        const pane = el.closest('.pane');
        const cur = panels[id] || {};
        panels[id] = { open: !cur.open, tab: cur.tab || 'info' };
        pane.dataset.panel = panels[id].open ? 'open' : 'closed';
        break;
      }
      case 'ptab': {
        const pane = el.closest('.pane');
        panels[id] = { open: true, tab: el.dataset.tab };
        $$('.tab', pane).forEach((t) => t.setAttribute('aria-selected', t === el));
        $$('[data-tabpane]', pane).forEach((p) => { p.hidden = p.dataset.tabpane !== el.dataset.tab; });
        break;
      }
      case 'allow': resolve(id, 'allow'); break;
      case 'always': resolve(id, 'always'); break;
      case 'deny': resolve(id, 'deny'); break;
      case 'jump': { const s = needsList()[0]; if (s) { ui.focus = s.id; renderAll(); } break; }
      case 'usage': {
        e.stopPropagation();
        const open = el.getAttribute('aria-expanded') === 'true';
        closeFloating(frame);
        if (!open) {
          const wrap = document.createElement('div');
          wrap.className = 'tbpop';
          wrap.innerHTML = usagePopHTML();
          frame.appendChild(wrap);
          const fr = frame.getBoundingClientRect(), ar = el.getBoundingClientRect();
          wrap.style.left = Math.max(8, Math.min(ar.right - fr.left - 340, fr.width - 348)) + 'px';
          el.setAttribute('aria-expanded', 'true');
        }
        break;
      }
      case 'nav': {
        const fr = frame;
        if (fr.id === 'frame-top') {
          closeFloating(fr); const tbs = $('.tbslot', fr); ui.nav = el.dataset.nav; $$('.tab', $('.tbslot', fr)).forEach((t) => t.setAttribute('aria-selected', t === el)); renderPageStub();
        } else toast(fr, `${el.dataset.nav} is shown in the top bar section below.`);
        break;
      }
      case 'toggle': el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true'); break;
      case 'close': confirmClose(frame, S.find((x) => x.id === id) || S[0]); break;
      case 'cancel': closeFloating(frame); break;
      case 'confirmclose': { const s = S.find((x) => x.id === id); s.closed = true; closeFloating(frame); renderAll(); toast($('#frame-grid'), `Closed "${esc(s.title.slice(0, 30))}". Reset restores it.`, ['Reset', 'reset']); break; }
      case 'reset': resetDemo(); break;
      case 'mact': closeFloating(frame); toast(frame, 'Demo only: this action is not wired in the mockup.'); break;
      case 'soon': case 'maximize': case 'review': case 'palette': case 'bell': case 'settings': case 'newsession': case 'manage': case 'usagepage': case 'locate': case 'newhere': case 'addproject': case 'add': case 'search': case 'collapse': closeFloating(frame); toast(frame, 'Demo only: this action is not wired in the mockup.'); break;
      case 'theme': setTheme(el.dataset.theme); break;
      case 'dir': ui.dir = el.dataset.v; $$('[data-act="dir"]').forEach((b) => b.setAttribute('aria-selected', b === el)); $('#dirnote-A').hidden = ui.dir !== 'A'; $('#dirnote-B').hidden = ui.dir !== 'B'; renderGridFrame(); break;
      case 'count': ui.n = +el.dataset.v; $$('[data-act="count"]').forEach((b) => b.setAttribute('aria-selected', b === el)); S.forEach((s) => (s.closed = s.closed)); renderAll(); break;
    }
  }

  const PAGES = {
    Sessions: ['Sessions', 'Grid of live agent sessions. Layouts and Dim others live in the sessions toolbar, not the global bar.'],
    Crew: ['Crew', 'Your AI teammates (renamed from "Agents"): a lead and specialists you can run on a task.'],
    Files: ['Files', 'Browse, review and send files to agents.'],
    Work: ['Work', 'What got done: sessions, tickets and a summary you can copy.'],
    Skills: ['Skills', 'Reusable skills shared across Claude, Codex and Gemini.']
  };
  function renderPageStub() {
    const host = $('#page-stub'); if (!host) return;
    const [t, d] = PAGES[ui.nav];
    host.innerHTML = `<h3 class="t-page" style="margin:0">${t}</h3><p class="t-2" style="margin:0;max-width:40ch">${d}</p>`;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    let t = 'dark';
    try { t = localStorage.getItem('dawsha-mock-theme') || 'dark'; } catch (e) {}
    setTheme(t);
    document.addEventListener('click', act);
    document.addEventListener('contextmenu', (e) => {
      const r = e.target.closest('.srow[data-id], .pg-head[data-p]');
      if (!r) return;
      e.preventDefault();
      const b = r.dataset.id ? { dataset: { act: 'rowmenu', id: r.dataset.id }, closest: () => r, getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }) } : null;
      const fake = r.querySelector('[data-act="rowmenu"], [data-act="projmenu"]') || r;
      fake.click();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const open = $('.menu.float, .tbpop, .confirm');
        if (open) { closeFloating(); return; }
      }
      if (!window.__gridInView || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || $('.menu.float, .tbpop, .confirm')) return;
      const s = needsList()[0];
      if (!s) return;
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); resolve(s.id, 'allow'); }
      if (e.key === 'Escape') { resolve(s.id, 'deny'); }
    });
    const fg = $('#frame-grid');
    if (fg && 'IntersectionObserver' in window) new IntersectionObserver((en) => { window.__gridInView = en[0].isIntersecting; }, { threshold: 0.5 }).observe(fg);
    renderAll();
    renderPageStub();
    const tf = $('#frame-top');
    if (tf) { const u = $('.usage', tf); if (u) { u.click(); const pp = $('.tbpop', tf); if (pp) pp.classList.add('pinned'); } }
  }
  window.DawshaMock = { resolve, S: () => S, ui, renderAll, resetDemo };
  window.addEventListener('DOMContentLoaded', boot);
})();
