# Orchestrator design polish (apple-design review follow-up)

Branch `feature/orch-design`. Scope is the Orchestrator view only: `src/renderer/orchestrator.css`,
`src/renderer/components/orch/*.css` and, where markup must change, `src/renderer/components/orch/*.ts`.
The one exception is the toast stack (item 6), which lives in shared renderer code.

Look at the current screens first: run
`npx playwright test tests/e2e/orchestratorUi.spec.ts tests/e2e/orchestratorSpec.spec.ts tests/e2e/orchestratorHistory.spec.ts`
and open `test-results/screens/orch-*.png`. Copy them to `test-results/screens-before/` before you change anything.

The main complaint: **the pages feel cramped.** Text is small (10–12px), panels have tight padding, and
everything is packed edge to edge.

## Build

1. **Spacing scale.** Add spacing tokens on `.orch-view` (`--orch-space-1: 4px` … 8, 12, 16, 24, 32) and use them
   instead of ad-hoc values. Panel padding 20px, gap between stacked sections 16–24px, table rows at least 40px
   tall with 12px cell padding, kanban cards 12px padding with 8px between cards.
2. **Readable widths.** Text-heavy pages (Human review, History, Spec review, New run, the empty state) get a
   centered content column with `max-width: 1200px`, so lines do not run across a wide window.
3. **Type.** Nothing below 12px. Body and table text 13px, uppercase section labels 11px with their current
   positive tracking. Headings: page title 20px, panel headings 15px, with line-height ~1.25 and
   `letter-spacing: -0.01em` for 18px and up; body line-height 1.5. Build hierarchy from weight and size together.
4. **Run dashboard.**
   - Timeline timestamps must not wrap ("05:22 PM" on one line): fixed time column, `white-space: nowrap`.
   - The model chip on a task card must not truncate to "Fixer · o…"; let chips wrap onto their own line.
   - Give the right column (Agents, Usage, Timeline) enough width that its tables do not squeeze; below
     ~1100px stack it under the task board.
   - The Story section is a collapsed `<details>` that looks like an empty bar. Add a rotating chevron and a
     one-line, ellipsized preview of the story while collapsed; hide the section entirely when there is no story.
5. **History.** The search box shows its full placeholder; the Actions column buttons stay on one line.
6. **Toasts.** Show at most 3 at once (drop the oldest) and auto-dismiss info toasts after about 4 seconds.
   Check how `toast()` works today first; keep error toasts until they time out as they do now if they already have
   a longer timeout.
7. **Calm motion.** When switching orchestrator tabs, cross-fade the new page in (opacity only, 120ms, ease-out),
   only inside `@media (prefers-reduced-motion: no-preference)`. No slides, no bounce.
8. Keep what commit 707959c added: press feedback on `:active`, the `prefers-contrast: more` rules, and the spec
   review back link.

## Rules

- Use the existing theme variables (`--bg`, `--raised`, `--border`, `--text`, `--muted`, `--accent`, ...). No new colors,
  no new dependencies. Both dark and the light theme (`dawsha-daylight`) must look right.
- Do not rename element ids, roles, aria labels or visible button text that tests use. If a test needs a change,
  explain why in the commit message.
- Small Conventional Commits on `feature/orch-design`, no AI attribution trailers. Do not push. Do not touch other
  worktrees.

## Verify

1. `npm run typecheck` is clean.
2. `npx vitest run` passes.
3. `npm run build` succeeds.
4. The three orchestrator e2e specs above pass, and fresh screenshots are in `test-results/screens/`.
5. Finish with a report: each item above done or not, the commits, the test numbers, and a one-line before/after
   note per screenshot.
