# Orchestrator Phase 5: History, export and import (brief for the implementing agent)

You are working in the git worktree `C:\Users\tuy_2\Desktop\Work\dawsha-wt-orch-p5` on branch
`feature/orch-history`. Dawsha is an Electron + TypeScript desktop app (main process `src/main`, vanilla TS
renderer with an `h()` helper in `src/renderer`, pure logic in `src/shared`, vitest unit tests in `tests/unit`,
Playwright e2e in `tests/e2e`). Another agent works on phase 4 (Spec review) in a sibling worktree at the same
time: stay inside this worktree and keep changes to shared files small and additive.

## Read first
- `docs/plans/2026-10-16-orchestrator-design.md` (History, export/import, `.dawsharun`).
- `docs/plans/2026-10-16-orchestrator-mockups.html`, tab "7 · History" (visual target).
- Orchestrator code: `src/main/orch/*` (store.ts, service.ts, runtime.ts, snapshot.ts, switch.ts, dispatcher.ts),
  `src/shared/orch/*` (api.ts, types.ts, board.ts, usage.ts), renderer `src/renderer/components/orch/*`
  (orchestratorView.ts, runView.ts, boardsView.ts, orchUi.ts), `src/renderer/orchActions.ts`,
  `src/renderer/state.ts`. For save/open dialogs see how `src/main/transcriptExport.ts` and
  `src/main/settingsTransfer.ts` use Electron's `dialog`.

## Build
1. **Export format (`src/shared/orch/runArchive.ts`, pure).** A `.dawsharun` file is gzip-compressed JSON:
   `{ format: 'dawsharun', version: 1, exportedAt, app: { version }, run, tasks, agents, decisions, notes,
   events, messages }`. Agents are exported without `token` and without `launch` (no secrets, no local paths in
   env). Include the usage per agent (it lives on the agent record). Provide `buildArchive(...)`,
   `parseArchive(text): { ok: true; archive } | { ok: false; error }` with strict validation (every field typed,
   string lengths bounded, arrays bounded, unknown format/version rejected with a clear message), and
   `archiveToMarkdown(archive)` for a readable report (story, outcome, tasks with status and summary, decisions
   with answers, usage table per agent, timeline).
2. **Store/service (main).** `OrchService.exportRun(runId)` gathers everything (add store reads you need, e.g.
   `listDecisions` exists, add `listMessages`/notes reads if missing). `OrchService.importRun(archive)` inserts the
   run read-only: new run id if the id already exists, `stage` kept as in the archive but runs that were not
   finished become `cancelled`, and mark it with `imported: { at, from: string }` (add the optional field to
   `OrchRun` in `src/shared/orch/types.ts`). Imported agents are inserted retired (no working token). Everything
   in one transaction. The dispatcher must ignore imported runs (check it never opens panes or merges for them).
3. **Files (main).** `src/main/orch/archiveFiles.ts`: export to a path chosen with a save dialog (default name
   `<project>-<run title slug>-<date>.dawsharun`; also offer `.md` for the Markdown report), import from an open
   dialog (`.dawsharun`, max 20 MB, gunzip, parse, import). IPC: `orchExportRun(runId, format: 'dawsharun' |
   'markdown')`, `orchImportRuns()` (multi-select) returning per-file results. Follow the IPC pattern in
   `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/orch/switch.ts` (validate every
   IPC argument there).
4. **History screen (renderer).** New `src/renderer/components/orch/historyView.ts` (+ `historyView.css`) as a
   new "History" tab in the Orchestrator view (add `'history'` to `OrchTab` in `state.ts`, add the tab to `TABS`
   in `orchestratorView.ts` between "Human review" and "New run", route it). It lists finished, cancelled and
   imported runs (from `state.orch.runs`; extend the snapshot with an `imported` flag), newest first: checkbox,
   story title + branch/result line, project, plan, result pill (merged/done, cancelled, imported), task count,
   decisions count, cost (from usage total), finished date, and Open (opens the read-only run dashboard
   `showOrch('runs', runId)`). Toolbar: search (title, story, task titles, decisions), filters by project and
   result, "Import runs…", "Export selected (n)" (exports each selected run to its own file; ask for a folder
   once if several), and per-run "Export as Markdown". A side panel for the selected run explains what is kept
   (as in the mockup). Empty state when there is no history.
5. **Read-only dashboard.** In `runView.ts`, imported or finished runs show an "Imported from …"/"Finished" note,
   no Cancel button and no "Continue with…". Keep the change minimal.
6. **Tests.** Unit tests first for `runArchive.ts` (round trip build→gzip-free JSON→parse, rejects bad
   format/version/oversized/malformed input, no token or launch in output, Markdown report contents) and for
   `exportRun`/`importRun` in the service (`:memory:` store; id collision; unfinished becomes cancelled; agents
   retired; dispatcher ignores imported runs — see `tests/unit/orchDispatcher.test.ts` for the fake setup).
   E2E: add `tests/e2e/orchestratorHistory.spec.ts`: finish a bug run with the fake agent
   (`tests/support/fakeOrchAgent.cjs`, see `tests/e2e/orchestratorUi.spec.ts`), see it in History, export it
   (stub the save dialog the same way other e2e tests stub dialogs — check `tests/e2e/*` for
   `DAWSHA_*` dialog overrides or add a test hook env var such as `DAWSHA_SAVE_PATH`/`DAWSHA_OPEN_PATHS` read in
   `archiveFiles.ts`), import the file again and see it listed as imported. Save a screenshot to
   `test-results/screens/orch-history.png`.

## Rules
- TDD: write the unit tests first, see them fail, implement, see them pass.
- Keep files under ~400 lines; immutable updates; validate all external input (archives are untrusted files);
  user-facing error messages in the UI (toast), detailed logs in main; never write outside the chosen path.
- Styles: only theme tokens from `src/renderer/styles.css` (`--bg --surface --raised --border --text --muted
  --accent --busy --danger --radius --font-mono`) and the shared classes in `src/renderer/orchestrator.css`;
  light and dark themes; narrow widths; visible focus; `<button type="button">`; labels for inputs.
- Commit your work on this branch in small Conventional Commits (`feat(orch): …`, `test(orch): …`), without
  AI attribution trailers. Do not push. Do not touch other worktrees or `main`.

## Verify before you finish
Run in this worktree and make all pass: `npm run typecheck`, `npm run test:unit`, `npx electron-vite build`,
`npx playwright test tests/e2e/orchestrator*.spec.ts`. Report what you built, the commits, test results and
anything left undone.
