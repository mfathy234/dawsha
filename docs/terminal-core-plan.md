# Terminal core 1.10

1. Stabilize pane layout: float approval and context controls, retain recaps, debounce unchanged fits, release hidden GPU renderers and log resizes/context loss. Verify recap units and permission-card layout in Electron.
2. Add isolated OSC parsing and shell command tracking. Inject shell integration at launch; capture command bounds, exit status, duration and current directory. Keep OSC clipboard permission per live session and reject reads. Use the existing link-opening rule for OSC hyperlinks.
3. Add command actions, persistent project history, long-command notifications, tab/taskbar progress and a retained shell drawer. Use Ctrl+Shift+R to preserve native shell reverse search. Store drawer height and notification preference through the shared settings pipeline.
4. Run typecheck, full unit suite, production build, feature end-to-end tests and smoke. Review and commit changes in logical groups, without pushing.

Risks: shell startup hooks must preserve user profiles; renderer observers must not produce resize storms; OSC payloads are untrusted. Bound persisted history and clipboard data, validate directory URLs and external links, and dispose parser hooks/decorations with terminals. No new dependencies.
