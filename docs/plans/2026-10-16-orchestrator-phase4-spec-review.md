# Orchestrator Phase 4: Spec Review (brief for the implementing agent)

You are working in the git worktree `C:\Users\tuy_2\Desktop\Work\dawsha-wt-orch-p4` on branch
`feature/orch-spec-review`. Dawsha is an Electron + TypeScript desktop app (main process `src/main`, vanilla TS
renderer with an `h()` helper in `src/renderer`, pure logic in `src/shared`, vitest unit tests in `tests/unit`,
Playwright e2e in `tests/e2e`). Another agent works on phase 5 (History) in a sibling worktree at the same time:
stay inside this worktree and keep changes to shared files small and additive.

## Read first
- `docs/plans/2026-10-16-orchestrator-design.md` (section 4: spec writer, mockups, Spec review).
- `docs/plans/2026-10-16-orchestrator-mockups.html`, tab "3 · Spec review" (visual target).
- Orchestrator code: `src/main/orch/*` (runtime.ts, service.ts, tools.ts, worktrees.ts, snapshot.ts, switch.ts,
  dispatcher.ts), `src/shared/orch/*` (api.ts, types.ts, rolePrompts.ts), renderer
  `src/renderer/components/orch/*` (orchestratorView.ts, reviewView.ts, runView.ts, orchUi.ts),
  `src/renderer/orchActions.ts`, `src/renderer/state.ts`, `src/shared/markdown.ts` (existing Markdown renderer;
  check how other views render Markdown safely).

## Background
A feature run starts with a spec-writer agent. Its first message (src/shared/orch/rolePrompts.ts) tells it to
write `.dawsha/runs/<runId>/spec.md` and one static HTML mockup per screen/state in
`.dawsha/runs/<runId>/mockups/*.html` inside its working folder, which is the run worktree (on the run branch,
see `runWorktree` in `src/main/orch/worktrees.ts`). When it calls `complete_task`, the service raises a
`spec-approval` decision; the human answers "Approve" or any other text = requested changes (handled in
`src/main/orch/answers.ts`). Today that decision is only a plain card in Human review.

## Build
1. **Spec writer commits its files.** Update the spec-writer duty in `src/shared/orch/rolePrompts.ts` so it commits
   spec.md and the mockups on its branch before `complete_task` (update its unit test).
2. **Spec versions (main process).** When a `spec-approval` decision appears for a run, snapshot the current
   `spec.md` and `mockups/*.html` from the run worktree into
   `<userData>/orchestrator/specs/<runId>/v<n>/` (n = 1, 2, … per run), so earlier versions stay readable after
   the agent revises them. Put file logic in a new `src/main/orch/specs.ts` (pure helpers testable with a temp
   dir: `snapshotSpec(runFolder, specsRoot, runId)`, `listSpecVersions(...)`, `readSpecVersion(...)`). Hook it in
   `runtime.ts` (the runtime already hears every change through `service.onChange`; detect new spec-approval
   decisions there). Validate names: only `spec.md` and `*.html` directly in `mockups/`, size limits (spec
   ≤ 512 KB, each mockup ≤ 1 MB, ≤ 30 mockups); never follow symlinks outside the run folder.
3. **IPC + API.** Add `orchSpec(runId): Promise<OrchSpecView | null>` returning
   `{ runId, versions: [{ version, createdAt, decisionId, answer }], current: { version, spec: string,
   mockups: { name: string; html: string }[] } }` and `orchSpecVersion(runId, version)`. Follow the existing
   pattern in `src/shared/ipc.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/orch/switch.ts`
   (validate every IPC argument there).
4. **Spec review screen (renderer).** New `src/renderer/components/orch/specView.ts` (+ `specView.css`), shown by
   the Orchestrator view for `state.orchTab === 'spec'` with `state.orchRunId` set (add `'spec'` to `OrchTab`
   in `state.ts` and route it in `orchestratorView.ts`; do not add it to the visible tab strip).
   - Left: `spec.md` rendered as Markdown using the existing safe renderer, with a version picker (v1, v2 …;
     current marked) and the decision's question.
   - Right: mockup picker (one chip per file) and a preview in an `<iframe srcdoc>` with
     `sandbox=""` (no scripts, no same-origin) and a Desktop / Phone width toggle (e.g. 1280 / 390 px, scaled to
     fit).
   - Comments: the user can add comments tied to "Spec" or to a mockup name (a small form: target select +
     text), listed below with remove buttons; kept per run in the component while the user works.
   - Actions: **Approve spec & mockups** → `answerDecision(decisionId, 'Approve')`; **Request changes** →
     answer with the comments formatted as a Markdown list ("- [spec] …", "- [mockup export-dialog.html] …"),
     requires at least one comment or a note. After answering, go back to the run dashboard.
   - Empty state when the spec writer has not finished yet.
5. **Entry points.** In `reviewView.ts`, a `spec-approval` card gets a primary "Review spec & mockups" button
   opening the Spec review screen; the run dashboard (`runView.ts`) shows "Review spec" when the run has an open
   spec-approval decision and a "Spec" link afterwards (read-only, latest version).
6. **Tests.** Unit tests for `specs.ts` (temp dirs: snapshot numbering, size/name limits, symlink refusal, reading
   versions) and for the comment formatting helper (put pure helpers in `src/shared/orch/specReview.ts`). Extend
   `tests/e2e/orchestratorUi.spec.ts` or add `tests/e2e/orchestratorSpec.spec.ts`: seed a feature run whose spec
   task is completed with files present (you may write the files into the run worktree and drive the service via
   the fake agent in `tests/support/fakeOrchAgent.cjs`, or extend that fake for the spec-writer role), open
   Spec review, check the Markdown and an iframe mockup render, add a comment, Request changes, and check the
   decision was answered. Save a screenshot to `test-results/screens/orch-spec-review.png`.

## Rules
- TDD: write the unit tests first, see them fail, implement, see them pass.
- Keep files under ~400 lines; immutable updates; handle errors with user-facing messages (toast) in the UI and
  logged detail in main; no secrets; no `innerHTML` with agent content except through the existing sanitising
  Markdown renderer; mockups only inside the sandboxed iframe.
- Styles: only theme tokens from `src/renderer/styles.css` (`--bg --surface --raised --border --text --muted
  --accent --busy --danger --radius --font-mono`) and the shared classes in `src/renderer/orchestrator.css`;
  must work in light and dark themes and at narrow widths; visible focus; `<button type="button">`; labels.
- Commit your work on this branch in small Conventional Commits (`feat(orch): …`, `test(orch): …`), without
  AI attribution trailers. Do not push. Do not touch other worktrees or `main`.

## Verify before you finish
Run in this worktree and make all pass: `npm run typecheck`, `npm run test:unit`, `npx electron-vite build`,
`npx playwright test tests/e2e/orchestrator*.spec.ts`. Report what you built, the commits, test results and
anything left undone.
