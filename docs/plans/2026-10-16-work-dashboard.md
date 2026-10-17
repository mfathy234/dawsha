# Work dashboard

Branch `feature/work-dashboard` (based on `feature/orchestrator`). The user wants to track their own work: how many
items they worked on today, this week and this month, in total and per project, and of what type: **Feature**,
**Bug** or **Conversation**.

## Decisions already made by the user

- **One item = one agent session** (Claude Code, Codex or Gemini) in a Dawsha project, plus **one item per
  orchestrator run**. Agent sessions that belong to an orchestrator run are part of that run, not separate items.
- The type comes from what happened, not from the user tagging it.
- It is **its own view with a button in the top bar** (like the Orchestrator button), not a tab inside Usage.

## Data that already exists

Read these first and reuse them; do not write a second transcript scanner if one exists:

- `src/main/sessionIndex.ts`, `src/main/projectSessions.ts`, `src/main/sessionsWatcher.ts`: the sessions Dawsha
  knows per project (Claude, Codex, Gemini) with their ids, titles and times.
- `src/main/usage.ts` (`scanUsage`, `UsageService`) and `src/renderer/components/usageView.ts` / `usageChart.ts`:
  the existing Usage view and its chart; reuse the chart component and the view's layout patterns.
- Claude Code transcripts record the git branch on their messages (`gitBranch`); check what Codex rollouts and
  Gemini chats record. `src/main/git.ts` and `src/shared/gitBranches.ts` have git helpers.
- Orchestrator runs: `state.orch.runs` in the renderer (kind `feature` or `bug`, stage, project, title, times).

## Classification (pure function in `src/shared/`, fully unit tested)

For a session, from its branch and the commits made in its project while it ran (`git log` between its first and
last activity, all authors on that branch; keep it cheap and cached):

1. Branch or commits say bug: branch `fix/`, `bugfix/`, `hotfix/`, `bug/`, or a commit starting `fix:` / `fix(`
   gives **Bug**.
2. Branch `feature/`, `feat/`, or a commit starting `feat:` / `feat(` gives **Feature**.
3. Otherwise, if it made commits (refactor, chore, docs, test, ...), **Other change**: shown as its own small type,
   so the three main ones stay honest.
4. No commits and no feature or fix branch gives **Conversation**.

Orchestrator runs are typed by their kind (`feature` gives Feature, `bug` gives Bug).
A ticket number is shown when the branch has one (`fix/18550`, `feature/26412-service-stock` gives `#18550`,
`#26412`). Ties: bug wins over feature when both appear.

## The view

- Period switch: **Today**, **This week** (Monday start), **This month**; the counts follow it.
- Top: one tile per type with its count (Feature, Bug, Other change, Conversation) and the total.
- A stacked bar chart per day for the week or month (types as segments), reusing the Usage chart.
- **Per project** table: project, then one count column per type, total, and time spent (first to last activity of
  its items, summed); sorted by total. Clicking a project filters the list below.
- **Items** list: title, project, type chip, ticket number, branch, agent (Claude, Codex, Gemini or Orchestrator),
  when, and duration. Clicking an item resumes the session (reuse the existing resume action used by the sidebar's
  closed sessions) or opens the orchestrator run.
- Empty state for a period with no work. Works with many projects; nothing blocks the UI while it loads.
- Match Dawsha's existing look: theme variables only, dark and `dawsha-daylight`, Dawsha's own dropdowns
  (`src/renderer/components/selectMenu.ts`) for any select, no new dependencies.

## Rules

- Main process collects and caches, and the renderer only renders a snapshot from one IPC call (follow how Usage
  does it). Do not block startup.
- Small Conventional Commits on `feature/work-dashboard`, no AI attribution trailers. Do not push. Do not touch
  other worktrees.
- Tests: **run only the tests for what you change** (the user asked for this; the full suites are slow). Unit-test
  the classifier and the period and aggregation logic thoroughly. Add one e2e spec for the view. e2e windows open
  off-screen by default (`DAWSHA_OFFSCREEN`); `out/` is already built in this worktree, and rebuild with
  `npm run build` after changes.

## Verify

1. `npm run typecheck` clean, `npm run build` succeeds.
2. Your new unit tests and `npx playwright test <your new e2e spec>` pass, plus any existing spec you touched.
3. Screenshots of the view (dark and light, today and this week) saved to
   `C:/Users/tuy_2/Desktop/work-dashboard-shots/`.
4. Finish with a short report: what you built, the commits, test results and the screenshot paths.
