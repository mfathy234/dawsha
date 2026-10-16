# Orchestrator: design

Date: 2026-10-16 · Status: design approved, not started · Ships as: local build only, behind an experimental switch

## Goal

Turn a user story into reviewed, merged work using a team of agents that each run in a normal Dawsha pane.
A lead agent (Opus by default) plans and delegates; specialist agents (spec writer, implementer, UI, code
reviewer, UX reviewer, tester) do the work on models the user chooses, including free and local models.
Agents coordinate through an MCP server built into Dawsha ("orch server"). An Orchestrator tab shows the
run, and a Human review inbox collects every decision that needs the user.

## Decisions taken

| Question | Decision |
|---|---|
| Where it lives | Inside Dawsha, local build first, behind Settings → Experimental → Orchestrator |
| How agents run | Every agent is a visible pane running a CLI (Claude Code, Codex, Gemini, OpenCode) |
| Who drives | Dawsha's dispatcher opens panes and types nudges; the lead agent only creates tasks through MCP |
| Models | User-defined profiles and plans; Dawsha ships defaults |
| Mockups | Static HTML/CSS pages, one per screen or state |
| Human decisions | `ask_human` tool feeding a Human review tab with Dawsha's needs-you alerts |
| Concurrency | Several runs at once (any projects); one All runs overview with quick replies |
| Plans | Created and edited in Settings → Orchestrator; New run only picks one |
| Cost | Actual spend shown per agent and run; no estimates and no budget cap |
| History | Past runs searchable; export/import as `.dawsharun` files |
| Task boards | One kanban per project with the tasks of all its runs (plus manual tasks); an All projects view; filters and saved views |

Mockups: https://claude.ai/artifact/ADwGF2HY7VkJXfMKyAqVJU

Research behind these choices (Gas Town, mcp_agent_mail, vibe-kanban, Claude Code agent teams, claude-squad,
dmux, ccmanager): all practical systems use visible terminals + a shared coordination server + one git
worktree per writing agent. Typing whole tasks into a pane is unreliable, so panes get short nudges and the
task text stays in the server. Delegation only pays off on large tasks (~4k tokens overhead per handoff).

## 1. Architecture

| Piece | Where | Role |
|---|---|---|
| Orch server | Electron main process | MCP over localhost HTTP; SQLite store for runs, tasks, messages, notes, decisions, costs; one token per pane identifies the agent and its allowed tools |
| Profiles and plans | Settings → Orchestrator | Profile = role + runner + model + prompt + access + limits. Plan = a saved team (profile per role) |
| Runners | One adapter per CLI | Start the CLI with a model, attach the orch server, add the role prompt, detect turn end |
| Dispatcher | Electron main process | Opens panes (new worktree for writing roles), types nudges with verified submit, watches for stalls |
| Orchestrator tab | Renderer | Spec review, task board, agents, timeline, Human review, costs |

Run flow:
1. User pastes a story (or picks a Projects → Tasks entry) and a plan.
2. Spec writer writes `spec.md` + `mockups/*.html` into `.dawsha/runs/<id>/`.
3. User approves or requests changes in Spec review.
4. Lead creates tasks through the orch server.
5. Dispatcher opens worker panes; each worker fetches its task and works in its own worktree.
6. `complete_task` triggers a review task for a reviewer of a different vendor.
7. Approved work is merged by the lead into a run branch after tests pass; the user merges the run branch.

Several runs can be active at once, each with its own run branch, worktrees and panes. The worker limit
applies per run.

Out of scope for v1: remote/cloud agents, more than 5 parallel workers per run, auto-merge to `main`.

## 2. Orch server tools and task lifecycle

| Group | Tools | Roles |
|---|---|---|
| Identity | `whoami`, `list_agents` | all |
| Tasks | `create_task(title, spec, role, depends_on, acceptance)` | lead, spec writer |
| | `get_my_task`, `update_task(progress)`, `complete_task(summary, files, branch, tests)`, `block_task(reason)` | workers |
| Review | `request_review(task, reviewer_role)`, `submit_review(verdict, comments)` | lead, reviewers |
| Messages | `send_message(to, task, body)`, `fetch_inbox` | all |
| Notes | `put_note(key, text)`, `get_notes` | all |
| Files | `reserve_paths`, `release_paths` (advisory) | workers |
| Human | `ask_human(question, options, context, urgency)` | all |

Lifecycle: `todo → assigned → in_progress → done_pending_review → in_review → approved`.
Rejected review → back to `in_progress` with comments, at most 2 rounds, then escalated to the user.
Any state can go to `blocked` or `waiting_on_human`. Idle without `complete_task` → `stalled` (one nudge,
then a Human review card).

Human review tab:
- `ask_human` pauses only that task and creates a decision card: question, options, the agent's
  recommendation, context (file, diff or mockup), source agent and task.
- Alerts use the existing needs-you signals (amber border, taskbar flash, Windows notification) and
  Remote Control.
- The answer is stored as a note (so it is not asked twice) and the agent is nudged to continue.
- The tab also holds spec approval, double-rejected reviews, the final merge and stalled agents.

Safety: agents cannot answer `ask_human`; messages between agents never count as approvals and are shown to
agents as information, not instructions; CLI permission prompts stay in each pane.

## 3. Profiles, plans and runners

```yaml
name: UX reviewer (local)
role: ux-reviewer
runner: opencode
model: ollama/qwen3-coder
effort: none               # low | medium | high | max, mapped per runner; none when unsupported
prompt: roles/ux-reviewer.md
access: read-only          # read-only | worktree | full
limits: { max_review_rounds: 2, max_minutes: 30 }
```

| Role | Default plan | Budget plan |
|---|---|---|
| Spec writer | Sonnet | Gemini Flash (free tier) |
| Lead | Opus | Sonnet |
| Implementer | Sonnet / Codex | Codex |
| UI | Sonnet | Gemini Pro |
| Code reviewer | Codex (other vendor than implementer) | local Qwen |
| UX reviewer | Gemini Pro with screenshots | local Qwen |
| Tester | Haiku | local |

Models and effort can be swapped per run without editing the plan. A plan can override a profile's effort
per role (e.g. Lead = Opus on high, Tester = Gemini Flash on low).

Effort per runner (flags to confirm during build): Claude Code effort/thinking level; Codex
`model_reasoning_effort` (low/medium/high/xhigh); Gemini thinking budget mapped to low/medium/high;
local models usually unsupported and shown as such.

Stops for the user, set per plan: spec approval (on by default, can be turned off for an "Autopilot"
plan) and the final merge into `main` (always on).

| Runner | Models | Attach (exact flags to confirm during build) |
|---|---|---|
| Claude Code | Opus / Sonnet / Haiku | `--model`, `--mcp-config`, `--append-system-prompt`, Stop hook |
| Codex CLI | GPT models; local via `--oss` | `-m`, `-c mcp_servers.orch…`, notify hook |
| Gemini CLI | Pro / Flash | `--model`, `.gemini/settings.json` in the worktree |
| OpenCode | Ollama, OpenRouter free and others | `opencode.json` in the worktree |

Profile check on save: open the runner, ask it to call `whoami` and `get_my_task` on a dummy task, mark the
profile ready / unreliable at tool calls / cannot connect. Unreliable profiles may still serve review-only
roles with a fallback that reads their last reply.

Cost: tokens per pane; Claude priced, other models priced from user settings, local models $0; shown per
role and per run so plans can be compared.

## 4. Spec writer, mockups and dashboard

Spec writer reads the story plus project context (`CLAUDE.md`, existing UI, CSS variables) and writes:
- `spec.md`: goal, user flow, numbered testable acceptance criteria, edge cases, out of scope, open questions.
- `mockups/*.html`: one static page per screen/state (empty, loading, error, filled); no scripts, no network.
Unclear points become `ask_human` cards. Spec review shows both in a sandboxed preview with desktop/phone
widths and line/screen comments; Approve hands the spec to the lead, Request changes produces v2, v3…

Reuse later in the run: the UI implementer's task links its mockup; the UX reviewer compares screenshots of
the build with the mockup; the tester reports pass/fail per acceptance criterion.

Orchestrator tab:

| Area | Content |
|---|---|
| All runs | First screen: a card per active run (stage, progress, who is working or stuck), the latest question with a quick reply box, one-click actions for escalations, and a live timeline across runs |
| Project boards | One kanban per project holding the tasks of all its runs, each card tagged with its run; manual tasks can be added and turned into a run. "All projects" shows every board together. Filters: project, run, status, role, agent/model, needs-you, include finished runs, text search over titles, specs and decisions; filters can be saved as named views. A run's dashboard is the project board filtered to that run. Finished runs' tasks stay in Projects → Tasks with goal, notes and commits |
| Run switcher | Bar above a run's dashboard to jump between active runs |
| Run header | Story, plan, stage (Spec → Plan → Build → Review → Merge), elapsed, cost spent |
| Task board | To do · In progress · Review · Needs you · Done; agent + model badge, review round, dependencies |
| Agents | Role, runner + model, status (working / idle / waiting / stalled), task, tokens, cost; click to focus pane |
| Timeline | Messages, notes, reviews, decisions; filter by task |
| Human review | Decision cards and approvals from all runs, run filter, count badge |
| History | Past runs (finished, cancelled, imported) with search and filters; open a run read-only; start a new run from its spec |

Export and import: one `.dawsharun` file per run, a zip with `run.json` (tasks, reviews, decisions,
messages, notes, timeline, plan, runners, models, tokens, cost, commit links), the spec versions and the
mockups; agent transcripts optional. A Markdown report export is also offered. Imported runs are read-only
in History.

Settings → Orchestrator: create, duplicate, import and edit plans; change the profile per role; add or
remove roles; choose the preselected plan; manage profiles and run their check.

## 5. Errors, limits, testing, build

| Failure | Handling |
|---|---|
| Idle without reporting | `stalled`: one nudge, then a card (retry, reassign, take over the pane) |
| Pane or CLI exits | Task back to To do with a log, one retry, then a card |
| Nudge not submitted | Verified submit retries 3 times, then a card; never types while the agent is busy |
| Review rejected twice | Escalated to the user |
| Overlapping files | Lead adds a dependency; leases only warn; merge conflicts go to the lead, then the user |
| Model cannot use tools | Caught by the profile check; read-last-reply fallback for review-only roles |
| Dawsha closes mid-run | SQLite + run files persist; the run resumes and panes resume their sessions |

Per-run limits (editable): parallel workers (default 3, max 5), a per-task time limit, review rounds,
and a size threshold below which the lead does the task itself. No budget cap or cost estimates.

Testing:
- Unit: task state machine, role permissions, verified submit against a fake terminal, runner adapters, cost math.
- Integration: orch server driven by a scripted MCP client through a full run.
- E2E: Playwright on the Orchestrator tab with a fake runner (a script that acts as an agent), no model tokens.
- Manual: one real run on the Budget plan against a small demo project.

Build: branch `feature/orchestrator`, everything behind the experimental switch, installed as a local build
only until the user signs off.
