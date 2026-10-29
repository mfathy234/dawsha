/* Files and review. One diff look, inline or side by side. */
(function () {
  const { $, $$, esc, ic, mark, state, kbd, ibtn, seg, search, tog, shell, over, dialog, page } = SC;
  const ui = (SC.st.files = { view: 'browse', mode: 'split', cur: 'src/sender.ts', seen: { 'src/backoff.ts': 1 }, confirm: false, showChanges: true, q: 'backoff' });

  const bd = (l) => `<span class="badge ${l}">${l}</span>`;
  const tree = () => {
    const t = (d, icon, name, b, cur, a) => `<button class="trow d${d}" ${cur ? 'aria-current="true"' : ''} data-a="${a || 'toast'}" data-f="${name}">${ic(icon)}<span class="nm">${name}</span>${b ? bd(b) : ''}</button>`;
    return `${t(0, 'expand_more', 'src', 'M')}${t(1, 'description', 'sender.ts', 'M', ui.cur === 'src/sender.ts', 'file-pick')}${t(1, 'description', 'backoff.ts', 'A')}${t(1, 'expand_more', 'export', 'M').replace('d1', 'd1')}${t(2, 'description', 'invoice.ts', 'M')}${t(0, 'chevron_right', 'tests', 'M')}${t(0, 'chevron_right', 'db', 'A')}${t(0, 'chevron_right', 'docs')}${t(0, 'description', 'package.json')}${t(0, 'description', 'README.md')}`;
  };
  const changesGroups = (mode) => {
    const g = (agent, title, st, files, time) => `<div class="sgrp">${mark(agent, 'mark-sm')}<div class="t"><b class="ellip">${title}</b><span class="t-meta">${st}</span></div></div>${files.map((f) => mode === 'review' ? `<button class="rv-row ${ui.seen[f[1]] ? 'seen' : ''}" data-a="rv-pick" data-f="${f[1]}" ${ui.cur === f[1] ? 'aria-current="true"' : ''}><span class="vw" data-a="rv-seen" data-f="${f[1]}">${ui.seen[f[1]] ? ic('check') : ''}</span>${bd(f[0])}<span class="nm" title="${f[1]}">${f[1].split('/').pop()}</span><span class="ds">${f[2]}</span></button>` : `<button class="trow d1" ${ui.cur === f[1] ? 'aria-current="true"' : ''} data-a="file-pick" data-f="${f[1]}">${bd(f[0])}<span class="nm">${f[1].split('/').pop()}</span><span class="t-meta">${f[2]}</span></button>`).join('')}`;
    return g('claude', 'Add retry with backoff to the webhook sender', 'Claude Code · working · 3 files', [['M', 'src/sender.ts', '+30 -7'], ['A', 'src/backoff.ts', '+12'], ['A', 'db/migrations/0042_retry.sql', '+9']]) + g('codex', 'Fix flaky invoice export test', 'Codex · done · 2 files', [['M', 'src/export/invoice.ts', '+4 -1'], ['M', 'tests/invoice-export.test.ts', '+18 -3']]);
  };
  const railTop = (mode) => `<div class="top">${seg([['browse', 'Files', null], ['search', 'Search', null], ['review', 'Review', null, 5]], mode, 'files-view', 'tabs-lg')}${mode === 'browse' ? search('Go to file', '', '') : ''}</div>`;
  const rail = (mode, inner) => `<div class="fl-rail">${railTop(mode)}<div class="scroll">${inner}</div></div>`;

  const code = () => {
    const L = ['<span class="k">import</span> { backoff, jitter } <span class="k">from</span> <span class="s">\'./backoff\'</span>', '', '<span class="k">const</span> MAX_ATTEMPTS = 5', '', '<span class="c">// Deliver one webhook, retrying with capped backoff.</span>', '<span class="k">export async function</span> sendWebhook(payload: Payload) {', '  <span class="k">const</span> endpoint = resolveEndpoint(payload.tenant)', '  <span class="k">for</span> (<span class="k">let</span> attempt = 0; attempt &lt; MAX_ATTEMPTS; attempt++) {', '    <span class="k">const</span> ok = <span class="k">await</span> send(endpoint, payload)', '    <span class="k">if</span> (ok) <span class="k">return</span>', '    <span class="k">await</span> sleep(backoff(attempt) + jitter())', '  }', '  <span class="k">throw new</span> DeliveryError(payload.id)', '}'];
    return `<div class="code">${L.map((l, i) => `<div><span class="n">${i + 1}</span><span>${l || '&nbsp;'}</span></div>`).join('')}</div>`;
  };
  const diffToggle = () => seg([['inline', 'Inline', 'view_headline'], ['split', 'Side by side', 'splitscreen_vertical_add']].map((x) => x), ui.mode, 'diff-mode').replace(/splitscreen_vertical_add/, 'view_column_2');

  function browse() {
    const bar = `<div class="fl-bar"><div class="crumbs"><span>src</span>${ic('chevron_right', 'sm')}<b>sender.ts</b></div><span class="grow"></span>${seg([['src', 'Source'], ['chg', 'Changes', null, '+30 -7']], ui.view === 'browse' && ui.showChanges ? 'chg' : 'src', 'src-chg')}${ui.showChanges ? diffToggle() : ''}<button class="btn" data-a="toast">${ic('send')}Send to agent</button>${ibtn('more_horiz', 'More')}</div>`;
    const body = ui.showChanges ? W2.diff() : code();
    return `<div class="fl-rail">${railTop('browse')}<div class="scroll"><div class="fgroup">${ic('expand_more', 'sm')}Changes<span class="n">5 files in 2 sessions</span></div>${changesGroups('browse')}<div class="fgroup" style="margin-top:var(--sp-3)">${ic('expand_more', 'sm')}Billing API<span class="n">${ic('call_split', 'sm')} feature/retry-backoff</span></div>${tree()}</div></div>
      <div class="fl-main">${bar}<div class="fl-body">${body}</div><div class="fl-status">${ic('terminal', 'sm')}<span>Run</span><span class="t-3">Problems 0</span><span class="grow"></span><span class="mono">UTF-8 · LF · TypeScript</span></div></div>`;
  }
  const W2 = { diff: () => (ui.mode === 'split' ? SC.diffSplit() : SC.diffInline()) };

  function review() {
    const n = Object.keys(ui.seen).length;
    const bar = `<div class="fl-bar"><div class="crumbs"><span>src</span>${ic('chevron_right', 'sm')}<b>${ui.cur.split('/').pop()}</b></div><span class="chip">${ui.cur === 'src/sender.ts' ? '+30 -7' : 'changed'}</span><span class="grow"></span><button class="btn btn-ghost" data-a="toast">${ic('chevron_left')}Previous ${kbd('P')}</button><button class="btn btn-ghost" data-a="toast">Next ${kbd('N')}${ic('chevron_right')}</button>${diffToggle()}</div>`;
    return `<div class="fl-rail">${railTop('review')}<div class="scroll"><div class="row" style="padding:var(--sp-1) var(--sp-2) var(--sp-2)"><span class="t-2 num">${n} of 5 viewed</span><span class="grow"></span><span class="meter" style="--v:${n * 20};width:64px"></span></div>${changesGroups('review')}</div></div>
      <div class="fl-main">${bar}<div class="fl-body">${W2.diff()}</div>
      <div class="commitbar"><div class="danger-zone"><button class="btn btn-danger-ghost" data-a="discard">${ic('delete')}Discard…</button></div><span class="t-2 num cnt" style="white-space:nowrap">5 files · <span style="color:var(--accent-ink)">+73</span> <span style="color:var(--st-error)">-11</span></span><input class="input grow" placeholder="Commit message" aria-label="Commit message" value="Retry webhook delivery with capped backoff"><button class="btn" data-a="toast">${ic('auto_awesome')}<span class="sug-l">Suggest</span></button><button class="btn btn-primary btn-lg" data-a="toast">Commit 5 files ${kbd('Ctrl Enter')}</button></div></div>`;
  }
  const RES = [['src/sender.ts', [[2, 'import { <mark>backoff</mark>, jitter } from \'./backoff\''], [11, 'await sleep(<mark>backoff</mark>(attempt) + jitter())']]], ['src/backoff.ts', [[1, 'export function <mark>backoff</mark>(attempt: number) {'], [6, '// <mark>backoff</mark> doubles each attempt, capped at 30s']]], ['tests/sender.test.ts', [[14, 'expect(<mark>backoff</mark>(3)).toBeLessThan(30_000)'], [22, 'it(\'waits with <mark>backoff</mark> between tries\', async () => {']]]];
  function searchView() {
    const inner = `<div class="top" style="padding:0 var(--sp-2) var(--sp-2)"><div class="input-wrap"><i class="icon">search</i><input class="input" aria-label="Search in files" value="${ui.q}"></div><div class="row"><button class="chip chip-accent" role="button" aria-label="Match case">Aa</button><button class="chip" role="button" aria-label="Whole word">ab</button><button class="chip" role="button" aria-label="Regular expression">.*</button><span class="grow"></span><span class="t-meta">6 results in 3 files</span></div></div>${RES.map((f) => `<div class="res-file">${ic('description', 'sm')}${f[0]}</div>${f[1].map((l, i) => `<div class="res-line" role="button" tabindex="0" ${f[0] === 'src/sender.ts' && i === 1 ? 'aria-current="true"' : ''}><span class="n">${l[0]}</span><span>${l[1]}</span></div>`).join('')}`).join('')}`;
    const pv = `<div class="code">${['<span class="k">const</span> MAX_ATTEMPTS = 5', '', '<span class="k">export async function</span> sendWebhook(payload: Payload) {', '  <span class="k">const</span> endpoint = resolveEndpoint(payload.tenant)', '  <span class="k">for</span> (<span class="k">let</span> attempt = 0; attempt &lt; MAX_ATTEMPTS; attempt++) {', '    <span class="k">const</span> ok = <span class="k">await</span> send(endpoint, payload)', '    <span class="k">if</span> (ok) <span class="k">return</span>', '    <span class="k">await</span> sleep(<mark>backoff</mark>(attempt) + jitter())', '  }', '  <span class="k">throw new</span> DeliveryError(payload.id)', '}'].map((l, i) => `<div class="${i === 7 ? 'hit' : ''}"><span class="n">${i + 4}</span><span>${l || '&nbsp;'}</span></div>`).join('')}</div>`;
    return `<div class="fl-rail"><div class="top">${seg([['browse', 'Files'], ['search', 'Search'], ['review', 'Review', null, 5]], 'search', 'files-view', 'tabs-lg')}</div><div class="scroll">${inner}</div></div><div class="fl-main"><div class="fl-bar"><div class="crumbs"><span>src</span>${ic('chevron_right', 'sm')}<b>sender.ts</b><span>:11</span></div><span class="grow"></span><button class="btn" data-a="toast">${ic('send')}Send to agent</button></div><div class="fl-body">${pv}</div></div>`;
  }
  const discardDialog = () => over(dialog('Discard 2 changes?', `<p style="margin:0 0 var(--sp-3)">These files go back to the last commit. This cannot be undone.</p><div class="card" style="background:var(--raised);border:0;padding:var(--sp-2) var(--sp-3)"><div class="rv-row" style="cursor:default">${bd('M')}<span class="nm">src/export/invoice.ts</span><span class="ds">+4 -1</span></div><div class="rv-row" style="cursor:default">${bd('M')}<span class="nm">tests/invoice-export.test.ts</span><span class="ds">+18 -3</span></div></div><p class="t-meta" style="margin:var(--sp-3) 0 0">From the session "Fix flaky invoice export test". Other sessions are not touched.</p>`, `<button class="btn btn-ghost" data-a="close">Cancel</button><button class="btn btn-danger" data-a="discard-go">Discard 2 files</button>`));

  SC.mount('f-files', () => {
    const body = ui.view === 'browse' ? browse() : ui.view === 'review' ? review() : searchView();
    const p = page('Files', 'Billing API · feature/retry-backoff · 5 files changed in 2 sessions', `<button class="btn" data-a="toast">${ic('terminal')}Run</button><button class="btn" data-a="toast">${ic('call_split')}feature/retry-backoff</button>`, '', body, 'split');
    return shell('Files', p, { compact: true, over: ui.confirm ? discardDialog() : '' });
  });
  const sync = () => { $$('[data-a="files-view"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.v === ui.view)); SC.render('f-files'); };
  const H = SC.hooks;
  H['files-view'] = (el) => { ui.view = el.dataset.v; ui.confirm = false; if (ui.view === 'review' && ui.cur === 'src/sender.ts') ui.mode = ui.mode; sync(); };
  H['diff-mode'] = (el) => { ui.mode = el.dataset.v; SC.render('f-files'); };
  H['src-chg'] = (el) => { ui.showChanges = el.dataset.v === 'chg'; SC.render('f-files'); };
  H['file-pick'] = (el) => { ui.cur = el.dataset.f.includes('/') ? el.dataset.f : 'src/' + el.dataset.f; SC.render('f-files'); };
  H['rv-pick'] = (el) => { ui.cur = el.dataset.f; SC.render('f-files'); };
  H['rv-seen'] = (el) => { const f = el.dataset.f; if (ui.seen[f]) delete ui.seen[f]; else ui.seen[f] = 1; SC.render('f-files'); };
  H['discard'] = () => { ui.confirm = true; SC.render('f-files'); };
  H['discard-go'] = (el, fr) => { ui.confirm = false; SC.render('f-files'); SC.toast(fr, 'Discarded 2 files. Undo is not available.'); };
  H.__filesClose = () => { ui.confirm = false; SC.render('f-files'); };
})();
