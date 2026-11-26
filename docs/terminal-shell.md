# Shells and terminal control sequences

PowerShell, bash and zsh launched in an interactive shell tab or drawer receive OSC 133 prompt/command hooks and OSC 7 working-directory reporting. Existing user configuration runs first. Noninteractive task commands and unrecognized shells retain their normal launch. cmd does not have command-block integration. `DAWSHA_SHELL_ARGS` accepts the same argument format as the agent argument overrides.

Commands show their result and elapsed time in the gutter. The command menu offers Rerun, Copy output and Send to a session. Rerun is available only at an empty prompt. Send chooses a running agent session and submits the command plus output with a code fence; sessions awaiting permission must be answered first. Output snapshots are bounded to 64,000 characters and 200 decorations per terminal.

Ctrl+backtick toggles a shell below the focused pane, using the session's working folder/worktree. Hiding retains the process and returns focus to the previous input. Drag the separator, or focus it and use Up/Down, to resize. The height is saved in app settings (120–600 pixels, default 240). A pane's drawer ends when the pane closes.

Ctrl+Alt+R opens project command history while a shell has focus (and Reading view in an agent's terminal). Ctrl+R remains the shell's reverse search; Ctrl+Shift+R is always Dawsha's Resume action. Enter inserts a history item without executing it. History lives in `shell-history.json` in app data, newest first, with at most 500 commands per project shared by its checkouts and sessions.

A command lasting at least 30 seconds notifies when its terminal is hidden or the app is unfocused. Both the global notification setting and Long shell commands must be on. Sound follows the existing preference.

OSC 7 updates the base for relative file links and New session here. URL paths are decoded, and controls and Windows network-path forms are rejected. Host names are not used to access network shares; only the local path is tracked. OSC 52 accepts bounded UTF-8 clipboard writes after one Allow/Deny decision per live terminal. Reads (`?`) are always refused, including before consent. Consent does not block terminal parsing.

OSC 9;4 progress appears as a thin tab bar and on the Windows taskbar. The focused pane's progress wins, followed by the most recent active progress. State 0 and terminal exit clear it. OSC 8 HTTP(S) links show their URL on hover and open only with Ctrl/Cmd+click.

Pane approvals and context nudges float over the terminal. A recap keeps its last nonempty text per terminal and omits the configuration hint. Fits wait 120 milliseconds after the last size event and skip unchanged dimensions. Hidden GPU renderers sleep after one minute; at most 12 WebGL renderers are retained, with hidden renderers yielding first. `[term] resize` and `[term] webgl context lost` console entries help diagnose redraws.

The integrations follow the [xterm parser and link APIs](https://xtermjs.org/docs/api/terminal/interfaces/iparser/), [Final Term OSC 133 sequences](https://code.visualstudio.com/docs/terminal/shell-integration#_final-term-shell-integration), [bash prompt hooks](https://www.gnu.org/software/bash/manual/html_node/Interactive-Shell-Behavior.html), [zsh hooks](https://zsh.sourceforge.io/Doc/Release/Functions.html), and [Electron taskbar progress API](https://www.electronjs.org/docs/latest/api/browser-window#winsetprogressbarprogress-options).
