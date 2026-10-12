<p align="center">
  <img src="src/renderer/assets/logo.svg" width="96" height="96" alt="Dawsha logo: a terminal inside a speech bubble">
</p>

<h1 align="center">Dawsha</h1>

<p align="center"><strong>One window for all your AI coding agents.</strong></p>

<p align="center"><a href="https://dawsha.pages.dev/">Website</a> · <a href="https://github.com/mfathy234/dawsha">GitHub repository</a></p>

<p align="center">
  A desktop app for Windows and Apple Silicon Mac that puts Claude Code, OpenAI Codex CLI and Google Gemini CLI side by side in a grid of
  large, readable terminals, one per task, with live status, plan progress and needs-you alerts.
</p>

<p align="center">
  <img src="docs/screenshots/grid.png" alt="Dawsha showing four sessions in a 2 by 2 grid: Claude Code, Codex CLI and Gemini CLI on four demo projects">
</p>

## Features

- **A grid of real terminals.** 1 to 6+ panes laid out automatically, each a full terminal (xterm.js on `node-pty`) with tabs for more agent sessions or a shell. Maximize any pane, zoom text per project.
- **Three agents, one workflow.** Pick a project and its default agent starts in that folder without a prompt. Switch agent per session with the split **New session** button (Claude / Codex / Gemini) or Tab in the quick-pick.
- **Know what each session is doing.** Busy and idle state, session names, model, context gauge, cost and git changes in a one-line strip under every pane header. A pane that finishes or waits on a permission prompt gets an amber border, a taskbar flash and a Windows notification.
- **Activity per pane.** Native child-process activity works for Claude, Codex and Gemini without a mod. An optional Claude ops feed adds plan progress and sub-agent details. Context and any available 5-hour/weekly limits stay with their own pane.
- **Arrange panes your way.** Drag the borders between panes to resize them, drag a pane by its header or a tab along its strip to reorder, or use the **Move pane** button and the keyboard. Pin a pane so it stays beside whichever pane you maximize. Switch panes with **Ctrl+Tab**, jump to one with **Ctrl+1** to **Ctrl+9**, or to the next one waiting on you with **Ctrl+Shift+J**.
- **Resume where you left off.** Open panes come back on the next start, each agent resumes its own session id. The **Resume** picker (Ctrl+Shift+R) lists earlier sessions of all three agents across your projects, newest first, with search, an agent filter, a project filter and a preview of the first prompt and the last reply.
- **Find work across sessions.** Search prompts and replies in the Resume picker. Leave **Search all projects** unchecked to search one project, or check it to search every project.
- **Keep closed sessions in Projects.** Closing a pane keeps its resumable sessions under that project in the left sidebar. Resume one there or use its Remove button to clear it from Dawsha's list; the agent transcript stays on disk. Open sessions also have a Close button in the sidebar.
- **Task history.** The Projects > Tasks tab groups related sessions, a task goal, notes and commit references in a dated history that remains after sessions close.
- **Gemini tool activity.** Gemini panes show the latest tool from the agent's saved chat, with recent tool calls in the activity drawer when available.
- **A command palette.** **Ctrl+K** searches your open sessions, actions, projects, snippets and layouts in one list and runs what you pick from the keyboard.
- **Saved layouts.** Save the current panes under a name and bring the same setup back later, resuming each agent's session, from the **Layouts** menu, the palette or `dawsha open <layout>`.
- **Prompt snippets.** Keep short prompts with `{{selection}}`, `{{branch}}`, `{{project}}` and `{{folder}}` variables and insert one into the focused terminal with **Alt+1** to **Alt+9**, typed but not sent.
- **Ask two agents.** Send one prompt to two agents at once, each optionally in its own git worktree, watch them side by side and keep one, keep both or diff them.
- **Continue in another agent.** Hand a session over to Codex, Gemini or Claude with an editable summary of the goal, the files touched, what is done and left, the last error and the recent output.
- **Cost and time at a glance.** Every pane shows how long its session has run and its tokens (and cost for Claude Code), and each project in the sidebar shows today's total.
- **Export a transcript.** Save a session as Markdown or HTML with its prompts, replies, tool calls and the files it changed.
- **Paste screenshots.** Ctrl+V with an image on the clipboard hands it to the agent in the focused tab.
- **Commit and push from the pane.** Review a session's changed files with their diffs, then **Commit** the ones you check or **Commit and push** in one step, or discard them after a confirmation that names each file (Ctrl+Shift+G).
- **Git at hand.** Pull, fetch, switch or create a branch, stash and apply a stash from the palette or by clicking the branch in a pane header, which also shows how far ahead or behind it is.
- **Project instructions.** Edit a project's `CLAUDE.md`, `AGENTS.md` and `GEMINI.md` in the Projects view, and keep one shared block of instructions in sync across all three.
- **Context warnings.** The context gauge turns amber at 80% and red at 90%, and a full session offers **Compact** before it runs out.
- **Drop files into a terminal.** Drag files from Explorer onto a pane to type their paths for the agent.
- **Find in the terminal.** **Ctrl+Shift+F** searches a pane's output with match case, whole word and regex, and steps through the matches.
- **Work with the output.** Ctrl+click a file reference to open it with its matching app (images in Photos, HTML in your browser); scripts and executables are revealed in Explorer. Jump between prompts with **Ctrl+Up** and **Ctrl+Down**, copy the last reply (**Ctrl+Alt+C**) or the prompt you are typing (**Ctrl+Alt+P**), save a selection as a snippet, and clear the scrollback.
- **Highlight rules.** Lines with errors, warnings or passing tests are tinted in every pane; change the words and colors in Settings.
- **Open in your editor.** Every pane header has an **Open in VS Code** button, and the pane menu opens the folder's `.sln` in **Visual Studio** when there is one. The menu shows each action's icon and shortcut.
- **Usage.** Tokens per day by agent, tokens and Claude Code cost by project and agent, and a history of your 5 hour and weekly limits, read from the agents' own folders.
- **A `dawsha` command.** Run `dawsha .` in any folder to add it as a project and start its agent, `dawsha resume --last` to pick up the newest session, `dawsha open <layout>` to bring a saved layout back, or `dawsha ls` to list your projects, all from the terminal you already have open.
- **A short first run.** On a fresh install a two-step setup adds your first project and shows which agent CLIs are installed. It stays closed once you dismiss it and can be reopened from the Theme popover.
- **Install and update the agents.** The **Agents** view shows the installed and latest version of each CLI and runs the install or update in a visible shell tab. Choose per agent whether sessions start with full access, on by default for Claude Code and Codex.
- **Skills and agents inventory.** The **Skills** tab separates installed skills from agent definitions across user, plugin and project locations. Filter by AI provider, then open, copy a path or export an item to a folder you choose.
- **Paneon settings import.** If Paneon settings are found, Settings > General offers an import. Dawsha backs up its current settings and applies Paneon projects, layouts, snippets and preferences the next time you open Dawsha; Paneon remains untouched.
- **Settings in one place.** A Settings view (Ctrl+,) for the palette shortcut, notifications and live session info, full access per agent, updates, the full changelog and where your data lives.
- **Themes.** Eight themes (Dawsha, Nord, Tokyo Night, Catppuccin Mocha, Solarized Dark, Gruvbox Dark, GitHub Light, Solarized Light) with contrast checks, plus an optional background image.
- **Local only.** No account, no telemetry, nothing leaves your machine.

| Focus a pane and open its details | Sub-agents drawer |
|---|---|
| ![A maximized pane with the details panel open](docs/screenshots/focus-details.png) | ![A pane with the sub-agents drawer open](docs/screenshots/agents-drawer.png) |

| Projects | Agents |
|---|---|
| ![The projects view](docs/screenshots/projects.png) | ![The agents view with install and update buttons](docs/screenshots/agents.png) |

![The Skills tab showing installed skills and their locations](docs/screenshots/skills.png)

![The Skills tab showing installed agent definitions](docs/screenshots/installed-agents.png)

![The theme picker open over the grid](docs/screenshots/themes.png)

| Resume picker | First run |
|---|---|
| ![The resume picker listing sessions of all three agents with a preview of the selected one](docs/screenshots/resume-picker.png) | ![The Set up Dawsha dialog with two steps, add a project and install your agents](docs/screenshots/onboarding.png) |

![A PowerShell window running dawsha ls, dawsha start and dawsha sessions next to the Dawsha grid. The image is a composite of a real app screenshot and the real output of those commands.](docs/screenshots/cli.png)

| Update available | What's new after an update |
|---|---|
| ![The Update 0.1.1 pill in the top bar with its popover: release notes, Update now and Later](docs/screenshots/update.png) | ![The What's new dialog listing the changes since the previous version](docs/screenshots/whats-new.png) |

| Command palette | Saved layouts |
|---|---|
| ![The command palette filtered by "re", with sessions, actions and projects](docs/screenshots/palette.png) | ![The Layouts menu with two saved layouts, each with Open, Rename and Delete](docs/screenshots/layouts.png) |

| Ask two agents | Continue in another agent |
|---|---|
| ![Two agents answering the same prompt side by side under a Compare header, each in its own worktree, with Keep A, Keep B, Keep both and Diff A vs B](docs/screenshots/compare.png) | ![The Continue in Codex dialog with an editable summary of the session](docs/screenshots/handoff.png) |

| Prompt snippets | Usage |
|---|---|
| ![The Snippets tab of the Projects view with the Edit snippet dialog open](docs/screenshots/snippets.png) | ![The Usage view with tokens per day by agent, limit history and tables by project and by agent](docs/screenshots/usage.png) |

## Supported agents

| Agent | Command | Install | Resume | Session titles and status |
|---|---|---|---|---|
| Claude Code | `claude` (`claude.exe` on Windows) | Native installer or npm | `claude -r <id>` | From Claude's session registry in `~/.claude/sessions` |
| Codex CLI | `codex` | `npm i -g @openai/codex` | `codex resume <id>` | From rollout files in `~/.codex/sessions` |
| Gemini CLI | `gemini` | `npm i -g @google/gemini-cli` | `gemini --resume <id>` | From chat files in `~/.gemini/tmp`; busy/idle from terminal activity |

Dawsha only reads the agents' own folders. It never writes to `~/.codex` or `~/.gemini`.

## Install

1. Choose your platform from the [website's Download menu](https://dawsha.pages.dev/): Windows installer or portable executable, Apple Silicon `.dmg`, or Linux x64 `.AppImage` / `.deb`. Linux packages will be available after the first release built with Linux support; unavailable downloads open the [latest release](https://github.com/mfathy234/dawsha/releases/latest).
2. On Windows, run the installer. The builds are not code signed, so SmartScreen may show "Windows protected your PC": choose **More info**, then **Run anyway**.
3. On an Apple Silicon Mac, open the `.dmg` and drag Dawsha to Applications. macOS builds are not signed unless the release workflow has Apple signing credentials configured; Gatekeeper may require you to approve the app in Privacy & Security.

Requirements: Windows 10 or 11 (x64), or Apple Silicon Mac running macOS 13 Ventura or newer. Node.js 20+ is only needed for installing Codex and Gemini through the Agents view.

The Windows installer also puts the `dawsha` command on your user PATH and removes it again on uninstall. The portable build does not touch your PATH. The Mac `.dmg` installs the app bundle in Applications.

## Updates

The installed build (`Dawsha-Setup-<version>.exe`) updates itself from GitHub Releases:

- 10 seconds after start and every 6 hours it checks for a newer release. An **Update 0.1.1** pill appears in the top bar, right of the session counts when that version is available.
- **Update now** downloads in the background (the pill shows the progress) while your sessions keep running. When it is ready the pill says **Restart to update**: **Restart now** installs it and your open sessions reopen, or choose **When I quit** and it installs the next time you close Dawsha.
- **Later** hides the pill until a newer version than the one you dismissed is found. A failed download shows **Update failed** with **Try again** and **Open GitHub**.
- The Theme popover has an **Updates** section: turn automatic checks off, see when Dawsha last checked, **Check now** and **What's new**.
- After an update Dawsha shows **What's new** once, with the changes of every version since the one you had (read from the bundled `CHANGELOG.md`). A fresh install shows the setup instead.

The portable build (`Dawsha-Portable-<version>.exe`) cannot replace itself: it tells you a new version exists and opens the release page. macOS in-app updates work for signed and notarized releases; unsigned builds must be replaced manually from the release page. Development runs never check.

Updates are not code signed, like the installer itself. Dawsha verifies the downloaded file against the SHA-512 in the release's `latest.yml` and does not require a publisher signature.

Version 0.3.0 and older have no updater: install 0.4.0 manually once, later versions arrive in the app.

## First run

On a fresh install Dawsha opens **Set up Dawsha** with two steps: add a project (a folder picker) and install your agents (it shows which CLIs it found and has an **Open Agents** button). **Skip** or **Done** closes it for good; **Getting started** in the Theme popover reopens it. You can also do the steps by hand:

1. Open **Projects** (top bar) and add a project: a name and a folder. Choose each project's default agent.
2. Sign in once to each agent you use, in any terminal: `claude`, `codex`, `gemini`. Dawsha never handles your credentials.
3. Press **Ctrl+N** (or click a project) to start a session. If an agent is not installed, open **Agents** and click **Install**.

Tip: run `dawsha .` in any folder to open it in Dawsha.

## Using it

### Shortcuts

| Keys | Action |
|---|---|
| Ctrl+K, Ctrl+Shift+P | Command palette: type to filter, Up and Down, **Tab** next group, Enter runs, Esc closes |
| Ctrl+Shift+A | Ask two agents |
| Alt+1 to Alt+9 | Insert the snippet with that number into the focused terminal, without pressing Enter |
| Ctrl+N | New session. Quick-pick: type to filter, arrows, Enter, Esc; **Tab** cycles Claude, Codex, Gemini for the highlighted project |
| Ctrl+Shift+N | Same quick-pick, preset to the agent after each project's default |
| Ctrl+Shift+R | Open the picker in **Resume** mode. Inside the picker, **Ctrl+R** toggles New / Resume, **Tab** cycles the agent filter, Enter resumes in a new pane, Shift+Enter resumes in the focused pane (after a confirmation if that tab is a running agent) |
| Ctrl+Enter, double-click header | Maximize or restore the focused pane |
| Esc | Restore the grid (while a Claude pane is busy, Esc goes to Claude instead) |
| Ctrl+Tab, Ctrl+Shift+Tab | Focus the next / previous pane (also Ctrl+Alt+Right / Left) |
| Ctrl+1 to Ctrl+9 | Focus pane 1 to 9 |
| Ctrl+Shift+Alt+Left / Right | Move the focused pane one position earlier / later |
| Ctrl+Shift+Alt+Home / End | Move the focused pane to the first / last position |
| Ctrl+Shift+J | Go to the next pane that needs you (a permission prompt first, then a finished session) |
| Ctrl+, | Open Settings |
| Ctrl+Shift+F | Find in the focused terminal: Enter next, Shift+Enter previous, Esc closes |
| Ctrl+Shift+G | Changes: review, commit, commit and push, or discard the pane's changed files |
| Ctrl+Up / Ctrl+Down | Jump to your previous / next prompt in the focused terminal (passed to the agent when there is none) |
| Ctrl+Alt+C | Copy the last reply |
| Ctrl+Alt+P | Copy the prompt you are typing, without sending it |
| Ctrl+click on a file path | Open with the matching default app; HTML in a browser; scripts in Explorer |
| Ctrl+wheel, Ctrl+=, Ctrl+-, Ctrl+0 | Zoom the focused pane (10-28, default 15), remembered per project |
| Ctrl+click on a link | Open it in the browser |
| Ctrl+C with a selection, Ctrl+V | Copy and paste. With an image on the clipboard, Ctrl+V saves it as a PNG and pastes its path (as `@path` for Gemini CLI) |
| Shift+Enter | Newline in the Claude prompt |

### Layout

| Sessions | Layout |
|---|---|
| 1 | one full pane |
| 2 | side by side |
| 3 | 2 on top, 1 wide pane below |
| 4 | 2 x 2 |
| 5-6 | 3 x 2 |
| 7+ | 3 columns, the grid scrolls |

Panes fill the layout in order. To change which session sits where, drag a pane by its header onto another pane, click **Move pane** in its header and pick a position, or use Ctrl+Shift+Alt+Left / Right. Tabs reorder by dragging them along the tab strip. Esc cancels a drag, and the order is saved with the workspace.

Drag the border between two columns or rows to resize them; panes stop at about 260 x 140 pixels. A border also takes keyboard focus: the arrow keys move it, Shift moves it further, and a double-click resets that direction to equal sizes. Sizes are remembered for each arrangement (2 side by side, 2 x 2 and so on), kept across restarts and saved with layouts. There are no borders to drag while a pane is maximized or when the grid scrolls.

**Pin pane** in a pane's ⋯ menu (or the palette) keeps it on screen: when you maximize another pane, the pinned one stays beside it as a narrow column. One pane can be pinned at a time, and the pin is remembered.

### Resuming a session

Press **Ctrl+Shift+R**, choose **Resume a session...** in the split-button menu, or choose **Resume in <project>...** in a project's menu in the sidebar. The list shows up to 50 sessions from Claude Code, Codex CLI and Gemini CLI for your projects, newest first, grouped as Today, Yesterday, This week and Older. Each row shows the agent, title, project, age and message count, and **open in pane N** when the session is already running (Enter then focuses that pane instead of starting a second copy). The right side previews the selected session: agent and model, folder, start and last activity, the first prompt and the last assistant message. A resumed pane carries a muted **resumed** chip for its first minute or until you type into it. Sessions are read from the agents' own folders, are loaded in the background and cached by file size and modification time.

### Command palette

Press **Ctrl+K** (or Ctrl+Shift+P) anywhere in the window, also while a terminal has focus. Dawsha takes Ctrl+K before the terminal sees it, because agents rarely use it on Windows; set `"paletteShortcut": "Ctrl+Alt+P"` in `settings.json` to use another key (Ctrl or Alt plus one key, and Ctrl+Shift+P keeps working). The list has five groups: **Sessions** (switch to an open pane), **Actions**, **Projects** (`Start Codex in billing-api`), **Snippets** and **Layouts**. The filter is fuzzy and also matches session titles. Up and Down move through every row, **Tab** jumps to the next group, **Enter** runs the row and **Esc** closes. With an empty filter the commands you ran last come first under **Recent**. The palette, the menus and the keyboard shortcuts read one command list, so a new action shows up in all three.

### Saved layouts

**Layouts** in the top bar lists your saved layouts. **Save current layout...** asks for a name and stores, for every pane in order, its project, its tabs (agent, label and session id), the active tab and the text size. **Open** adds the layout's panes. When panes are already open Dawsha asks first: **Replace with <name>** stops the open sessions (their files stay on disk), **Add alongside** keeps them running, **Cancel** does nothing. Tabs that have a session id resume it (`claude -r <id>`, `codex resume <id>`, `gemini --resume <id>`), the others start fresh, and a session that is already open in the grid starts fresh instead of running twice. Panes whose project was removed are skipped and reported. **Rename** and **Delete** are in the same list, and Delete names the layout in its confirmation. The two panes of an **Ask two agents** comparison are saved as plain panes without session ids, because their worktrees are temporary. From a terminal, `dawsha layouts` lists them and `dawsha open <layout>` opens one (see below).

### Snippets

Projects has a **Snippets** tab for short prompts. A snippet has a name, a text, a scope (all projects or one project) and an optional shortcut from **Alt+1** to **Alt+9**; a shortcut cannot be used twice in scopes that overlap. **Edit** and **Delete** are on each row, and Delete names the snippet in its confirmation. The text can use these variables:

| Variable | Replaced with |
|---|---|
| `{{selection}}` | the text selected in the focused terminal (the snippet is not inserted if nothing is selected) |
| `{{branch}}` | the current git branch of the pane |
| `{{project}}` | the project name |
| `{{folder}}` | the pane's folder |

Press the shortcut or choose `Insert "<name>"` in the palette to type the text into the focused terminal **without pressing Enter**, so you can read and edit it first. Multi-line text is sent as a bracketed paste when the program in the terminal has turned that on, which Claude Code, Codex CLI and Gemini CLI do, so no line runs on its own; in a terminal that has not, the lines are joined into one and a toast says so. Control characters are removed from the text.

### Ask two agents

**Ask two agents...** (Ctrl+Shift+A, the split-button menu or the palette) opens a dialog with a project, an agent for **A** and one for **B** (default Claude and Codex), a prompt and the option **Start each in its own git worktree**, which is on when the project is a git repository with at least one commit. With it on, Dawsha runs `git worktree add -b compare/<id>-a ../<repo>-compare-<id>-a HEAD` (and the same for `b`) so the two agents cannot overwrite each other; git errors show in the dialog and nothing is left behind. Both agents start with the prompt as their first message: `claude "<prompt>"`, `codex "<prompt>"` and `gemini --prompt-interactive=<prompt>`, passed as one argument without a shell. A Codex or Gemini that is installed only as an npm `.cmd` shim cannot take a prompt safely and reports that instead.

The two panes sit side by side under a shared **Compare** header with the prompt, marked **A** and **B**, with these buttons below:

- **Keep A** and **Keep B** close the other pane after a confirmation that names it, then offer to remove its worktree and branch. If that worktree has uncommitted files or commits of its own Dawsha says so and keeps it unless you confirm.
- **Keep both** unlinks the two panes and leaves the worktrees alone.
- **Diff A vs B** opens a shell tab with `git diff compare/<id>-a compare/<id>-b`, or `git diff --no-index` between the two folders when either has uncommitted files (that diff also lists the worktrees' `.git` pointer files).

A comparison survives a restart: the pair, the prompt and the worktree folders are saved with the open panes.

### Continue in another agent

The pane menu (the three dots) and the palette offer **Continue in Codex**, **Gemini** or **Claude**, whichever the pane is not. Dawsha builds a summary from what it knows: the session title as **Goal**, **Files touched** from `git diff HEAD --numstat` and untracked files, **What's done** and **What's left** from the ops feed's plan and last build or test result, **Last error** (a failed check, else the last line of the terminal that looks like an error) and the last 40 lines of terminal output without colours. You can edit all of it before **Start <agent> with this** opens a new pane in the same folder with the text as the first message. The pane you continued from keeps running, and the new one shows a muted **from <agent>** chip. The summary is limited to 6000 characters.

### Cost and time per pane

The strip under each agent pane's header shows how long the session has run and its tokens, read from the agents' own history files, plus the cost of Claude Code sessions, which comes from live session info (Settings > Notifications & session info). Codex CLI and Gemini CLI show tokens only. Each project in the sidebar shows today's total under its name, with a breakdown by agent on hover; it is hidden when the project has no usage today. The numbers refresh every minute and when a session finishes.

### Changes: commit and push

**Ctrl+Shift+G**, **Changes...** in a pane's ⋯ menu, or a click on the git changes in the strip under the header opens the pane folder's changed files: staged, unstaged and untracked, each with its status, +/- counts, a checkbox and **Show diff**. The header shows the branch, its upstream and how far ahead or behind it is. Write a message (the first line shows a 72 character hint) and press **Commit** to commit only the checked files, or **Commit and push** when the branch has an upstream. **Discard...** asks first and names the files on the message and the button; tracked files go back to the last commit and untracked files are deleted. Git's own message shows in the panel when a hook fails, the message is empty or the push is rejected. Hooks always run.

### Git quick actions

Click the branch in a pane header, or search the palette, for **Pull**, **Fetch**, **Switch branch...**, **Stash changes** and **Apply last stash**. They act on the pane folder. The branch shows `↑2 ↓1` when it has an upstream that is ahead or behind.

- **Pull** only fast-forwards. When the branches have diverged it shows git's message and changes nothing.
- **Switch branch...** lists local branches, newest first, then remote branches (picking one creates a tracking branch). Type a new name to create a branch from the current one; invalid names are refused with the reason. When uncommitted changes block the switch, **Stash and switch** stashes them first and **Apply last stash** brings them back.
- **Apply last stash** keeps the stash when applying it conflicts.

### Project instructions

Projects > **Instructions** lists a project's `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex CLI) and `GEMINI.md` (Gemini CLI) with their size and last change. **Edit** opens a file in an editor with Save (Ctrl+S) and Revert; line endings are kept. When the file changed on disk since you opened it, Save stops and offers Reload, or Overwrite after a confirmation that names the file.

**Shared instructions** are written once and kept between `<!-- dawsha:shared:start -->` and `<!-- dawsha:shared:end -->` in every file that exists; tick a missing file to create it. A preview lists what will change before **Apply to all files**. Text outside the markers is never touched. **Edit project instructions** in the palette opens the tab for the focused pane's project.

### Context warnings

When a session reports its context use (Claude Code with live session info, Codex CLI from its own files), the gauge in the strip turns amber at 80% and red at 90%. At 90% a line under the header offers **Compact**, which types `/compact` for you to send, and **Dismiss**, which hides it until 95%. A notification arrives once per session when it crosses 90% and the window is not in front.

### Dropping files into a terminal

Drag files or folders from Explorer onto a pane: their paths are typed into the tab under the drop, separated by spaces, quoted when they contain spaces and as `@path` for Gemini CLI. Nothing is sent until you press Enter. Up to 20 files per drop.

### Finding text in a terminal

**Ctrl+Shift+F** (or **Find in the terminal** in the palette) opens a find bar over the focused pane. It counts the matches ("2 of 3"), and has switches for match case, whole word and regular expressions. Enter or F3 goes to the next match, Shift+Enter to the previous one, and Esc closes the bar and returns to the terminal. Selected text fills the box when the bar opens.

### Working with terminal output

- **File paths** such as `src/invoices/totals.ts:42:7`, `src\app\main.ts(10,5)` or an absolute path become links when the file exists. Ctrl+click opens images and ordinary files with their default app, HTML in the default browser, and only reveals programs and scripts in Explorer rather than running them.
- **Prompts**: each prompt you send is marked. **Ctrl+Up** and **Ctrl+Down** scroll to the previous or next one; when there is none in that direction the keys go to the agent as usual.
- **Copy last reply** (**Ctrl+Alt+C**, the ⋯ menu or the palette) copies everything after your last prompt, with wrapped lines joined.
- **Copy current prompt** (**Ctrl+Alt+P**) copies what is in the agent's input box before you send it, read from the screen; when no input box is found it copies what you typed since your last Enter. Nothing is sent or cleared.
- **Save selection as a snippet** opens the snippet dialog with the selected text.
- **Clear scrollback** empties the pane's history without restarting the agent.

### Highlight rules

Lines that contain `error`, `failed`, `exception` (red), `warning` (amber) or `passed`, `✓`, `success` (green) get a tint and a bar on the left as output arrives. Settings > Highlights turns this off and edits the rules: a word or a regular expression and a color, up to 30 rules. **Reset to defaults** asks first and names the rules it replaces.

### Exporting a transcript

**Export transcript...** in a pane's ⋯ menu or the palette saves the active tab's session. Pick Markdown or HTML in the save dialog. The file starts with the title, agent, model, project, folder, times and session id, then lists the prompts and replies in order, with each tool call on one line. If the folder is a git repository, a **Changes** section with `git diff --stat` follows. The HTML file is a single page that works offline. A tab without a session file exports the visible terminal text instead and says so.

### Settings

Open **Settings** in the top bar or press **Ctrl+,**. Its sections are **General** (the palette shortcut, the sidebar, Getting started), **Highlights**, **Notifications & session info**, **Agents** (full access per agent, the same switches as in the Agents view), **Updates** (version, automatic checks, Check now, and Download / Install when available), **Changelog** (every release, newest first, also reachable from the What's new dialog) and **About** (links, the data folder and the files Dawsha keeps there). The Theme menu holds the themes and the background image.

### Usage

**Usage** in the top bar shows what your agents used over **Today** (per hour), **7 days** or **30 days** (per day). Everything is read from the agents' own folders, off the interface thread and cached by file size and modification time:

- Claude Code: `~/.claude/projects`, the `usage` of each assistant message (streamed messages count once). Tokens are input, output and cache writes; cache reads are listed apart.
- Codex CLI: `~/.codex/sessions`, the running `token_count` totals turned into amounts per hour. Tokens are uncached input plus output; cached input is listed apart.
- Gemini CLI: `~/.gemini/tmp/*/chats`, the token counts of each reply (uncached input, output, thoughts and tool tokens).

The chart stacks the three agents and switches between **Tokens** and **Cost**. **By project** assigns each session to the project whose folder contains its working folder (anything else is **Other**) and shows sessions, tokens, cost and the busiest agent; **By agent** shows sessions, tokens, cache reads and cost. Dawsha never invents a price: cost is shown only for Claude Code sessions that reported one through **Show live session info**, which Dawsha keeps per session in `usage-history.json` so it stays after the status files are cleaned up (it is counted on the day the cost last changed). Codex and Gemini show `n/a`. The same file keeps a history of the 5 hour and weekly limit readings (a new one when a percentage changes or after 15 minutes, newest 3000 kept), drawn as **Limit usage**; it starts on the day you turn the live info on. When a folder is missing, a range is empty or no cost was reported, the view says so instead of showing a blank chart.

### The dawsha command

`dawsha` talks to the running app over a local named pipe (`\\.\pipe\dawsha-<user>`) and starts Dawsha first if it is not running. Nothing stays in the background when Dawsha is closed. It prints to the terminal you ran it in and exits non-zero on errors.

| Command | What it does |
|---|---|
| `dawsha` or `dawsha open` | Open Dawsha, or bring it to the front |
| `dawsha open <layout> [--replace\|--alongside]` | Open a saved layout (a name, in any case, or with dashes for spaces). When panes are open it asks in the app unless you give `--replace` (stop them first) or `--alongside` (keep them) |
| `dawsha layouts` | List saved layouts with their pane counts and projects |
| `dawsha .` | Add the current folder as a project if it is new (name = folder name, default agent Claude) and start its default agent in a new pane |
| `dawsha start <project\|path> [--agent claude\|codex\|gemini] [--here]` | Start a session; a path is added as a project if it is new. `--here` opens it as a tab in the focused pane when that pane belongs to the project |
| `dawsha resume [project] [--last] [--agent <agent>]` | Open the resume picker for a project (default: the project of the current folder), or with `--last` resume the newest matching session |
| `dawsha ls` | List projects with their default agent, folder and open session count |
| `dawsha sessions [project]` | List earlier sessions: agent, title, last activity, short id |
| `dawsha add <path> [--name <name>]` | Add a project |
| `dawsha update-agents` | Update the installed agents in a visible shell tab |
| `dawsha --help`, `dawsha --version` | Usage and version |

```
PS C:\work\acme-web> dawsha start billing-api --agent codex
billing-api: started Codex in pane 3
PS C:\work\acme-web> dawsha resume --last --agent claude
Resumed 'Add dark mode toggle' (Claude Code) in pane 4
```

### Closing

Closing a pane or removing a project asks for confirmation that names the session or project, then stops the whole process tree. Quitting stops all terminals but remembers which panes were open.

### The Agents view

Open **Agents** in the top bar. Each row shows the installed version (`<cli> --version`), the latest version (`npm view`, cached for 30 minutes, checked in the background at start) and a state: not installed, update available or up to date. **Install** and **Update** run the exact command, shown by **Show command**, in a new visible shell tab named like `update codex`, in the focused pane (or a new pane titled Agents). When the tab's process exits the versions are re-checked and a toast reports the result. **Update all** runs the updates one after another in one tab.

| Agent | Install | Update |
|---|---|---|
| Claude Code | `irm https://claude.ai/install.ps1 \| iex` | `claude update` (native install) or `npm install -g @anthropic-ai/claude-code@latest` (npm install) |
| Codex CLI | `npm install -g @openai/codex@latest` | same |
| Gemini CLI | `npm install -g @google/gemini-cli@latest` | same |

npm-based commands need Node.js 20+; without it the row shows "Needs Node.js 20+" with a link instead of a button. Nothing runs until you click.

**Start with full access** under each agent decides whether new sessions skip the agent's approval prompts. It is on for Claude Code and Codex CLI and off for Gemini CLI until you change it, and applies to sessions started after the change. Dawsha passes the agent's own flag:

| Agent | Flag |
|---|---|
| Claude Code | `--dangerously-skip-permissions` |
| Codex CLI | `--dangerously-bypass-approvals-and-sandbox` (no sandbox either) |
| Gemini CLI | `--yolo` |

With it on the agent edits files and runs commands without asking, so turn it off for folders you do not trust.

## Status-line bridge and ops feed (opt-in)

Both are optional and off until you turn them on.

**Live session info (status-line bridge).** Claude Code runs a status-line command with the session as JSON on stdin. The Theme popover toggle **Show live session info** installs a small script (`bin/statusline-bridge.js` inside Dawsha's user-data folder, run with `node`) as `statusLine` in `~/.claude/settings.json`. It first shows a confirmation naming that file and your current status line. The previous value is kept in `bin/bridge-state.json` and a full copy in `settings.json.dawsha-backup`; turning the toggle off restores it (a status line you changed after install is left alone). The script saves each payload to `status/<session_id>.json` and then runs your previous status line with the same input, so it keeps working. A settings file that is not valid JSON is reported and never touched. This is the only file Dawsha edits outside its own folder.

**Activity and optional ops feed.** Each live pane discovers activity from its own app-launched process tree, so the activity drawer works for Claude, Codex and Gemini without a mod. A Claude Code mod can additionally write a snapshot to `ops/<sessionId>.json` inside Dawsha's user-data folder (the legacy Claude Grid ops folder is read too). Dawsha only reads these files: it polls every second, keeps the last good parse of a file that is mid-write, ignores unknown fields and needs only `v`, `sessionId` and `updatedAt`. A snapshot belongs only to the pane whose Claude session ID matches and adds plan and sub-agent detail. Context and available rate limits are displayed per pane; unavailable limits are not borrowed from another agent.

## Data and privacy

Everything is in the Electron user-data folder: `%APPDATA%\Dawsha` on Windows or `~/Library/Application Support/Dawsha` on macOS:

- `settings.json`: projects, theme, notification toggles, sidebar state, the open-panes workspace, saved layouts, snippets and the palette key.
- `usage-history.json`: the last cost of each Claude Code session that reported one and the 5 hour and weekly limit readings, for the Usage view (written only when the live session info is on).
- `bin\` and `status\`: the status-line script and the saved status payloads (only when the live toggle was used; files older than 7 days are removed).

Dawsha has no telemetry and makes no network calls except the Agents view looking up the latest CLI versions (`npm view`, or the npm registry when npm is missing). Agent session files are only read. Dawsha uses its own `%APPDATA%\Dawsha` folder, separate from Paneon and Claude Grid. An explicit `DAWSHA_LEGACY_USER_DATA` path can import settings from an earlier installation.

## Build from source

```bash
npm install
npm run dev          # development with hot reload
npm run build        # type-check and build into out/
npm run package      # platform package: Windows exe or macOS dmg/zip in release/
npm run icons        # regenerate build/icon.ico and build/icon.png from src/renderer/assets/logo.svg
npm run screenshots  # regenerate docs/screenshots from fake demo projects
```

Requirements: Windows, macOS or Linux, Node 24. The Electron binary downloads on first use. Windows packaging writes the Setup and Portable executables. macOS packaging writes a DMG and ZIP for the host architecture; unsigned local builds use `-c.mac.identity=null -c.mac.hardenedRuntime=false`. Signed macOS releases require Apple Developer ID certificate and notarization secrets in GitHub Actions. On Linux, `npm run package -- --linux --x64 --publish never` creates AppImage and Debian packages. Linux shells use `$SHELL`, falling back to `/bin/bash`; `DAWSHA_SHELL` overrides this choice. Linux package execution must be verified on a Linux host before release.

## Testing

```bash
npm test             # unit tests (vitest), then the Electron end-to-end tests (Playwright)
npm run test:unit
npm run test:e2e
```

The end-to-end tests launch the built app with a temporary user-data folder and fake agent commands, so they never touch your real settings or agent folders.

| Variable | Effect |
|---|---|
| `DAWSHA_CLAUDE_COMMAND`, `DAWSHA_CODEX_COMMAND`, `DAWSHA_GEMINI_COMMAND` | Replace an agent's command. Resume arguments are not added when set. |
| `DAWSHA_CLAUDE_ARGS`, `DAWSHA_CODEX_ARGS`, `DAWSHA_GEMINI_ARGS` | Arguments for that command, space separated or a JSON array. |
| `DAWSHA_SHELL` | Replaces the shell used by Shell tabs and Agents-view commands. |
| `DAWSHA_USER_DATA` | Use another user-data folder. |
| `DAWSHA_LEGACY_USER_DATA` | Explicitly import settings from this older user-data folder. |
| `DAWSHA_SESSIONS_DIR` | Read Claude session files from another folder. |
| `DAWSHA_CLAUDE_HOME` | Use another folder instead of `%USERPROFILE%\.claude`. |
| `DAWSHA_CODEX_HOME`, `DAWSHA_GEMINI_HOME` | Read Codex or Gemini sessions from another folder. |
| `DAWSHA_OPS_DIR` | Read ops snapshots from this folder only. |
| `DAWSHA_PIPE` | Name of the named pipe the `dawsha` command uses (default `\\.\pipe\dawsha-<user>`); set it to run a second, isolated instance. |
| `DAWSHA_EXE`, `DAWSHA_APP_ARGS` | The `dawsha` command: program and JSON array of arguments used to start the app when no pipe answers (default: the Dawsha exe itself). |
| `DAWSHA_UPDATE_START_DELAY_MS`, `DAWSHA_UPDATE_INTERVAL_MS` | Tests: delay of the first update check and the gap between checks (default 10 s and 6 h). |
| `DAWSHA_TEST_UPDATER`, `DAWSHA_TEST_UPDATER_SCRIPT`, `DAWSHA_TEST_UPDATER_LOG` | Tests: `fake` replaces the GitHub updater with a scripted one (JSON script) and logs `quitAndInstall` calls to the file. |
| `DAWSHA_APP_VERSION` | Tests: the version the app reports (the e2e runs report the package version). |
| `DAWSHA_OPEN_LOG`, `DAWSHA_NOTIFY_LOG` | Tests: append open-in-editor and notification requests to a file instead of acting on them. |

## Project layout

```
src/shared     types, agents, settings schema, layout, session matching, status-line and ops-feed parsing,
               agent install/update logic, needs-you state machine, themes, contrast, resume index and
               session details, command-line parsing and command handling, command palette matching, layouts, snippets,
               comparison and handoff helpers, usage parsing and aggregation
src/main       window, pty manager, agent launch, settings store, user-data migration, watchers, status-line bridge,
               agent version checks, resume lists and the cross-project session index, git, notifications,
               command-line pipe server and runner, git worktrees for comparisons, usage scan and history, IPC
src/preload    typed bridge exposed as window.gridApi
src/renderer   app shell, sidebar, grid, pane, quick-pick, resume picker, onboarding, projects and agents views,
               command registry and palette, layouts menu, snippets, comparison pair, handoff and usage views,
               theme picker, dialogs, command host
build          icons, the dawsha launcher (dawsha.cmd, dawsha-cli.cjs) and the installer PATH script
tests/unit     vitest
tests/e2e      Playwright _electron tests (temp user-data, fake agent commands, the dawsha command over a test pipe)
tests/screenshots  the harness behind docs/screenshots
scripts        icon generation
```

## Notes

- `node-pty` is the Microsoft package (1.1.0). Its N-API bindings are built or selected for the host platform during `npm ci`.
- The xterm WebGL renderer is used when available; xterm 6 has no canvas addon, so the fallback is the DOM renderer.
- Releases are built by GitHub Actions from a `v*` tag. The GitHub release body is the matching `CHANGELOG.md` section, and the same text is embedded in `latest.yml` so the in-app notes match.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © 2026 Mohamed Fathy
