# Windows CI reliability and release check

Scope: items 5 and 10 of `2026-10-29-1.7.5-and-crew.md` and the owner's detailed instructions.

Work only in `feat/1.7.5-ci`. Preserve the dependency junction; no installs, pushes, merges or tags.

1. Trace Playwright process/connection ownership and quit logs. Add failing helper tests for already-exited applications, bounded cleanup and timer cancellation; fix leaked resources at their source.
2. Reproduce Enter before the new quick pick renders. Cover the default selection in a regression test, handle the early key in the app, and wait for a focused active picker in arrange tests.
3. Trace the ten-second quit path through renderer permission, shutdown phases and process closure. Keep unsaved-file confirmation intact and fix any verified slow path.
4. Add pure version/changelog and asset-name tests first. Implement an import-safe, read-only `scripts/release-check.mjs`, its TypeScript declarations and `release:check` npm command. Check origin without fetching refs into the worktree, GitHub release/workflow state, website HTTP status and origin/main's New in heading. Fail closed on missing data or CLI/network errors.
5. Build and run only arrange, smoke, info and layouts, repeated three times. Run typecheck and the full Vitest suite, review the diff, run the release check for 1.7.4, and commit with the requested attribution.

Review focus: early Enter during rendering/fade; app exit before helper cleanup; launch failure after process creation; confirmation dialog without a deadline; annotated tags and incomplete/missing release data.

## Findings and fixes

- Worker teardown: Playwright waits for the Windows launcher's `close`, not just Electron's exit. Inherited output pipes and a surviving `cmd.exe` can keep that wait pending. Cache process ownership at launch, release the launcher's pipes on exit, and reclaim a surviving launcher only after the real Electron PID is gone. The browser context may never emit close, so cleanup cannot depend on that event. Run `taskkill` asynchronously with a bounded utility deadline and kill the owned launcher if tree enumeration stalls; a synchronous call was observed blocking the worker for 21 seconds. Clean up failed launches, and cancel every fallback/poll timer. Shutdown must also call node-pty's native cleanup, not just kill its shell tree. Refuse new PTYs as soon as termination starts so queued renderer launches cannot escape the cleanup snapshot.
- Quick pick: rendering is deferred to an animation frame, while the preceding picker remains in the DOM for a 100 ms fade. A count assertion could see that old picker and send Enter before the new picker mounted. Handle a fast Enter from the pending picker state, and wait for the active picker, selected option, focused input and enabled Start button in arrange tests.
- Already-exited app: Playwright disposes its internal app object, so `process()` can throw after exit. Use the cached process and share safe cleanup between `closeApp` and `closeBounded`.
- Quit latency: the renderer acknowledgement had a ten-second budget before shutdown watchdogs were armed; a crash after acknowledgement could also leave confirmation pending. Bound only acknowledgement to the existing one-second renderer budget, preserve unlimited healthy confirmation time, and observe renderer crashes. Use `app.exit` after shutdown phases so Chromium children close normally. Electron stops Node workers before native teardown finishes, so the Windows watchdog now uses a hidden, unreferenced PowerShell process at the same absolute deadline. It checks process creation time before binding and holds the OS process handle while waiting, avoiding recycled PIDs. Launcher cleanup handles the separate driver wait after the real app has exited.
- Release check: inspect remote refs with `git ls-remote`, use `gh` for ancestry/release/workflow/site-source reads and `fetch` for HTTP status. No local refs, release state or website content are changed. Pure tests cover version agreement, first changelog entry, exact asset names and the website heading.

Regression tests reproduced the early Enter, missing acknowledgement, inherited pipes, leftover launcher without a context close event, missing native PTY cleanup, late-spawn and watchdog-owner teardown failures before their fixes. Real-process helper tests also verify that a still-live Electron main is not reclaimed early. Watchdog tests clean up their child processes and fallback timers even on failure.

## Verification

- `npx electron-vite build`: passed (existing mixed static/dynamic editor import warning).
- `npm run typecheck`: passed.
- `npx vitest run`: 211 files passed; 2,145 tests passed, four skipped.
- Requested four-spec command with `--repeat-each 3 --reporter=line`: **84 passed in 7.6 minutes**, zero worker teardown errors and zero ten-second cleanup fallbacks. Arrange: 15; smoke: 33; info: 27; layouts: nine. Expected launcher-reclamation diagnostics confirm owned leftovers are being cleaned up.
- Final TypeScript and general reviews: no outstanding findings. `git diff --check`: passed.
- The complete end-to-end suite was not run. The dependency junction was preserved; no install, push, merge or tag was performed.

`npm run release:check -- 1.7.4` exited zero:

```text
✓ Versions: requested 1.7.4, package.json 1.7.4, top CHANGELOG 1.7.4
✓ Origin tag and main: v1.7.4 points to a commit on origin/main
✓ Published release: v1.7.4 is published
✓ Release assets: all 9 required assets uploaded
✓ Release workflow: latest release.yml for v1.7.4: completed/success
✓ Website HTTP: https://dawsha.pages.dev/ returned 200
✓ Website New in: origin/main heading 1.7, expected 1.7
```

No requested issue remains unfixed in the verified scenarios. The Windows native-exit watchdog remains a fallback at its original deadline; the test helper does not depend on Electron's context-close event to reclaim an exited app's launcher.
