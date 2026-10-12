# Changelog

All notable changes to Dawsha are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-10-12

### Added

- Show Download and Install actions, download progress and retry controls in Settings after checking for updates.
- Open the pane named by a clicked notification, including after the workspace finishes loading.

### Changed

- Use Claude transcript titles for active sessions in the Projects sidebar when live session metadata has no title.
- Keep pane expand and close controls visible in compact headers, add Restore pane to grid to the pane actions menu,
  and allow long pane menus to scroll so lower actions such as saving snippets stay reachable.
- Use the animated favicon mark beside the website's Switch heading and above the closing tagline in English and Arabic.

## [0.2.0] - 2026-10-11

### Added

- Search session prompts and replies when resuming, with a checkbox to include all projects.
- Keep closed sessions under their projects until they are removed from the project list.
- Track project tasks with linked sessions, notes and commit references.
- Show recent Gemini tool activity in pane details and the agents drawer.

### Changed

- Use the animated favicon in the app and website headers, with reduced-motion support.

## [0.1.0] - 2026-10-10

### Added

- Dawsha identity with its own Windows executable, installer and taskbar icon.
- Native per-pane process activity for Claude, Codex and Gemini, without an optional Claude mod.
- A Skills view for installed user, plugin and project skills and agent definitions, with open, copy-path and safe export actions.
- Per-pane context and available rate-limit information, with reset times for Claude limits.
- Arabic and English website with language switching, RTL layout and current app screenshots.
- A confirmed Paneon settings import that backs up Dawsha settings and applies the imported settings on the next launch.

### Changed

- File and image references open in the matching default app; HTML opens in the browser, while potentially executable files are revealed in Explorer.
- Sessions in the sidebar return to the grid from Usage and other views.
- Snippet saving has a live preview and confirmation; the first theme is named Dawsha without changing its colors or saved ID.
- New session, top navigation, font-size, Settings and Theme controls have a more focused visual hierarchy while retaining Dawsha's colors.

## [0.9.0] - 2026-10-09

### Added

- Git quick actions: Pull (fast-forward only), Fetch, Switch branch with create and remote branches, Stash and switch,
  Stash changes and Apply last stash, from the palette or the branch in a pane header, which now shows ahead / behind.
- Projects > Instructions edits `CLAUDE.md`, `AGENTS.md` and `GEMINI.md`, refuses to save over outside changes
  without asking, and keeps a shared block of instructions in sync across the three files.
- Context warnings: the gauge turns amber at 80% and red at 90%, with a Compact hint and a one-time notification.
- Drag files from Explorer onto a pane to type their paths into the agent.

## [0.8.0] - 2026-10-09

### Added

- Changes panel (**Ctrl+Shift+G**). Review a pane's changed files with their diffs, **Commit** only the files you check
  or **Commit and push** in one step, and discard files after a confirmation that names them.
- Find in the terminal (**Ctrl+Shift+F**) with match case, whole word and regex, a match count and next / previous.
- Ctrl+click a `file:line` path in a terminal to open it in VS Code at that line.
- **Ctrl+Up** / **Ctrl+Down** jump between the prompts you sent.
- **Ctrl+Alt+C** copies the last reply and **Ctrl+Alt+P** copies the prompt you are typing, without sending it.
- Save a terminal selection as a snippet, and clear a pane's scrollback without restarting the agent.
- Highlight rules tint lines with errors, warnings or passing tests; edit them in Settings > Highlights.
- An **Open in VS Code** button in every pane header, and **Open in Visual Studio** in the pane menu when the folder has a
  `.sln` solution. The pane menu shows an icon for each action and its keyboard shortcut.

### Fixed

- The Settings view and a few other parts of 0.7.0 showed without their styling.

## [0.7.0] - 2026-10-09

### Added

- Resizable panes. Drag the border between columns or rows, or focus it and use the arrow keys; double-click resets.
  Sizes are kept per arrangement, across restarts and in saved layouts.
- Pin a pane from its menu or the palette. It stays beside whichever pane you maximize.
- Drag a pane by its header to reorder the grid, and drag tabs along the tab strip. Esc cancels.
- **Ctrl+Shift+J** goes to the next pane that needs you.
- Session time, tokens and Claude Code cost in each pane's strip, and today's total per project in the sidebar.
- **Export transcript...** saves a session as Markdown or HTML with its prompts, replies, tool calls and changed files.
- A Settings view (**Ctrl+,**) with general options, notifications and live session info, full access per agent,
  updates, the full changelog and where your data lives. The What's new dialog links to the full changelog.

### Changed

- Notifications, live session info, updates and Getting started moved from the Theme menu to Settings.

### Fixed

- Ctrl+V with a screenshot on the clipboard pasted nothing. The image is now saved and its path pasted, so the agent
  attaches it.
- Removing a compare worktree right after closing its pane could fail with "Permission denied" on Windows. Dawsha now
  waits for the folder to be released.

## [0.6.0] - 2026-10-09

### Added

- Move panes. A **Move pane** button in each pane header lists every position, and Ctrl+Shift+Alt+Left / Right (Home /
  End for first / last) moves the focused pane. The order is saved with the workspace.
- Full access per agent. **Start with full access** in the Agents view starts new sessions without approval prompts
  (`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`, `--yolo`). It is on for Claude Code
  and Codex CLI and off for Gemini CLI by default.
- Pane keyboard shortcuts: **Ctrl+Tab** and **Ctrl+Shift+Tab** cycle the panes, **Ctrl+1** to **Ctrl+9** jump to one.

### Changed

- Claude, Codex and Gemini sessions show their own logos instead of letter badges.

### Fixed

- The pane menu opened at the right edge of the grid for left and bottom panes. It now opens next to its button and
  flips up or left when there is no room.
- Esc closes a pane menu even when focus has moved off the menu.
- Quitting no longer hangs: shutdown steps are time-limited and the app ends its own process after cleanup, with a
  watchdog backstop.
- Clicking the update pill right as the app refreshed could be ignored, leaving the update popover closed. The pill now
  keeps its parts in place between refreshes, so the click always lands.

## [0.5.0] - 2026-10-09

### Added

- A command palette. **Ctrl+K** (or Ctrl+Shift+P) lists your open sessions, actions, projects, snippets and saved
  layouts in one fuzzy search. Up and Down move, Tab jumps to the next group, Enter runs, Esc closes, and the commands you
  ran last come first. Menus and shortcuts read the same command list. The key can be changed with `paletteShortcut` in
  `settings.json`.
- Saved layouts. The **Layouts** button in the top bar saves the current panes (project, agents, tabs, session ids, text
  size and order) under a name, and lists, opens, renames and deletes them. Opening asks whether to replace the current
  panes or add alongside them. Tabs with a session id resume it, the rest start fresh. From a terminal:
  `dawsha open <layout>` and `dawsha layouts`.
- Prompt snippets. A **Snippets** tab in Projects holds short prompts, global or for one project, with the variables
  `{{selection}}`, `{{branch}}`, `{{project}}` and `{{folder}}` and an optional **Alt+1** to **Alt+9** shortcut. Inserting
  types the text into the focused terminal without pressing Enter, as a bracketed paste when the agent supports it so
  that no line runs on its own. Snippets are also in the palette.
- Ask two agents. **Ask two agents...** (Ctrl+Shift+A, the split-button menu or the palette) sends one prompt to two agents
  and shows them side by side in a linked pair under a shared Compare header. Each can run in its own git worktree on a
  new branch. **Keep A**, **Keep B**, **Keep both** and **Diff A vs B** finish the comparison; closing a side and removing
  its worktree and branch each ask first, and a worktree with uncommitted files or commits is kept unless you confirm.
- Continue in another agent. A pane's menu and the palette offer **Continue in Codex / Gemini / Claude**. Dawsha writes a
  summary (goal, files touched from git, plan and last check from the ops feed, last error and recent terminal output) that
  you can edit, then starts the other agent in the same folder with it as the first message. The new pane carries a
  **from <agent>** chip.
- A **Usage** view with today, 7 day and 30 day ranges. It reads Claude Code, Codex CLI and Gemini CLI history from their
  own folders and shows tokens per day (or hour) by agent, tokens and Claude Code cost by project and by agent, and a
  history of the 5 hour and weekly limits. Cost appears only where an agent reports one; nothing is estimated.

## [0.4.0] - 2026-10-08

### Added

- In-app updates. The installed build checks GitHub Releases 10 seconds after start and every 6 hours, and shows an
  "Update" pill in the top bar. **Update now** downloads in the background while your sessions keep running, then
  **Restart now** (or quitting) installs it and your open sessions reopen. **Later** hides the pill until a newer version
  appears. The portable build only points you to the release page.
- An Updates section in the Theme popover: automatic checks on or off, a status line, **Check now** and **What's new**.
- A What's new dialog after an update, listing every release since the version you had before.

### Fixed

- Taskbar and notifications now show Dawsha's own icon and name.
- Upgrading by hand from 0.3.0 now shows this What's new dialog too.

## [0.3.0] - 2026-10-08

### Added

- Resume picker: a New | Resume switch in the quick-pick. Resume lists earlier sessions of Claude Code, Codex CLI and Gemini CLI
  across all projects, newest first and grouped by age, with search, an agent filter, a project filter and a preview of the
  first prompt and the last assistant message. Enter resumes in a new pane, Shift+Enter in the focused pane, Ctrl+R toggles
  New / Resume and Ctrl+Shift+R opens it directly. Sessions that are already open show "open in pane N" and are focused
  instead of started twice.
- Resume entry points in the split-button menu and in every project's menu, plus an empty state per project.
- A muted "resumed" chip in the pane header for the first minute of a session resumed from the picker.
- The `dawsha` command: `open`, `.`, `start`, `resume`, `ls`, `sessions`, `add`, `update-agents`, `--help` and `--version`.
  The installer adds it to the user PATH and removes it on uninstall.
- First-run setup with two steps (add a project, check your agents), a `dawsha .` tip, and a Getting started item in the
  Theme popover to reopen it.
- Second launches of the app forward their arguments to the running instance.

### Changed

- The project menu entry "Resume session..." now opens the resume picker filtered to that project.

## [0.2.0-legacy] - 2026-10-08

### Added

- Dawsha, formerly Claude Grid: a grid of real terminals for Claude Code, Codex CLI and Gemini CLI.
- Codex CLI and Gemini CLI sessions with titles, models, context and busy/idle state next to Claude Code.
- The Agents view with installed and latest versions and one-click install and update in a visible shell tab.
- Needs-you alerts: an amber border, taskbar flash and Windows notification when a session finishes or waits on a prompt.
- Optional status-line bridge and ops feed for plan progress, sub-agents, limits and changed files.
- Eight themes with contrast checks and an optional background image.

### Changed

- Renamed from Claude Grid to Dawsha; settings are migrated from the old user-data folder on first start.
