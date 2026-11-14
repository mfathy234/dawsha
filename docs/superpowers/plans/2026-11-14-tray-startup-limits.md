# Tray, startup and limit warnings implementation plan

**Goal:** Keep Dawsha monitoring agents after closing its window, optionally start at sign-in, and warn at 80% and 95% of Claude and Codex limits.

**Architecture:** Reuse the existing tray and shutdown path. Put close/startup decisions and warning deduplication in shared pure helpers. The main process owns OS login settings and desktop warning delivery, with durable preferences and warning state in app settings. Reuse Settings rows and theme tokens.

**Spec:** Owner's Dawsha 1.8.9 tray worker brief in this session.

**Constraints:** Quit remains the default outside macOS. macOS window close keeps running. Login settings are packaged-only on Windows/macOS and read back from the OS. No version, changelog or site changes. Preserve confirmation dialogs, notification redaction, sound settings, usage rings, and other workers' areas.

**Review focus:** Explicit Quit must stop services even while hidden; hidden startup must never flash the main window; external OS login changes must be reflected; stale/reset readings must not notify; percentage dips must not re-arm the same window.

## 1. Tray and sign-in
- [x] Write failing tests for close decisions, exact hidden argument parsing and safe settings migration.
- [x] Add `src/shared/desktopSettings.ts` and main login-item adapter; add settings schema/types/API plumbing.
- [x] Extend main close/startup/activation behavior and reuse tray Show Dawsha and Quit.
- [x] Add General controls with packaged-only note and OS read-back, using existing rows.
- [x] Run unit tests and build; add e2e for real close, tray restore, one-time notice and shutdown.
- [x] Review and commit with the required co-author trailer.

## 2. Limit warnings
- [x] Extend `tests/unit/limitWarnings.test.ts` first for 80/95, independent agents/windows, reset jitter, dips, stale data and persisted state.
- [x] Extend shared detector; replace renderer/localStorage delivery with a main-process monitor using existing limit sources and `notifyUser`.
- [x] Add Notifications switch, default on, gated by the existing notifications toggle and sound preference.
- [x] Add e2e using fake Claude/Codex readings and `DAWSHA_NOTIFY_LOG`; test suppression, dedupe, reset and restart.
- [x] Run relevant unit/e2e specs and review the diff.

## 3. Verification and delivery
- [x] Temporarily set createWindow to 1024x728, build and run touched e2e specs plus settings, Mini window and smoke coverage.
- [x] Use a throwaway Playwright spec for screenshots in test-results at 1024x728 and 1440x900, dark/light and Classic/Desktop app style; inspect and fix issues.
- [x] Revert temporary dimensions and delete the throwaway spec.
- [x] Run `npm run build` and `npx vitest run`; report any known local failures by name.
- [x] Obtain independent code review, fix findings and commit only owned files. Do not push or merge.

## Delivery record

Implemented all three scoped features using the existing Settings rows, theme tokens, tray menu and notification delivery. The 5h/W rings were preserved. No scoped mockup items were omitted.

### Files touched

- Main: `src/main/index.ts`, `src/main/ipc.ts`, `src/main/miniWindow.ts`, `src/main/loginItems.ts`, `src/main/limitNotifications.ts`.
- Preload: `src/preload/index.ts`.
- Renderer: `src/renderer/components/desktopSettingsControls.ts`, `src/renderer/components/settingsView.ts`, `src/renderer/components/settingsPolish.css`, `src/renderer/components/topbar.ts`; removed `src/renderer/limitNotices.ts` and its localStorage warning state.
- Shared: `src/shared/desktopSettings.ts`, `src/shared/limitWarnings.ts`, `src/shared/types.ts`, `src/shared/api.ts`, `src/shared/ipc.ts`, `src/shared/settingsSchema.ts`, `src/shared/settingsSearch.ts`, `src/shared/settingsTransfer.ts`.
- Tests: `tests/unit/desktopSettings.test.ts`, `tests/unit/loginItems.test.ts`, `tests/unit/desktopSettingsSchema.test.ts`, extended `tests/unit/limitWarnings.test.ts`; `tests/e2e/desktopLifecycle.spec.ts`, `tests/e2e/usageWarnings.spec.ts`.
- Documentation: this plan and verification record.

### Verification

- Final `npm run build`: passed after restoring `createWindow` to 1440x900.
- Final focused unit run: 134 tests passed across desktop decisions, native login settings, thresholds/dedupe, settings migration/transfer/search, close checks and shutdown.
- Full `npx vitest run`: 3,347 passed, 5 skipped, 3 known local failures in `codeNavExtras`, `codeNavPackaged` and `codeNavServers`. The first two hit Windows temporary-file cleanup permissions; Extras also returned an empty TypeScript caller result, and Servers hit its request timeout. The subsequently added three schema tests passed in the focused run.
- Selected 1024x728 e2e run: 54/55 passed, with the existing Mini detail-focus test failing on a detached Allow button. That exact test passed on an isolated rerun. The existing unsaved Files close/cancel test also passed separately.
- Existing specs exercised: Settings, Settings navigation, Settings transfer, Mini window, notifications, notification actions, close confirmation and smoke (including title-clipping assertions).
- Final feature/visual run at native 1024x728: 15/15 passed (7 feature cases and 8 visual combinations).
- Captured and inspected 16 screenshots in `test-results/tray-visual/`: General and Notifications at 1024x728 and 1440x900, dark/light, Classic/Desktop app style. No horizontal content overflow; visible select focus; long controls fit. The throwaway screenshot spec was removed and no screenshots were committed.
- Independent review approved after fixing hidden-window unsaved confirmation and keyboard focus after saving.
- `git diff --check`: passed. No version, CHANGELOG or site changes; no push or merge.

### Reviewer attention

Real packaged sign-in registration and a real macOS sign-in/close cycle still need release-machine verification. Native adapter unit tests verify parameter contracts, Windows startup approval, macOS service approval and dev/Linux guards; this Windows development run deliberately never changes the owner's actual login registration.

Warning polling runs in main every five seconds and persists delivered thresholds before notification delivery. A jump past both thresholds sends one current-percentage notification. Missing reset times retain dedupe conservatively until a later known reset identifies a new cycle.

Commits: `24d6074` (shared/native rules) and `3b2102c` (integration and regression tests), followed by this verification record.
