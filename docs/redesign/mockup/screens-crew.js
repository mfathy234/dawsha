/* Crew: two directions x five views. */
(function () {
  const { $, $$, esc, ic, mark, state, kbd, ibtn, av, seg, search, tog, field, sel, page, shell, over, dialog } = SC;
  const ui = (SC.st.crew = { dir: 'A', view: 'overview', sel: 'rami' });

  const AG = [
    { id: 'maya', n: 'Maya', role: 'Lead', ini: 'MA', a: 'claude', model: 'Opus 5.5', lead: true, s: 'idle', last: 'Plan ready, waiting for your goal', purpose: 'Plans a goal, then hands each step to the right crew member.' },
    { id: 'rami', n: 'Rami', role: 'PR review', ini: 'RA', a: 'claude', model: 'Opus 5.5', s: 'done', last: 'Passed, 3 comments', when: '12 min ago', purpose: 'Reviews a pull request against your checklist and posts findings.' },
    { id: 'nadia', n: 'Nadia', role: 'Incident diagnosis', ini: 'NA', a: 'claude', model: 'Opus 5.5', s: 'working', last: 'Reading logs for the request', when: 'running 4m 12s', purpose: 'Takes a correlation id, finds the first error and explains the cause.' },
    { id: 'sami', n: 'Sami', role: 'Test writer', ini: 'SA', a: 'codex', model: 'Codex 5', builtin: true, s: 'done', last: '2 tests added', when: 'yesterday', purpose: 'Adds focused tests for the change you point at.' },
    { id: 'omar', n: 'Omar', role: 'Docs updater', ini: 'OM', a: 'gemini', model: 'Gemini 3 Pro', builtin: true, s: 'idle', last: 'Not run yet', when: '', purpose: 'Keeps README and guides in step with the code.' }
  ];
  const ag = (id) => AG.find((x) => x.id === id);
  const full = (a) => (a.lead ? a.n + ' (lead)' : `${a.n} - ${a.role}`);

  /* ---------- shared bodies ---------- */
  const goalBox = () => `<div class="goal">${av('MA', 'lg', 'idle')}<div><div class="row" style="margin-bottom:var(--sp-2)"><h3 class="t-title">Give Maya a goal</h3><span class="t-meta">She plans first. Nothing runs until you approve.</span></div>
    <textarea class="textarea" aria-label="Goal" placeholder="What should the crew get done?">Ship webhook retries to staging without dropping events, and update the docs.</textarea>
    <div class="goal-ctl">${field('Project', sel(['Billing API', 'Docs site', 'Mobile app'], 'Billing API'))}${field('Model', sel(['Opus 5.5', 'Codex 5', 'Gemini 3 Pro'], 'Opus 5.5'))}<label class="tg">${tog(true, 'Ask before running members')}<span>Ask before running members</span></label><span class="grow"></span><button class="btn btn-primary btn-lg" data-a="toast">${ic('auto_awesome')}Make a plan ${kbd('Ctrl Enter')}</button></div></div></div>`;

  const phs = (t) => esc(t).replace(/\{\{(\w+)\}\}/g, '<span class="fph">{{$1}}</span>');
  const setupBody = (a) => {
    const ro = a.builtin ? `<div class="ro-note">${ic('lock', 'sm')}<span class="grow">Built-in agents are read-only.</span><button class="btn btn-sm" data-a="toast">${ic('content_copy')}Duplicate to edit</button></div>` : '';
    const dis = a.builtin ? 'disabled' : '';
    return `${ro}<div class="formgrid"><div class="fcol">
      <section class="fsec"><h4>Identity</h4><div class="f2">${field('Name', `<input class="input" value="${esc(a.n)}" ${dis}>`)}${field('Role', `<input class="input" value="${esc(a.role)}" ${dis}>`)}</div>${field('Colour', `<div class="swatches">${['#d97757', '#e5c76b', '#4ade9f', '#72b4ff', '#a78bfa', '#ec8fc4'].map((c, i) => `<button class="swatch" style="--c:${c}" aria-pressed="${i === 3}" aria-label="Colour ${i + 1}" data-a="toast"></button>`).join('')}</div>`)}</section>
      <section class="fsec"><h4>Brief</h4>${field('Instructions', `<textarea class="textarea" ${dis} style="min-height:96px">Review the diff for correctness first, then style. Check the PR against the team checklist. Quote the file and line for every finding. Never push changes yourself.</textarea>`, 'The standing role. Applies to every run.')}</section>
      <section class="fsec"><h4>Prompt<span class="chip chip-accent">2 fields</span></h4><div class="prompt-view">${phs('Review the pull request at {{pr_url}} in the project {{project}}. Follow your instructions and list findings by severity.')}</div><span class="t-meta">Use {{name}} for a value you fill in at run time.</span></section>
      <section class="fsec"><h4>Paste triggers</h4><div class="trig">${ic('content_paste', 'sm')}<span class="mono grow">github.com/*/pull/*</span><span class="t-meta">fills {{pr_url}}</span></div><div class="trig">${ic('content_paste', 'sm')}<span class="mono grow">uuid</span><span class="t-meta">fills {{correlation_id}}</span></div></section>
    </div><div class="fcol">
      <section class="fsec"><h4>Runner</h4><div class="f2">${field('Agent', sel(['Claude Code', 'Codex', 'Gemini'], a.a === 'claude' ? 'Claude Code' : a.a === 'codex' ? 'Codex' : 'Gemini'))}${field('Model', sel(['Opus 5.5', 'Sonnet 5.5', 'Codex 5', 'Gemini 3 Pro'], a.model))}</div>${field('Effort', SC.seg([['l', 'Low'], ['m', 'Medium'], ['h', 'High']], 'h', 'seg-demo'))}</section>
      <section class="fsec"><h4>Permissions</h4><div class="prow"><div class="t">Edit files<span>Review only, so off</span></div>${tog(false, 'Edit files')}</div><div class="prow"><div class="t">Run commands<span>Only the allowlist: git, npm test</span></div>${tog(true, 'Run commands')}</div><div class="prow"><div class="t">Network<span>Fetch the PR and its checks</span></div>${tog(true, 'Network')}</div></section>
      <section class="fsec"><h4>Startup</h4>${field('Command before the agent starts', `<input class="input mono" value="git fetch origin" ${dis}>`)}<div class="prow"><div class="t">Start in a new pane<span>Otherwise runs in the background</span></div>${tog(true, 'New pane')}</div></section>
      <section class="fsec"><h4>Projects</h4><div class="row wrap"><span class="chip chip-accent">Billing API</span><span class="chip chip-accent">Docs site</span><button class="chip" role="button" data-a="toast">${ic('add', 'sm')}Add project</button></div></section>
      
    </div></div>`;
  };

  const runRows = [
    ['done', 'Rami', 'Paste', 'PR #482 Add webhook retries', '2m 40s', 'Passed, 3 comments', '$0.31', '12 min ago'],
    ['done', 'Rami', 'Manual', 'PR #479 Fix invoice rounding', '3m 05s', 'Passed, 0 comments', '$0.28', 'Yesterday'],
    ['error', 'Rami', 'Paste', 'PR #476 Upgrade ESLint config', '1m 12s', 'Stopped: could not fetch the diff', '$0.06', 'Mon'],
    ['done', 'Rami', 'Schedule', 'Nightly: open PRs on main', '9m 31s', 'Reviewed 4, 2 need changes', '$1.04', 'Mon'],
    ['done', 'Rami', 'Paste', 'PR #471 Add idempotency keys', '2m 18s', 'Passed, 1 comment', '$0.24', 'Oct 24'],
    ['done', 'Rami', 'Manual', 'PR #468 Docs for webhooks', '1m 50s', 'Passed, 0 comments', '$0.17', 'Oct 23']
  ];
  const runsBody = () => `<div class="row"><div class="tabs" role="tablist">${[['all', 'All', null, 6], ['ok', 'Passed', null, 4], ['err', 'Stopped', null, 1]].map((x, i) => `<button class="tab" role="tab" data-a="toast" aria-selected="${i === 0}">${x[1]}<span class="count">${x[3]}</span></button>`).join('')}</div><span class="grow"></span><span class="t-meta">Total $2.10 in 7 days</span></div>
    <table class="dtable"><thead><tr><th>Result</th><th>Task</th><th>Started by</th><th class="num">Duration</th><th class="num">Cost</th><th>When</th><th></th></tr></thead><tbody>${runRows.map((r) => `<tr><td class="nw">${state(r[0] === 'error' ? 'error' : 'done', false, r[0] === 'error' ? 'Stopped' : 'Passed')}</td><td>${esc(r[3])}<span class="sub">${esc(r[5])}</span></td><td class="nw">${r[2] === 'Paste' ? ic('content_paste', 'sm') : r[2] === 'Schedule' ? ic('schedule', 'sm') : ic('touch_app', 'sm')} ${r[2]}</td><td class="num">${r[4]}</td><td class="num">${r[6]}</td><td class="nw t-2">${r[7]}</td><td>${ibtn('more_horiz', 'Run actions')}</td></tr>`).join('')}</tbody></table>`;

  const liveBody = () => `<div class="run-grid"><div class="run-term"><div class="hd">${state('working')}<span class="grow ellip t-2">Diagnosing request c0e3a7d1 in staging</span><span class="t-meta num">4m 12s</span></div>
    <div class="term"><div class="tl prompt">&gt; Diagnose why request c0e3a7d1-5b2f failed in staging</div><div class="tl gap"></div><div class="tl">● Pulling logs for that correlation id.</div><div class="tl cmd">● Bash(logs --id c0e3a7d1-5b2f --env staging)</div><div class="tl dim">  └ 38 lines, 2 services, first error at 14:02:11</div><div class="tl gap"></div><div class="tl">● The first error is in webhook-sender:</div><div class="tl del">  ConnectionResetError: endpoint closed the socket</div><div class="tl cmd">● Read(src/sender.ts)</div><div class="tl dim">  └ Read 84 lines</div><div class="tl gap"></div><div class="tl">● There is no retry around send(), so one reset drops the event.</div><div class="tl warn">✻ Working… (4m 12s · esc to interrupt)</div></div></div>
    <div class="run-side"><div class="card" style="background:var(--raised);border:0"><div class="sect-label" style="margin-bottom:var(--sp-2)">Plan</div><div class="chk done"><i class="icon">check_circle</i><span>Pull logs for the id</span></div><div class="chk done" style="margin-top:6px"><i class="icon">check_circle</i><span>Find the first error</span></div><div class="chk now" style="margin-top:6px"><i class="icon">pending</i><span>Read the code that sent it</span></div><div class="chk" style="margin-top:6px"><i class="icon">radio_button_unchecked</i><span>Write the root cause and fix</span></div></div>
    <dl class="kv" style="grid-template-columns:72px 1fr"><dt>Started by</dt><dd>Pasted id</dd><dt>Project</dt><dd>Billing API</dd><dt>Env</dt><dd>staging</dd><dt>Model</dt><dd>${mark('claude', 'mark-sm')} Opus 5.5, high</dd><dt>Cost</dt><dd class="num">$0.19 so far</dd></dl><div class="pbar" style="--v:55" aria-label="Estimated progress"><i></i></div><div class="row"><button class="btn" data-a="toast">${ic('open_in_new')}Open in a pane</button><button class="btn btn-danger-ghost" data-a="toast">${ic('stop_circle')}Stop</button></div></div></div>`;

  const runDialog = () => over(dialog('Run Nadia - Incident diagnosis', `<div class="ro-note" style="margin-bottom:var(--sp-4)">${ic('content_paste', 'sm')}<span class="grow">Found a correlation id on your clipboard and filled it in.</span><button class="btn btn-ghost btn-sm" data-a="toast">Undo</button></div>
    <div class="fcol" style="gap:var(--sp-4)">${field('Correlation id', `<input class="input mono" value="c0e3a7d1-5b2f-4f0e-9a41-7d2e8b6f31aa">`)}<div class="f2">${field('Environment', seg([['dev', 'dev'], ['stg', 'staging'], ['prd', 'prod']], 'stg', 'seg-demo'))}${field('Project', sel(['Billing API', 'Docs site', 'Mobile app'], 'Billing API'))}</div>
    <div class="field"><label>Prompt preview</label><div class="prompt-view">Diagnose why the request with correlation id <span class="ph-fill">c0e3a7d1-5b2f-4f0e-9a41-7d2e8b6f31aa</span> failed in <span class="ph-fill">staging</span>. Pull its logs, find the first error, read the code on the branch of <span class="ph-fill">Billing API</span> and report the root cause and a fix.</div><span class="help">Highlighted values were filled from the fields above.</span></div>
    ${field('Where', seg([['pane', 'New pane', 'terminal'], ['bg', 'Background', 'schedule']], 'pane', 'seg-demo'))}</div>`, `<span class="left t-meta">Runs on Opus 5.5, high effort</span><button class="btn btn-ghost" data-a="close">Cancel</button><button class="btn btn-primary" data-a="toast">Run Nadia ${kbd('Ctrl Enter')}</button>`, 'wide'));

  /* ---------- direction A ---------- */
  function roster() {
    const cards = AG.filter((a) => !a.lead).map((a) => `<div class="acard ${a.s === 'working' ? 'run' : ''}" role="button" tabindex="0" data-a="open-agent" data-id="${a.id}"><div class="top">${av(a.ini, 'lg', a.s)}<div class="grow"><div class="nm">${a.n}</div><div class="t-2">${a.role}</div></div>${a.builtin ? '<span class="chip">Built in</span>' : ''}</div><div class="purpose">${a.purpose}</div><div class="meta">${mark(a.a, 'mark-sm')}<span>${a.model}</span></div><div class="last"><div class="t">${state(a.s, false, a.s === 'working' ? 'Running' : a.s === 'idle' ? 'Idle' : 'Last run')}<span class="t-meta">${a.last}${a.when ? ' · ' + a.when : ''}</span></div><button class="btn ${a.s === 'working' ? '' : 'btn-primary'} btn-sm" data-a="${a.s === 'working' ? 'open-run' : 'run-agent'}" data-id="${a.id}">${a.s === 'working' ? 'View' : ic('play_arrow') + 'Run'}</button></div></div>`);
    cards.push(`<button class="acard new" data-a="toast">${ic('add')}<span>New agent</span><span class="t-meta">or import a crew file</span></button>`);
    return page('Crew', 'Your lead and specialists.', `${search('Search crew', 'search-sm')}<button class="btn" data-a="toast">${ic('upload_file')}Import</button><button class="btn btn-primary" data-a="toast">${ic('add')}New agent</button>`, '', `${goalBox()}<div class="sect-label">Your crew<span class="n">${AG.length - 1}</span></div><div class="roster">${cards.join('')}</div>`);
  }
  const aDetail = (a, tab, body, acts) => page(full(a), a.purpose, acts || `<button class="btn btn-primary" data-a="run-agent" data-id="${a.id}">${ic('play_arrow')}Run ${kbd('Ctrl Enter')}</button>${ibtn('more_horiz', 'More')}`, seg([['setup', 'Setup'], ['runs', 'Runs', null, 6], ['running', 'Live', null, a.s === 'working' ? '1' : '']].filter((x) => a.s === 'working' || x[0] !== 'running'), tab, 'view-go'), body, '', ['Crew', 'to-overview']);

  /* ---------- direction B ---------- */
  function listCol() {
    const row = (a) => `<button class="arow" data-a="b-sel" data-id="${a.id}" data-s="${a.s}" ${ui.sel === a.id ? 'aria-current="true"' : ''}>${av(a.ini, '', a.s)}<span class="t"><b>${a.n} <span style="color:var(--text-2);font-weight:400;display:inline">${a.role}</span></b><span>${a.s === 'working' ? 'Running · ' + a.when.replace('running ', '') : a.last + (a.when ? ' · ' + a.when : '')}</span></span></button>`;
    return `<div class="split-l">${search('Search crew')}<div class="sect-label" style="padding:var(--sp-3) var(--sp-2) var(--sp-1)">Lead</div><div class="alist">${row(ag('maya'))}</div><div class="sect-label" style="padding:var(--sp-3) var(--sp-2) var(--sp-1)">Yours<span class="n">2</span></div><div class="alist">${row(ag('rami'))}${row(ag('nadia'))}</div><div class="sect-label" style="padding:var(--sp-3) var(--sp-2) var(--sp-1)">Built in<span class="n">2</span></div><div class="alist">${row(ag('sami'))}${row(ag('omar'))}</div></div>`;
  }
  function bPage(a, tab, body) {
    const tabs = a.lead ? '' : seg([['setup', 'Setup'], ['runs', 'Runs', null, 6]].concat(a.s === 'working' ? [['running', 'Live', null, '1']] : []), tab, 'view-go');
    const head = `<div class="detail-head">${av(a.ini, 'lg', a.s)}<div class="ttl"><h3 class="t-title">${full(a)}</h3><span class="t-2">${mark(a.a, 'mark-sm')} ${a.model}${a.builtin ? ' · Built in' : ''}</span></div>${a.lead ? '' : (a.s === 'working' ? `<button class="btn btn-danger-ghost" data-a="toast">${ic('stop_circle')}Stop</button>` : `<button class="btn btn-primary" data-a="run-agent" data-id="${a.id}">${ic('play_arrow')}Run</button>`) + ibtn('more_horiz', 'More')}</div>`;
    return page('Crew', 'Your lead and specialists.', `<button class="btn" data-a="toast">${ic('upload_file')}Import</button><button class="btn btn-primary" data-a="toast">${ic('add')}New agent</button>`, '', `${listCol()}<div class="split-r">${head}${tabs ? `<div class="pgtabs" style="padding:var(--sp-3) var(--sp-7) 0 var(--sp-5)">${tabs}</div>` : ''}<div class="detail-body">${body}</div></div>`, 'split');
  }

  function build() {
    const v = ui.view;
    if (ui.dir === 'A') {
      let main, o = {};
      if (v === 'overview') main = roster();
      else if (v === 'setup') main = aDetail(ag('rami'), 'setup', setupBody(ag('rami')));
      else if (v === 'running') main = aDetail(ag('nadia'), 'running', liveBody(), `<button class="btn btn-danger-ghost" data-a="toast">${ic('stop_circle')}Stop</button><button class="btn" data-a="toast">${ic('open_in_new')}Open in a pane</button>`);
      else if (v === 'runs') main = aDetail(ag('rami'), 'runs', runsBody());
      else { main = roster(); o.over = runDialog(); }
      return shell('Crew', main, o);
    }
    let main, o = {};
    if (v === 'overview') { ui.sel = 'maya'; main = bPage(ag('maya'), '', `${goalBox()}<div class="sect-label">How she leads</div><p class="t-2" style="margin:0;max-width:60ch">Maya reads the goal, picks crew members by role and writes a plan with one step each. You approve the plan, then she runs the steps in order and reports back.</p>`); }
    else if (v === 'setup') { ui.sel = 'rami'; main = bPage(ag('rami'), 'setup', setupBody(ag('rami'))); }
    else if (v === 'running') { ui.sel = 'nadia'; main = bPage(ag('nadia'), 'running', liveBody()); }
    else if (v === 'runs') { ui.sel = 'rami'; main = bPage(ag('rami'), 'runs', runsBody()); }
    else { ui.sel = 'nadia'; main = bPage(ag('nadia'), 'setup', setupBody(ag('nadia'))); o.over = runDialog(); }
    return shell('Crew', main, o);
  }

  SC.mount('f-crew', build);
  const sync = () => {
    $$('[data-a="crew-dir"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === ui.dir));
    $$('[data-a="crew-view"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === ui.view));
    $('#note-A').hidden = ui.dir !== 'A'; $('#note-B').hidden = ui.dir !== 'B';
    SC.render('f-crew');
  };
  const H = SC.hooks;
  H['crew-dir'] = (el) => { ui.dir = el.dataset.v; sync(); };
  H['crew-view'] = (el) => { ui.view = el.dataset.v; sync(); };
  H['view-go'] = (el) => { ui.view = el.dataset.v; sync(); };
  H['to-overview'] = () => { ui.view = 'overview'; sync(); };
  H['open-agent'] = (el) => { ui.view = 'setup'; ui.sel = el.dataset.id; sync(); };
  H['open-run'] = () => { ui.view = 'running'; sync(); };
  H['run-agent'] = (el, fr) => { if (el.dataset.id === 'nadia') { ui.view = 'runid'; sync(); } else SC.toast(fr, 'Demo only: Nadia has the paste-id run.'); };
  H['b-sel'] = (el) => { ui.sel = el.dataset.id; ui.view = el.dataset.id === 'maya' ? 'overview' : el.dataset.id === 'nadia' ? 'running' : 'setup'; sync(); };
  H['seg-demo'] = (el) => { $$('.tab', el.parentElement).forEach((t) => t.setAttribute('aria-selected', t === el)); };
  H['close'] = (el, fr) => { const o = el.closest('.over'); if (o) { o.remove(); if (fr.id === 'f-crew') { ui.view = ui.dir === 'A' ? 'overview' : 'setup'; sync(); } } };
})();
