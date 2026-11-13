# Mini window implementation plan

**Goal:** Watch and answer every open session from a small always-on-top window, following the supplied Mini mockup.

**Architecture:** The main renderer shapes a compact text-only snapshot from existing pane derivation, permission parsing, session notes and chat plans. Main authenticates both IPC senders and routes a fixed set of actions. A sandboxed second renderer has its own minimal preload. Settings remain durable in the existing settings store.

**Constraints and risks:** Preserve confirmations and single-instance startup. Never send terminal input from Mini. Keep bounds reachable after display changes, preserve folded state on quick quit, and keep automated windows off-screen. Shared integration edits stay small. Theme tokens are copied from the main renderer's computed theme so tone and future theme changes stay synchronized.

- [x] Add failing unit tests for shaping, stable urgency order, snapshot diff/throttle, action validation and display bounds.
- [x] Implement shared Mini types and pure logic, then run the focused tests.
- [x] Add failing end-to-end coverage for opening, session state, approvals, focus, fold persistence and window lifecycle.
- [x] Implement the main window/tray controller, restricted preload, snapshot publisher and Mini list/detail/fold UI.
- [x] Add the View command, non-colliding Ctrl+Alt+M binding and Notifications setting.
- [x] Build and run Mini plus affected end-to-end tests at 1024×728, then restore the production window dimensions.
- [x] Run unit tests and review the final diff and security boundary.

## Implementation notes

Mini uses the main renderer's live permission tail, even when the focused pane's sidebar attention has been acknowledged. Approval actions carry the displayed prompt and are refused if it changed before the main renderer executes the existing `answerPermission` action. Keyboard focus stays with the same pane and action; disappearing controls fall back to the header.

Plans reuse the existing Claude/Codex transcript parsers and `latestTodos`. A visible Mini window owns incremental readers for its open sessions, queries them once per second, and releases them on hide/quit. These readers do not evict Chat's eight-reader cache. Snapshots are text-only, diffed and limited to four sends per second. Mini copies the main renderer's computed CSS variables, including tone overrides.

## Files touched

- Shared model: `src/shared/miniWindow.ts`, `src/shared/api.ts`.
- Native lifecycle and plans: `src/main/miniWindow.ts`, `src/main/miniPlans.ts`, `src/main/index.ts`.
- Preloads and build entries: `src/preload/mini.ts`, `src/preload/index.ts`, `electron.vite.config.ts`.
- Renderer: `src/renderer/mini.html`, `src/renderer/mini/main.ts`, `src/renderer/mini/mini.css`, `src/renderer/miniWindowSync.ts`, `src/renderer/main.ts`.
- Small integrations: `src/renderer/components/viewMenu.ts`, `src/renderer/commands/builtin.ts`, `src/renderer/components/settingsView.ts`.
- Tests: `tests/unit/miniWindow.test.ts`, `tests/unit/miniPlans.test.ts`, `tests/e2e/miniWindow.spec.ts`.
- Handoff: this document.

## Verification

- `npm run build`: passed with production dimensions restored to 1440×900.
- Mini unit tests: 12 passed, including stable ordering, diff/throttle, prompt shaping, bounds, and incremental updates across 12 logs.
- Mini end-to-end tests: 5 passed. They cover host-only approval writes, stale-prompt refusal, View/palette/shortcut opening, native close hiding, selected-pane focus, detail plans while minimized, focus safety, empty state, restart persistence, theme tokens, 12-session scrolling, and folding.
- Windows 1024×728 check: Mini tests passed with temporary main-window dimensions; dimensions were reverted before delivery. No screenshots were taken.
- Existing affected tests: 6 selected tests passed from settings, sidebarRevamp, notifications and palette; the Board spec also passed. Tests with screenshot calls were excluded.
- Development smoke: passed with an isolated off-screen profile; Mini opens through the development server, receives snapshots and folds with its own restricted preload.
- Full unit run: 3169 passed, 4 skipped, 2 failed. The unchanged base `settingsTransfer` coverage test omits the new base `appearance` and `miniWindow` keys. `codeNavProcesses` timed out under the broad run but both of its tests passed alone. An earlier broad run also hit the documented local `codeNavPackaged` timeout.
- Code, TypeScript and security reviews completed; findings were addressed.

## Reviewer notes

The requested Mini mockup states are implemented. Native tray behavior on macOS/Linux and manual multi-monitor dragging still need checks on those systems; automated bounds tests cover removed/off-screen displays. The base settings-export failure is outside this worker's changes and remains for the release lead.
