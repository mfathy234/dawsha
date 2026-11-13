# Dawsha 1.8.7 platform handoff

## Behavior

- Settings import reuses the existing typed preload call and main-process open dialog. The picker opens on Desktop with a JSON filter; cancellation stays quiet. Validation, merge preview and replace confirmation remain in place. Appearance now round-trips with a useful preview label; the panel layout is accepted. Mini window state and recent project IDs stay local to this PC.
- Quit closes CLI clients before their pipe server, closes Remote Control HTTP connections as well as its WebSockets, and closes Chromium connections in both the default and embedded-browser sessions. Each service cleanup starts even if another throws or hangs. Existing renderer flush, PTY termination, storage flush, utility-child cleanup, eight-second app.exit deadline and external watchdog remain in use on normal quit and updater restart.
- Linked user and project skill folders resolve with realpathSync.native, appear once per real path, and retain the existing Linked note. Inventory stays shallow, so loops are not traversed. Exports still reject nested links; bulk export also rejects destination junctions before writing through them. POSIX paths retain case in both deduplication and IDs.
- Taskbar flashing follows newly waiting session IDs independently of desktop notification settings. Acknowledging a pane clears its badge without making the same unresolved prompt new again on blur. Existing focus handling stops flashing. Completion notifications keep their previous flash behavior.
- Windows jump lists contain Projects (up to five recently used projects), New session and Mini window. Project entries start Claude explicitly, even for projects whose default agent differs. Initial launch and second-instance arguments use the existing CLI bridge after renderer readiness. Successful terminal starts save recentProjectIds in settings; history persistence cannot fail an otherwise successful spawn. Project changes refresh the list. User-removed jump-list items are respected. Other platforms skip the shell API.

## Merge hooks

- `src/main/desktop.ts`: `onAttentionCount(listener)` immediately supplies the current normalized count, supplies subsequent changes, and returns an unsubscribe function for tray teardown.
- `src/main/desktopLaunch.ts`: call `setMiniWindowLaunchHandler(() => showMiniWindow())` during startup. `--mini-window` calls `openMiniWindowFromDesktop()`. Its default handler intentionally does nothing until the Mini window owner wires it.
- The tray may call `openMiniWindowFromDesktop()` or `handleDesktopLaunch(['--new-session'])` for its corresponding actions. No tray or Mini window was built in this branch.

## Files changed

| Area | Files |
| --- | --- |
| Shutdown | `src/main/cliServer.ts`, `shutdown.ts`, `remoteServer.ts`, `toolsIpc.ts`; small integration section in `index.ts` |
| Linked skills | `src/main/skillInventory.ts` |
| Desktop attention | `src/main/desktop.ts`, `src/renderer/attention.ts`, `attentionBadge.ts`, `components/sidebar.ts`, `src/shared/waitingAttention.ts` |
| Launch actions | `src/main/desktopLaunch.ts`, `cliRunner.ts`, `src/shared/platformActions.ts`; small sections in `src/main/index.ts`, `ipc.ts`, `src/renderer/main.ts` |
| Typed bridge and settings | `src/preload/index.ts`, `src/shared/api.ts`, `ipc.ts`, `types.ts`, `settingsSchema.ts`, `settingsTransfer.ts` |
| Unit tests | `tests/unit/cliServer.test.ts`, `desktop.test.ts`, `platformActions.test.ts`, `remoteServer.test.ts`, `settingsImportDialog.test.ts`, `settingsTransfer.test.ts`, `shutdown.test.ts`, `skillInventory.test.ts` |
| End-to-end tests | `tests/e2e/platform.spec.ts` |

## Verification and limits

The new platform spec covers native import selection/cancel/preview, linked skills with duplicate and loop junctions, notifications-off flashing and focus/blur deduplication, first/second-instance actions, project-list refresh, quit with a half-written CLI request, and updater restart with an open client. Existing import, skills, CLI, damaged-renderer quit, notifications-off and install-on-quit tests were also exercised. No screenshots were taken.

The window was temporarily built and tested at 1024 by 728, including import-dialog bounds, then restored to 1440 by 900. The final production build passes.

Final unit verification: `npx vitest run --maxWorkers=1` passed all 300 files, with 3,172 tests passed and five skipped. Earlier overlapping runs produced process-timing failures; all affected tests passed in isolation and the complete serial run passed. Eleven end-to-end tests passed together at 1024 by 728 across platform, settings transfer, skills and CLI. The additional Windows project-change jump-list check passed separately, covering all seven new platform cases. Four selected existing lifecycle, notifications and install-on-quit tests also passed, for 16 passing end-to-end cases overall.

An isolated npm run dev profile in the temporary directory was launched by a temporary verification script. It recorded the main, GPU, renderer and utility process IDs, requested normal quit, then checked those IDs and listed remaining Dawsha/Electron processes. None of the captured app processes remained; unrelated installed/test instances were left alone. This confirms the development process tree cleanup, not a reproduction of the owner's exact packaged orphan.

The mockup's shell, panes, side panel, settings styling and Mini window belong to other workers. This branch only changes the assigned platform behavior and retains real existing components. The remaining integration work is wiring the Mini window handler and tray count listener. A packaged Windows smoke check of the physical taskbar menu and real updater remains useful; automated updater coverage uses the fake backend.

Electron API contracts were checked against the official [app jump-list documentation](https://www.electronjs.org/docs/latest/api/app) and [session connection cleanup documentation](https://www.electronjs.org/docs/latest/api/session).
