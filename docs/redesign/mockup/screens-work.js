/* Board, Replay, Skills, Projects, Usage. */
(function () {
  const { $, $$, esc, ic, mark, state, kbd, ibtn, av, seg, search, tog, field, sel, page, shell, STATE_ICON } = SC;
  const H = SC.hooks;

  /* ================= BOARD ================= */
  const bd = (SC.st.board = { peek: true, cur: 3 });
  const CARDS = {
    1: { a: 'claude', t: 'Add retry with backoff to the webhook sender', p: 'Billing API', s: 'working', sub: 'Editing src/sender.ts', w: 'now' },
    2: { a: 'codex', t: 'Fix flaky invoice export test', p: 'Billing API', s: 'done', sub: '2 files · +22 -4', w: '4m' },
    3: { a: 'claude', t: 'Apply the retry columns migration to staging', p: 'Billing API', s: 'needs', sub: 'Wants to run a command', w: '1m' },
    4: { a: 'gemini', t: 'Rewrite the install guide', p: 'Docs site', s: 'done', sub: '1 file · +64 -31', w: '12m' },
    5: { a: 'claude', t: 'مراجعة صفحة تسجيل الدخول', p: 'Mobile app', s: 'working', sub: 'Reading LoginScreen.tsx', w: 'now' },
    6: { a: 'codex', t: 'Upgrade the ESLint config', p: 'Docs site', s: 'done', sub: 'Reviewed · merged', w: '2h' },
    7: { a: 'claude', t: 'Add idempotency keys to refunds', p: 'Billing API', s: 'done', sub: 'Reviewed · merged', w: '3h' }
  };
  const COLS = [['needs', 'Needs you', [3]], ['working', 'Working', [1, 5]], ['done', 'Ready to review', [2, 4]], ['rev', 'Reviewed', [6, 7]]];
  const card = (id) => { const c = CARDS[id]; return `<button class="bcard ${c.s === 'needs' ? 'needs' : ''}" data-a="board-pick" data-id="${id}" ${bd.cur === id && bd.peek ? 'aria-current="true"' : ''}><span class="ttl" dir="auto">${esc(c.t)}</span><span class="meta">${mark(c.a, 'mark-sm')}<span class="ellip">${c.p} · ${esc(c.sub)}</span><span>${c.w}</span></span>${c.s === 'needs' ? `<span class="act"><span class="btn btn-primary btn-sm" role="button" data-a="toast">Allow</span><span class="btn btn-sm" role="button" data-a="toast">Deny</span></span>` : ''}</button>`; };
  const column = (c) => {
    const [k, label, ids] = c;
    if (k === 'rev' && bd.peek) return `<div class="bcol collapsed" title="Reviewed, 2">${ic('inventory_2')}<span class="t-2 num">${ids.length}</span><span class="v">Reviewed</span></div>`;
    const icon = k === 'needs' ? ic('front_hand') : k === 'working' ? ic('progress_activity') : k === 'done' ? ic('check_circle') : ic('inventory_2');
    const head = k === 'rev' ? `<span class="t-2" style="display:inline-flex;align-items:center;gap:4px">${icon}${label}</span>` : `<span class="state" data-s="${k === 'rev' ? 'idle' : k}">${icon}${label}</span>`;
    return `<div class="bcol" data-k="${k}"><div class="bcol-h">${head}<span class="n num">${ids.length}</span></div><div class="bcol-b">${ids.map(card).join('')}${k === 'needs' ? '' : ''}</div></div>`;
  };
  function peek() {
    const c = CARDS[bd.cur];
    const lines = bd.cur === 3 ? `<div class="tl prompt">&gt; Apply the retry columns migration to staging</div><div class="tl gap"></div><div class="tl">● Checking what is pending first.</div><div class="tl cmd">● Bash(npm run migrate -- --status)</div><div class="tl dim">  └ 1 pending: 0042_add_retry_columns</div><div class="tl gap"></div><div class="tl cmd">● Bash(npm run migrate -- --env staging)</div><div class="tl warn">  Waiting for your approval…</div>` : `<div class="tl prompt">&gt; ${esc(c.t)}</div><div class="tl gap"></div><div class="tl">● ${esc(c.sub)}</div><div class="tl dim">  └ updated just now</div>`;
    const appr = bd.cur === 3 ? `<div class="appr" role="alertdialog" aria-label="Approval needed"><div class="appr-q">${ic('front_hand')}<span>Allow Claude to run this command?</span><span class="chip">Bash</span></div><div class="appr-cmd"><i>$</i>npm run migrate -- --env staging</div><div class="appr-meta"><span>Writes <span class="mono">db/migrations/0042_add_retry_columns.sql</span></span></div><div class="appr-act"><button class="btn btn-primary btn-sm" data-a="toast">Allow ${kbd('Enter')}</button><button class="btn btn-sm" data-a="toast">Allow always</button><button class="btn btn-ghost btn-sm" data-a="toast">Deny ${kbd('Esc')}</button></div></div>` : '';
    return `<aside class="peek" aria-label="Session peek"><div class="peek-h">${mark(c.a)}<div class="t"><b class="ellip" dir="auto">${esc(c.t)}</b><span class="t-meta">${c.p}</span></div>${state(c.s)}${ibtn('close', 'Close peek', 'peek-close')}</div><div class="peek-b"><div class="pb"><div class="term">${lines}</div>${appr}</div><div class="peek-reply"><input class="input" placeholder="Reply to Claude" aria-label="Reply"><button class="btn btn-primary" data-a="toast">Send</button></div><button class="btn" data-a="toast">${ic('open_in_full')}Open in grid ${kbd('Enter')}</button></div></aside>`;
  }
  SC.mount('f-board', () => {
    const tb = `<div class="st"><div class="tabs" role="tablist" aria-label="Layout"><button class="tab" role="tab" aria-selected="false" data-a="toast">${ic('grid_view')}Grid</button><button class="tab" role="tab" aria-selected="true">${ic('view_kanban')}Board</button></div><button class="btn btn-ghost" data-a="toast">${ic('dashboard_customize')}Layouts</button><label class="lbl">${tog(false, 'Dim others')}Dim others</label><span class="grow"></span><span class="state state-chip" data-s="needs">${ic('front_hand')}1 needs you ${kbd('Ctrl Shift J')}</span>${ibtn('help', 'How the board works')}</div>`;
    const main = `${tb}<div class="bd-wrap"><div class="bd-main"><div class="bd-cols" style="${bd.peek ? 'grid-template-columns:repeat(3,minmax(0,1fr)) 44px' : 'grid-template-columns:repeat(4,minmax(0,1fr))'}">${COLS.map(column).join('')}</div></div>${bd.peek ? peek() : ''}</div>`;
    return shell('Sessions', main, { compact: bd.peek });
  });
  const bsync = () => { $('#peek-lbl').textContent = bd.peek ? 'Close peek' : 'Open peek'; SC.render('f-board'); };
  H['board-pick'] = (el, fr, e) => { if (e.target.closest('.btn')) { SC.toast(fr, 'Demo only: this action is not wired in the mockup.'); return; } bd.cur = +el.dataset.id; bd.peek = true; bsync(); };
  H['peek'] = () => { bd.peek = !bd.peek; bsync(); };
  H['peek-close'] = () => { bd.peek = false; bsync(); };

  /* ================= REPLAY ================= */
  const rp = (SC.st.replay = { view: 'player', p: 46, playing: false, timer: null });
  const EV = [[0, '0:00', 'chat_bubble', 'You asked: <b>Add retry with backoff to the webhook sender</b>', 'prompt'], [14, '3:55', 'edit', 'Edited <b>src/sender.ts</b>', ''], [30, '8:24', 'terminal', 'Ran <b>npm test</b>, 23 passed, 1 failed', 'error'], [46, '12:53', 'front_hand', 'Asked to run <b>migrate --env staging</b>', 'needs'], [52, '14:34', 'edit', 'Edited <b>src/backoff.ts</b>', ''], [71, '19:52', 'terminal', 'Ran <b>npm test</b>, 24 passed', ''], [100, '28:00', 'check_circle', 'Finished, 3 files changed', 'end']];
  const LINES = [[0, 'prompt', '> Add retry with backoff to the webhook sender'], [0, 'gap'], [2, '', '● I will read the sender first, then add a capped exponential backoff.'], [6, 'cmd', '● Read(src/sender.ts)'], [8, 'dim', '  └ Read 84 lines'], [14, 'cmd', '● Update(src/sender.ts)'], [16, 'dim', '  └ 12 additions, 3 removals'], [18, 'add', '  + await sleep(backoff(attempt) + jitter())'], [18, 'del', '  - await send(payload)'], [30, 'cmd', '● Bash(npm test)'], [31, 'del', '  23 passed, 1 failed: sender retries on 503'], [38, '', '● The test expects a cap; I will add MAX_ATTEMPTS.'], [46, 'cmd', '● Bash(npm run migrate -- --env staging)'], [46, 'warn', '  Waiting for your approval…'], [52, 'cmd', '● Write(src/backoff.ts)'], [53, 'add', '  + export function backoff(n) { return Math.min(30000, 2 ** n * 250) }'], [71, 'cmd', '● Bash(npm test)'], [72, 'add', '  24 passed'], [100, 'add', '✔ Done. 3 files changed.']];
  const rpHeader = (acts) => page('Replay', 'Add retry with backoff to the webhook sender · Claude Code · Oct 29, 10:44 to 11:12', acts, '', '', '', ['Sessions', 'toast']);
  function player(tab) {
    const p = rp.p, shown = LINES.filter((l) => l[0] <= p);
    const cur = [...EV].reverse().find((e) => e[0] <= p);
    const mk = EV.map((e) => (e[4] ? `<span class="mk" data-k="${e[4]}" style="inset-inline-start:${e[0]}%" title="${e[1]}">${ic(e[4] === 'needs' ? 'front_hand' : e[4] === 'end' ? 'check_circle' : e[4] === 'error' ? 'error' : 'chat_bubble')}</span>` : '')).join('');
    const events = EV.map((e) => `<button class="evt ${e[0] > p ? 'future' : ''}" data-a="rp-seek" data-p="${e[0]}" ${cur === e ? 'aria-current="true"' : ''}><time>${e[1]}</time>${ic(e[2])}<span>${e[3]}</span></button>`).join('');
    const insights = `<div class="ins"><div class="ins-card"><span class="t-meta">Longest wait on you</span><span class="big">3m 10s</span><span class="t-2">Approval for the migration at 12:53</span></div><div class="ins-card"><span class="t-meta">Where the 28 minutes went</span><div class="tsplit"><i style="flex:61;--c:var(--st-working)"></i><i style="flex:14;--c:var(--st-needs)"></i><i style="flex:17;--c:var(--st-idle)"></i><i style="flex:8;--c:var(--accent)"></i></div><div class="tleg"><span><i style="--c:var(--st-working)"></i>Working 61%</span><span><i style="--c:var(--st-needs)"></i>Waiting 14%</span><span><i style="--c:var(--st-idle)"></i>Idle 17%</span><span><i style="--c:var(--accent)"></i>Tests 8%</span></div></div><div class="ins-card"><span class="t-meta">Tests</span><span class="t-2"><b style="color:var(--text)">23 passed, 1 failed</b> then <b style="color:var(--text)">24 passed</b></span></div><div class="ins-card"><span class="t-meta">Files touched</span><span class="big">3</span><span class="t-2 mono" style="font-size:var(--fs-1)">sender.ts, backoff.ts, 0042_retry.sql</span></div></div>`;
    const rail = `<div class="rp-rail">${seg([['events', 'Events'], ['insights', 'Insights'], ['search', 'Search']], tab, 'rp-tab')}${tab === 'search' ? '' : `<div class="row wrap">${['All', 'Prompts', 'Edits', 'Commands', 'Approvals', 'Tests'].map((x, i) => `<span class="chip ${i === 0 ? 'chip-accent' : ''}" role="button" tabindex="0" data-a="toast">${x}</span>`).join('')}</div>`}<div class="lst">${tab === 'insights' ? insights : events}</div></div>`;
    const t = Math.round((p / 100) * 28 * 60), tm = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const left = `<div class="rp-left"><div class="rp-canvas"><div class="run-term" style="box-shadow:none;border-radius:0;flex:1"><div class="hd">${state(p >= 100 ? 'done' : p === 46 ? 'needs' : 'working')}<span class="grow ellip t-2">Billing API · feature/retry-backoff</span><span class="t-meta">Read only</span></div><div class="term">${shown.map((l) => (l[1] === 'gap' ? '<div class="tl gap"></div>' : `<div class="tl ${l[1]}">${esc(l[2])}</div>`)).join('')}</div></div></div>
      <div class="transport"><div class="trk-row"><button class="btn btn-primary btn-icon btn-lg" data-a="rp-play" aria-label="${rp.playing ? 'Pause' : 'Play'}">${ic(rp.playing ? 'pause' : 'play_arrow')}</button>${ibtn('skip_previous', 'Start', 'rp-seek', 'data-p="0"')}${ibtn('skip_next', 'End', 'rp-seek', 'data-p="100"')}<span class="num t-2" style="min-width:84px">${tm} / 28:00</span><div class="trk" data-a="rp-track" style="--p:${p}%" role="slider" aria-valuenow="${p}" aria-label="Playback position" tabindex="0"><span class="idle" style="inset-inline-start:56%;width:7%"></span><span class="fillb"></span>${mk}<span class="head"></span></div>${seg([['1', '1x'], ['4', '4x'], ['16', '16x']], '4', 'seg-demo')}<label class="row t-2">${tog(true, 'Skip idle time')}Skip idle</label></div>
      <div class="legend-row"><span><i class="icon sm" style="color:var(--text)">chat_bubble</i>Prompt</span><span><i class="icon sm" style="color:var(--st-error)">error</i>Test failed</span><span><i class="icon sm" style="color:var(--st-needs)">front_hand</i>Needs you</span><span><i class="icon sm" style="color:var(--st-done)">check_circle</i>Ended</span><span style="margin-inline-start:auto" class="t-meta">Dashed stretch is idle time, skipped</span></div></div></div>`;
    return `<div class="rp-grid">${left}${rail}</div>`;
  }
  const hl = (t, q) => esc(t).replace(new RegExp(`(${q})`, 'ig'), '<span class="hl">$1</span>');
  function rsearch() {
    const G = [['claude', 'Apply the retry columns migration to staging', 'Billing API · today', [['12:03', 'front_hand', 'Asked to run migrate --env staging for the retry columns <migration>'], ['12:01', 'chat_bubble', 'Apply the retry columns migration to staging']]], ['claude', 'Add retry with backoff to the webhook sender', 'Billing API · today', [['12:53', 'front_hand', 'Asked to run npm run migrate -- --env staging'], ['14:34', 'edit', 'Wrote db/migrations/0042_add_retry_columns.sql (the migration)']]], ['codex', 'Backfill invoice totals', 'Billing API · Oct 24', [['16:20', 'terminal', 'Ran npm run migrate -- --status, 2 pending migration files'], ['16:25', 'check_circle', 'Applied the migration on dev, 0 errors']]]];
    const body = `<div class="row" style="gap:var(--sp-3)"><div class="input-wrap grow srch-big"><i class="icon">search</i><input class="input input-lg" aria-label="Search all sessions" value="migration"></div><span class="t-2">3 sessions · 6 matches</span></div><div class="row wrap">${['All', 'Prompts', 'Edits', 'Commands', 'Approvals', 'Tests'].map((x, i) => `<span class="chip ${i === 0 ? 'chip-accent' : ''}" role="button" tabindex="0" data-a="toast">${x}</span>`).join('')}<span class="grow"></span><button class="btn btn-ghost btn-sm" data-a="toast">Any project ${ic('expand_more')}</button><button class="btn btn-ghost btn-sm" data-a="toast">Any agent ${ic('expand_more')}</button></div>
      <div style="display:flex;flex-direction:column;gap:var(--sp-4);overflow:auto;min-height:0">${G.map((g) => `<div class="res-group"><div class="res-head">${mark(g[0], 'mark-sm')}<b class="ellip">${esc(g[1])}</b><span class="t-meta">${g[2]}</span></div>${g[3].map((r) => `<div class="res-item"><time>${r[0]}</time>${ic(r[1])}<span class="ellip">${hl(r[2].replace(/[<>]/g, ''), 'migrat\\w*')}</span><button class="btn btn-sm" data-a="toast">Open at ${r[0]}</button></div>`).join('')}</div>`).join('')}</div>`;
    return page('Search', 'Prompts, edits, commands and approvals across every recorded session', `<button class="btn" data-a="toast">${ic('download')}Export results</button>`, '', body, '', ['Replay', 'toast']);
  }
  SC.mount('f-replay', () => {
    let main;
    if (rp.view === 'search') main = rsearch();
    else {
      const base = rpHeader(`<button class="btn" data-a="toast">${ic('link')}Copy link</button><button class="btn" data-a="toast">${ic('download')}Export</button><button class="btn btn-primary" data-a="toast">${ic('arrow_back')}Back to session</button>`);
      main = base.replace(/<div class="pgb ">\s*<\/div>/, `<div class="pgb ">${player(rp.view === 'insights' ? 'insights' : 'events')}</div>`);
    }
    return shell('Sessions', main, { compact: true });
  });
  const rsync = () => { $$('[data-a="replay-view"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === rp.view)); SC.render('f-replay'); };
  H['replay-view'] = (el) => { rp.view = el.dataset.v; rsync(); };
  H['rp-seek'] = (el) => { rp.p = +el.dataset.p; SC.render('f-replay'); };
  H['rp-track'] = (el, fr, e) => { const r = el.getBoundingClientRect(); rp.p = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100))); SC.render('f-replay'); };
  H['rp-tab'] = (el) => { rp.view = el.dataset.v === 'insights' ? 'insights' : el.dataset.v === 'search' ? 'search' : 'player'; rsync(); };
  H['rp-play'] = () => {
    rp.playing = !rp.playing;
    clearInterval(rp.timer);
    if (rp.playing) rp.timer = setInterval(() => { rp.p = Math.min(100, rp.p + 2); if (rp.p >= 100) { rp.playing = false; clearInterval(rp.timer); } SC.render('f-replay'); }, 400);
    SC.render('f-replay');
  };

  /* ================= SKILLS ================= */
  const sk = (SC.st.skills = { cur: 0 });
  const SK = [
    ['pr-review-checklist', 'Checks a pull request against the team review list', 'linked', ['claude', 'codex'], ['Rami'], '~/dawsha-skills/pr-review-checklist'],
    ['incident-triage', 'Turns a correlation id into logs, first error and cause', 'linked', ['claude'], ['Nadia'], '~/dawsha-skills/incident-triage'],
    ['commit-message', 'Writes a conventional commit from the staged diff', 'linked', ['claude', 'codex', 'gemini'], [], '~/dawsha-skills/commit-message'],
    ['release-notes', 'Drafts release notes from merged pull requests', 'linked', ['claude', 'codex', 'gemini'], ['Omar'], '~/dawsha-skills/release-notes'],
    ['write-migration', 'Creates a reversible SQL migration and its test', 'local', ['claude'], [], 'Billing API/.claude/skills/write-migration'],
    ['test-first', 'Writes the failing test before the fix', 'local', ['codex'], ['Sami'], 'Billing API/.codex/skills/test-first'],
    ['api-docs-style', 'Keeps endpoint docs in one voice and layout', 'local', ['gemini', 'claude'], ['Omar'], 'Docs site/.gemini/skills/api-docs-style'],
    ['arabic-copy-review', 'Reviews Arabic UI strings for tone and RTL issues', 'local', ['claude'], [], 'Mobile app/.claude/skills/arabic-copy-review']
  ];
  SC.mount('f-skills', () => {
    const s = SK[sk.cur];
    const rows = SK.map((r, i) => `<button class="sk-row" data-a="skill-pick" data-i="${i}" ${i === sk.cur ? 'aria-current="true"' : ''}><span class="fi">${ic('extension')}</span><span class="t"><b>${r[0]}</b><span>${r[1]}</span></span><span class="chip ${r[2] === 'linked' ? 'chip-accent' : ''}">${ic(r[2] === 'linked' ? 'link' : 'folder', 'sm')}${r[2] === 'linked' ? 'Linked' : 'Local'}</span><span class="stack">${r[3].map((a) => mark(a, 'mark-sm')).join('')}</span></button>`).join('');
    const side = `<aside class="sk-side"><div><h3>${s[0]}</h3><p class="t-2" style="margin:var(--sp-1) 0 0">${s[1]}</p></div><div class="row wrap"><span class="chip ${s[2] === 'linked' ? 'chip-accent' : ''}">${s[2] === 'linked' ? 'Linked from a shared folder' : 'Local to a project'}</span></div><dl class="kv" style="grid-template-columns:72px 1fr"><dt>Path</dt><dd class="mono" style="font-size:var(--fs-1)">${s[5]}</dd><dt>Loaded by</dt><dd class="row">${s[3].map((a) => mark(a, 'mark-sm')).join('')}</dd><dt>Crew</dt><dd>${s[4].length ? s[4].map((n) => `<span class="chip">${n}</span>`).join(' ') : '<span class="t-3">No crew member uses it</span>'}</dd><dt>Last used</dt><dd>${sk.cur < 3 ? '12 min ago' : 'Yesterday'}</dd></dl><div><div class="t-meta" style="margin-bottom:var(--sp-1)">SKILL.md</div><div class="md-prev"><span class="c">---</span>\n<span class="k">name:</span> ${s[0]}\n<span class="k">description:</span> ${s[1]}\n<span class="c">---</span>\n\nRead the change first.\nQuote the file and line for each finding.\nList blocking items before suggestions.</div></div><div class="row"><button class="btn" data-a="toast">${ic('edit')}Open file</button>${s[2] === 'linked' ? `<button class="btn btn-ghost" data-a="toast">${ic('link_off')}Unlink</button>` : ''}</div></aside>`;
    const tabs = `${seg([['all', 'All', null, 8], ['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini']], 'all', 'seg-demo')}${seg([['any', 'Linked and local'], ['l', 'Linked'], ['x', 'Local']], 'any', 'seg-demo')}`;
    return shell('Skills', page('Skills', 'Instructions agents load on demand.', `${search('Search skills', 'search-sm')}<button class="btn" data-a="toast">${ic('refresh')}Refresh</button><button class="btn btn-primary" data-a="toast">${ic('link')}Link a folder</button>`, tabs, `<div class="sk-grid"><div class="sk-list">${rows}</div>${side}</div>`));
  });
  H['skill-pick'] = (el) => { sk.cur = +el.dataset.i; SC.render('f-skills'); };

  /* ================= PROJECTS ================= */
  SC.mount('f-projects', () => {
    const R = [['Billing API', '~/work/billing-api', 'feature/retry-backoff', 3, ['claude', 'codex'], false], ['Docs site', '~/work/docs-site', 'main', 1, ['gemini', 'claude'], false], ['Mobile app', '~/work/mobile-app', 'feature/offline-sync', 1, ['claude'], false], ['Legacy tools', '~/work/legacy-tools', '', 0, [], true]];
    const rows = R.map((r) => `<div class="pj-row ${r[5] ? 'miss' : ''}"><div class="nm"><b>${r[0]}</b><span class="mono">${r[1]}</span>${r[5] ? `<span class="state" data-s="error" style="margin-top:2px">${ic('folder_off')}Folder not found</span>` : ''}</div><div class="row">${r[2] ? `${ic('call_split', 'sm')}<span class="mono t-2" style="font-size:var(--fs-1)">${r[2]}</span>` : '<span class="t-3">No branch</span>'}</div><div>${r[3] ? `<span class="state" data-s="working">${ic('progress_activity')}${r[3]} live</span>` : '<span class="t-3">No sessions</span>'}</div><div class="stack">${r[4].map((a) => mark(a, 'mark-sm')).join('')}</div><div class="row">${r[5] ? `<button class="btn" data-a="toast">${ic('folder_open')}Locate…</button>` : `<button class="btn" data-a="toast">${ic('add')}New session</button>`}${ibtn('more_horiz', 'Project actions')}</div></div>`).join('');
    return shell('Sessions', page('Projects', 'Folders your sessions run in. Add, locate or remove them here.', `${search('Search projects', 'search-sm')}<button class="btn btn-primary" data-a="toast">${ic('add')}Add project</button>`, seg([['p', 'Projects', null, 4], ['t', 'Tasks'], ['i', 'Instructions']], 'p', 'seg-demo'), rows));
  });

  /* ================= USAGE ================= */
  SC.mount('f-usage', () => {
    const urow = (w, v, r, c = '') => `<div class="urow"><span>${w}</span><span class="num"><b>${v}%</b></span><span class="meter ${c}" style="--v:${v}"></span><span class="t-meta"><span>${r}</span></span></div>`;
    const lim = `<div class="lim-grid"><div class="lim-card"><div class="uagent">${mark('claude', 'mark-sm')}Claude Code</div>${urow('5-hour window', 62, 'Resets in 1h 39m')}${urow('Week', 18, 'Resets Thursday 09:00')}</div><div class="lim-card"><div class="uagent">${mark('codex', 'mark-sm')}Codex</div>${urow('5-hour window', 23, 'Resets in 3h 05m')}${urow('Week', 88, 'Resets Friday 09:00', 'warn')}</div><div class="lim-card"><div class="uagent">${mark('gemini', 'mark-sm')}Gemini</div><p class="t-2" style="margin:0">Not signed in. Gemini reports no limits until you sign in.</p><div style="margin-top:auto"><button class="btn" data-a="toast">Sign in</button></div></div></div>`;
    const D = [[1.2, .4, 0], [2.1, 0, 0], [3.4, 1.0, .3], [2.8, .6, 0], [0, 0, 0], [0, 0, 0], [1.9, .9, 0], [3.9, 1.4, .4], [4.4, .8, 0], [2.6, 1.9, .2], [3.1, 1.1, 0], [3.6, .7, .3], [2.2, 1.5, 0], [3.1, 1.15, 0]];
    const days = ['16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29'];
    const max = 6, tot = D.reduce((s, d) => s + d[0] + d[1] + d[2], 0);
    const plot = D.map((d, i) => `<div class="bar ${i === 13 ? 'today' : ''}"><div class="stk" title="Oct ${days[i]}: Claude $${d[0]}, Codex $${d[1]}, Gemini $${d[2]}">${['claude', 'codex', 'gemini'].map((a, k) => (d[k] ? `<i class="cd-${a}" style="height:${(d[k] / max) * 100}%"></i>` : '')).join('')}</div><span class="x">${days[i]}</span></div>`).join('');
    const chart = `<div class="chart-card"><div class="chart-head"><h3 class="t-title">Cost per day</h3><span class="sum"><b>$4.25</b> today · <b>$${tot.toFixed(2)}</b> in 14 days</span><span class="lgnd"><span class="cd-claude"><i></i>Claude</span><span class="cd-codex"><i></i>Codex</span><span class="cd-gemini"><i></i>Gemini</span></span></div><div class="chart"><div class="yax"><span>$6</span><span>$4.50</span><span>$3</span><span>$1.50</span><span>$0</span></div><div class="plot">${plot}</div></div></div>`;
    const t1 = `<div class="card"><h3 class="t-title">By project</h3><table class="dtable"><thead><tr><th>Project</th><th class="num">Sessions</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody><tr><td>Billing API</td><td class="num">18</td><td class="num">9.1M</td><td class="num">$31.60</td></tr><tr><td>Docs site</td><td class="num">8</td><td class="num">2.4M</td><td class="num">$10.20</td></tr><tr><td>Mobile app</td><td class="num">5</td><td class="num">0.9M</td><td class="num">$5.15</td></tr></tbody></table></div>`;
    const t2 = `<div class="card"><h3 class="t-title">By agent</h3><table class="dtable"><thead><tr><th>Agent</th><th class="num">Sessions</th><th class="num">Tokens</th><th class="num">Cost</th></tr></thead><tbody><tr><td class="nw">${mark('claude', 'mark-sm')} Claude Code</td><td class="num">17</td><td class="num">9.9M</td><td class="num">$34.30</td></tr><tr><td class="nw">${mark('codex', 'mark-sm')} Codex</td><td class="num">9</td><td class="num">2.5M</td><td class="num">$11.45</td></tr><tr><td class="nw">${mark('gemini', 'mark-sm')} Gemini</td><td class="num">5</td><td class="num"><span class="chip">Not reported</span></td><td class="num">$1.20</td></tr></tbody></table></div>`;
    const acts = `${seg([['t', 'Today'], ['7', '7 days'], ['14', '14 days'], ['30', '30 days']], '14', 'seg-demo')}<button class="btn" data-a="toast">${ic('refresh')}Refresh</button>`;
    return shell('Usage', page('Usage', 'Limits and spend across all agents.', acts, '', `${lim}${chart}<div class="tbl2">${t1}${t2}</div>`));
  });
})();
