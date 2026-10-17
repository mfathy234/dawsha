# Run stages as a progress track

Branch `feature/orch-design` (continue on top of the design-polish commits already there).

The run dashboard header shows the run's stages (Build, Merge, Done; a feature run has more) from
`OrchRunView.stages()` in `src/renderer/components/orch/runView.ts`, styled by `.orch-stages` / `.orch-stage` in
`src/renderer/components/orch/runView.css`. Today each stage is a bordered pill with a number in a circle. They
look like buttons, but they are not clickable, and the user finds them ugly. Look at
`test-results/screens/orch-run-dashboard.png` first.

## Build

Redesign the stages as a quiet, horizontal progress track that clearly reads as status, not as controls:

- No border or pill around each stage. Each stage is a small 10px dot with its label beside or under it,
  joined to the next stage by a 2px connector line.
- Done stages: filled accent dot (a small check mark inside is fine) and an accent connector after them.
- Current stage: accent ring dot, label in `--text` and weight 600.
- Upcoming stages: `--border` colored dot and connector, label in `--muted`.
- Cancelled: the track turns muted and a short "Cancelled" label in `--danger` follows it, with no pill.
- Labels 12–13px. Default cursor everywhere; no hover effect, since nothing here is clickable.
- Keep the `<ol>` / `<li>` markup, `aria-label="Stages"` and `aria-current="step"` on the current stage. Add visually
  hidden text such as "(done)" / "(current)" so screen readers get each stage's state.
- The track must fit in the run header on one line for both the bug flow (3 stages) and the feature flow; let it
  wrap cleanly on narrow widths. It must look right in the dark theme and in `dawsha-daylight`.
- Keep the 707959c additions and the design-polish work intact.

## Rules

Theme variables only, no new dependencies. Do not change ids, roles or visible text used by tests. Small
Conventional Commits without AI attribution trailers. Do not push. Do not touch other worktrees.

## Verify

`npm run typecheck`, `npx vitest run`, `npm run build`, and
`npx playwright test tests/e2e/orchestratorUi.spec.ts tests/e2e/orchestratorSpec.spec.ts tests/e2e/orchestratorHistory.spec.ts`
all pass, with a fresh `test-results/screens/orch-run-dashboard.png`. Finish with a short report: what changed,
commits, and test results.
