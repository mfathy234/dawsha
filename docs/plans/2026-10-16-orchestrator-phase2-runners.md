# Orchestrator Phase 2: Runners, Dispatcher and Panes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Real agents in real Dawsha panes. Starting a run opens the right CLI, model and effort per role in its own
worktree, connected to the orch server; new work and answers are nudged into the pane; quota and stalls are detected;
usage is collected per agent; profiles, plans and prices live in settings.

**Architecture:** Pure logic in `src/shared/orch/` (profiles, role prompts, launch builder, quota detector, usage
parsers). Main-process pieces in `src/main/orch/`: worktrees, dispatcher (reacts to service changes), pane bridge
(asks the renderer to open a pane for an agent id; the main process adds launch args and the token env, so the token
never reaches the renderer), nudger (verified submit through `PtyManager.write`), watcher (quota/stall from pane
output), usage collector, profile check. Renderer: `openOrchPane` + `orchAgentId` on spawn requests.

**Facts from the survey and CLI help (2026-10-16):**
- Panes are renderer state; `startSession`/`launch` in `src/renderer/actions.ts`; `SpawnRequest` → `IPC.ptySpawn` →
  `launchSpec` (`src/main/agentLaunch.ts`). Initial prompts go as CLI args (`promptArgs`, `src/shared/compare.ts`).
- Claude: `--model`, `--effort low|medium|high|xhigh|max`, `--mcp-config <file or JSON string>`,
  `--append-system-prompt`, `--allowedTools`, `--session-id`.
- Codex: `-m`, `-c model_reasoning_effort=…` (low…xhigh), `--oss --local-provider ollama` for local models,
  `-c mcp_servers.<n>.url/bearer_token_env_var/default_tools_approval_mode="approve"`, `-c developer_instructions=…`.
- Gemini: `-m`, `--approval-mode`, `-i` initial prompt, MCP servers from settings (`GEMINI_CLI_SYSTEM_SETTINGS_PATH`),
  no effort flag.
- Worktree helpers in `src/main/compare.ts` (guarded to `compare/*` branches). Usage parsers in `src/shared/usage.ts`
  (total tokens only). No quota detection exists.

## Tasks

1. **Profiles, plans, prices in settings** — `src/shared/orch/profiles.ts`: `OrchProfile` (role, runner, model,
   effort, local, access, prompt override), `OrchPlan` (role → profile id, spec approval stop, max workers, per-task
   minutes), `OrchSettings` (profiles, plans, default plan, fixer default = plan lead, prices keyed `runner:model`);
   built-in defaults (Default, Budget); `sanitizeOrchSettings`; `Settings.orchestrator`; transfer includes it.
2. **Role prompts** — `src/shared/orch/rolePrompts.ts`: per-role duties + `firstMessage(role, run, task?)` telling
   the agent how to use the orch tools, to stay in its worktree, and never to merge into main.
3. **Launch builder** — `src/shared/orch/launch.ts`: `buildLaunch(profile, { mcpUrl, fullAccess, sessionId })` →
   `{ agent, args, env keys, files }` per runner, effort mapped per runner (Codex max → xhigh, Gemini none).
4. **Orchestrator worktrees** — `src/main/orch/worktrees.ts`: run branch `orch/<run>`; task worktree
   `<parent>/<repo>-orch-<run>-<task>` on `orch/<run>/<task>` from the run branch; guarded removal; tests on a
   temp git repo.
5. **Service change hook** — `OrchService.onChange(listener)` fired after each committed transaction.
6. **Pane bridge** — `IPC.orchOpenPane` main→renderer, renderer `openOrchPane` (pane folder = worktree, tab agent =
   runner, initial prompt, title "Role · model"), `SpawnRequest.orchAgentId`; main merges launch args/env from the
   dispatcher's registry in the spawn handler; pane close/exit reported back.
7. **Dispatcher** — `src/main/orch/dispatcher.ts`: after each change, for ready tasks whose role has no live agent
   (and under max workers): register an agent from the plan profile, make a worktree for writing roles, open a pane.
   Bug runs: one fixer with the chosen profile. Tested with a fake pane opener.
8. **Nudger** — `src/main/orch/nudge.ts`: when an agent has unread messages or a task becomes ready for it, type a
   short nudge with verified submit (bracketed paste, Enter after a pause, retry while output stays silent, max 3).
9. **Watcher** — `src/shared/orch/quota.ts` limit-message detector per CLI + `src/main/orch/watcher.ts`: on a match
   mark the task stalled (quota) and raise a "Continue with another model" decision; on long silence with an
   in-progress task, nudge once then stall.
10. **Usage collector** — split token parsers (input, output, cache read/write) for Claude/Codex/Gemini transcripts
    matched by session id (Claude/Gemini `--session-id`) or worktree cwd (Codex); Claude cost from the statusline;
    `reportUsage` every 30 s for live agents.
11. **Profile check** — headless run (`claude -p`, `codex exec`, `gemini -p`) against a throwaway run: ready /
    unreliable at tool calls / cannot connect.
12. **Start commands** — command palette "Orchestrator: fix a bug…" / "Orchestrator: build a feature…" for the
    focused project, and the experimental switch in Settings starting/stopping the runtime live.
13. **Verify** — unit tests, typecheck, build, and a real bug run on a scratch repo with Claude, then with Codex.
