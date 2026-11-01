# Changelog

All notable changes to Dawsha are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [1.8.2] - 2026-11-01

### Added

- **Choose whether the session you pick moves.** A new switch in Layouts and Settings, "Move the session I pick to the large spot", is off by default. Off, the large session stays put and selecting a side session just focuses it. Make large, in the pane menu, the command palette and on Ctrl+Alt+L, changes the large session on purpose.
- **A warning before you hit a limit.** You get one notification when a limit crosses 80%, and it re-arms after the limit drops or resets.
- **A branch switcher in the pane footer.** Click the branch to find, switch to or create a branch. Pull, Stash, Apply last stash and Fetch are in the same menu.
- **Add big new folders to .gitignore.** A big folder of new files folds into one row in Files and Review with its size, and an Add to .gitignore button.

### Changed

- **Limits take far less room.** The top bar shows one lettered ring per limit: 5h, W for week and a model letter when one is reported. Rings turn amber at 80% and red at 95%, and a click still opens the details.
- **Only agents you have.** Limits and Usage hide agents that are not installed, unless a session you have focused uses one.
- **One less row above your sessions.** Grid and Board moved to the top bar, next to a View menu with Layouts, Dim other sessions, Text size and session counts. Session tabs keep their own row.
- **A slimmer Other sessions rail.** It is 34px wide, with a count instead of a vertical label.
- **A clearer branch button in Files.** The branch name is now the button, with a filter that can also create a branch, and worktrees have their own button.
- **Stash before switching.** With uncommitted changes, every branch switch now asks you to stash first and names the files and the branch. New files stay in your folder unless you tick the box.
- **The top bar fits narrow windows.** Below about 1100px, pages become icons and New session becomes a + button.

### Fixed

- The selected card in Layouts looked quieter than the unselected one.
- Fields in Files had a clipped, doubled border.

## [1.8.1] - 2026-10-31

### Added

- **Switch branches from Files.** A branch button next to the branch name lists your local branches, newest first, and the remote ones you have not checked out yet, with a filter when the list is long. Pick one to switch to it. If you have changes, Dawsha asks first and names the branch. Git is never forced, and if it refuses, Dawsha shows why and changes nothing. New branch… creates one from where you are, and Switch branch… is in the command palette.

### Changed

- **Quieter buttons.** One button style everywhere. Mint is kept for the main action on each screen, and the rest are grey or plain text. Hover is a soft step in the button's own shape, and a selected tab is a lighter surface instead of mint text or a mint ring.
- **Needs you is said once.** A session waiting on you has a thin amber ring and the amber diamond, without a tinted header. The pulse runs three times, then holds still.
- **A calmer approval card.** Allow is the light main button with its Enter key, Allow always is grey, and Deny is plain text with Esc.
- **One-row pane headers.** The number, title, agent and session name sit on one line, with the state and buttons on the right.
- **A flatter sidebar.** Projects are plain rows, the selected session is a lighter row without a border, and titles stay on one line.
- **Shortcuts as keycaps.** Menus, the command palette and the New session picker show each key on its own small key.
- **Usage reads cleaner.** Missing values show as a dash with one note under the table, column headings are no longer in capitals, and By project has a bar for each project.
- **Agents without repeated labels.** The Built in label on every card is gone, roles sit under the name so they are not cut off, and Maya's goal form fits on one row.
- **Fewer type sizes and weights.** Text uses six sizes and two weights, with no italics for emphasis and spacing on a 4px grid.

## [1.8.0] - 2026-10-30

### Added

- **Two grid styles for sessions.** Calm focus, the default, shows one large focused session. Mission control shows equal tiles. Switch in Settings > Appearance, or from the Layouts popover.
- **An approval card that says what it is asking.** A session waiting on you has an orange edge and a card showing the tool, the command and the project, with Allow, Allow always and Deny.
- **Agent pages.** Each agent opens as its own page, with its purpose, model, last run and a Run button, and a Live tab while it runs.
- **Locate a missing folder.** When a project's folder has moved, the sidebar and Projects offer Locate instead of leaving it broken.
- **Settings search.** Find any setting from the search box at the top of Settings, which is now split into sections.
- **Commit details.** In Files > Activity, click a commit to see its author, date, branch, full message and changed files, with each file's diff inline or side by side, and open a file as it was at that commit.
- **Linked skills in Skills.** Skills show their descriptions, and skills kept in a linked folder (a symlink or junction into a synced folder) are now listed, marked Linked.

### Changed

- **A new look.** Dawsha has a new type, colour and spacing system, with Geist and JetBrains Mono bundled so text looks the same on every computer. Buttons, tabs, menus, dialogs, toggles and dropdowns share one style. The light theme is readable, with terminal text at least 4.5:1 against its background.
- **Agent marks are letter tiles.** Claude, Codex and Gemini show as small C, X and G tiles in their colours everywhere in the app.
- **Work and Projects count worktrees under their project,** and Projects lists each project's worktrees beneath it.
- **A top bar with the pages in it.** Sessions, Agents, Files, Work and Skills sit in the top bar, with the page you are on highlighted, next to one usage strip. The More menu is gone; the secondary pages are in the Dawsha menu.
- **Cleaner panes.** Each pane has a clean header and a grouped menu of 13 items. Other actions are in the command palette. Footers appear only when they have something to show, and the details panel slides over the terminal instead of pushing it aside.
- **A sidebar built around your work.** The project tree lists sessions by their task, with a Waiting on you block at the top. Resizing the sidebar works again.
- **Agents with a clear roster.** Maya's goal box sits on top, with the agent cards below. Maya the Lead is shown on her own, so the counter matches the sections.
- **Files shows one diff look.** Discard is kept apart from Commit, so a click on one cannot be mistaken for the other.
- **Clearer What's new.** Each release lists its sections and bullets, so you can scan what changed.
- **Every dropdown uses Dawsha's own menu,** so they look and behave the same everywhere.

### Removed

- **The More menu** in the top bar. Its pages now live in the Dawsha menu.
- **The Paneon settings import.** It is no longer offered in Settings > Import.

### Fixed

- Diffs outside the Changes dialog show their added and removed lines in colour again.
- A compare diff shows its output in the pane instead of waiting at git's pager.
- The Claude plan shown with your account matches the account (Team, Max or Pro).
- Clicking a button in a pane header no longer moves that pane into the large slot.
- The account shown is the one you are signed in with after you switch Claude accounts.
- The top-bar text size buttons (− and +) set one size for every pane.
- Quitting Dawsha closes all of its own background processes, so none is left running after it exits.
- Settings > Import opens its file picker at your Desktop.

## [1.7.6] - 2026-10-29

### Added

- **Agents you keep.** The Agents tab is now your crew. Each agent has a name, role, colour and its own instructions, prompt fields, model, permissions and projects.
  - Eight built-in agents ship with Dawsha: Maya (Lead), Sami (code reviewer), Tarek (debugger), Omar (builder), Hana (tester), Lina (UI polisher), Nour (docs and releases) and Yara (explainer). Duplicate one to change it.
  - Run an agent in any project and pick the model for that run: Claude Fable, Opus, Sonnet or Haiku, Codex or Gemini. Each run opens as a normal session titled with the agent's name, for example "Sami · PR 8841".
  - Runs start lean by default, without your MCP servers. That was about 40% cheaper in our tests than running the same instructions as a skill.
- **Live state on every agent.** An agent's avatar breathes while it works, flashes when it needs you, flashes once when it's done and shows ✕ when it fails, always with a word too. The top bar shows who is on a job, and sessions, the sidebar, Waiting on you and notifications show the agent's name and avatar.
- **Maya, the Lead.** Give Maya a goal and a project:
  - She proposes a plan: who does what, on which model, at what estimated cost.
  - Once you approve it, she runs the agents as normal sessions and shows them as lanes on a board.
  - She asks you before pushing, merging, posting comments or deleting.
  - Dawsha itself enforces her limits: how many agents run at once (2 by default), a budget per goal ($3 by default) and which agents she may use. Change them under "How she leads".
- **Import your agents.** Bring in `~/.claude/agents`, your skills and your Codex prompts. They stay linked to their files.
- **Turn any skill into an agent.** In Skills, "Make an agent" fills in the name, role, fields, permissions, projects and paste patterns from the skill. Every choice says why it was made.
- **Hand a job to an agent.** From New session ▾, paste a correlation id with "on dev", a pull request link or a build link, and Dawsha suggests the agent with its fields filled in.
- **`dawsha crew` commands:** list, run, status and result. The Lead also uses plan, ask and note.
- **Agents on your phone.** Remote Access has an Agents tab: run one of your agents on your PC from the phone, and follow what's on a job and the goal Maya is working on. It's behind a new "Run agents" phone permission, which is off by default.
- **Remote Access status.** Remote Access says plainly whether your phone can reach this PC. It notices a dropped tunnel in about ten seconds instead of two minutes, and offers Reconnect. It can also reconnect on its own, and tell you when the link changes.

### Changed

- **The Remote Access page is rebuilt.**
  - Connect a phone, the connection details, and your phones, where Remove asks first and names the phone.
  - What a phone can do, now enforced on the PC.
  - A recent activity log.
  - The PIN email has a clear description, and once saved it offers Change and Remove.
- **The phone app is refreshed.** Real agent logos, filled cards, big buttons and a light theme, with no capital-letter labels or pills.
- **Files:**
  - The outline and activity panel has its own Hide button.
  - The worktree switcher is shown on the location button ("3 worktrees") and is also in the palette.
  - Loading states and Retry replace empty panels.
  - Markdown previews keep even line spacing.

### Removed

- **The old Agents tab.** The list of background sub-agents, its detail pane, timeline and running counts are gone, replaced by your agents.

### Fixed

- Agent instructions can no longer reach the Windows command shell when Claude is installed through npm. Dawsha starts the real Claude program instead.
- Imported settings can no longer bring agents with full access silently. They become "ask" unless you choose to keep full access.
- Secrets in commands are masked in the Remote Access activity log.
- Switching projects, worktrees or files quickly in Files could show an older result over the newer one.

### Known issues

- A Lead session that you resume later no longer has her goal limits. Start a new goal instead.

## [1.7.5] - 2026-10-29

### Added

- **Problems tab in Files.** Errors from your runs show as clickable `file:line` rows, grouped by file. It reads TypeScript, ESLint, `dotnet build`, and Vitest or Jest failures. Send one problem, or all of them, to an agent's prompt without sending it.
- **Review from a session.** A "Review N files" button in a session's footer opens Files in Review mode on exactly what that session changed.
- **Drag projects in the sidebar in any sort order.** Dropping a project switches to your own order, starting from the order you saw. Pinned projects stay on top. Alt+Up and Alt+Down move the focused project, and the narrow rail can be reordered too.
- **Codex limits.** Codex's 5-hour and weekly limits now show in the usage meter and its popover. Dawsha reads them from Codex's own session files, so they show even with no Codex session open.
- **Limits without a session.** The popover lists every agent's last known limits with their age ("updated 2h ago"), and windows that have already reset are marked as reset. With no agent session focused, the meter shows the agent closest to its limit.
- **Which account each agent uses.** The limits popover shows the signed-in email and plan under each agent, for example "you@example.com · Max", or "API key" or "Not signed in". Dawsha reads only the email and plan name, never your login tokens, and calls no online service for this.
- **`npm run release:check`** checks a release in one go: the version and changelog, the tag, every download, the release build and the website.

### Changed

- **A clearer projects sidebar.** Projects with open sessions sit on their own cards at the top, then pinned projects. Projects without sessions are listed below as compact rows with their branch. Session names wrap to two lines instead of being cut off, and the age moves to the status line. Project costs read "· $74.57 today", and closed sessions collapse to a small "N closed" row.
- **A much smaller app.** With voice dictation gone, the app no longer ships the speech engine. The interface code shrank from 28 MB to 3.7 MB, and the installers are smaller.
- **HTML previews run their scripts**, so interactive mockups work inside Files. They load from a private local address with no network access, and can't reach your other files or the app.
- **Exact line authorship.** Marks on changed lines show exactly which session wrote each line, where the session's edits allow it. Estimated marks are dimmed and say "About".
- **Compact usage meter on narrow windows.** It now shows the agent and its busiest window (for example "62%") instead of disappearing below 1220 pixels. The popover lists model-specific windows, such as Opus week, by name.
- **Real Claude, Codex and Gemini logos** wherever an agent is shown, including the phone app, the timeline search and the Work list.
- **Menus open next to their button** and flip near the window edges instead of opening to the right.
- **"N running" in a session's footer** opens the Agents view filtered to that session. The small activity drawer it replaced is gone.

### Removed

- **Orchestrator.** The lead-agent runs, Boards, History and Settings > Orchestrator are gone, and the Work dashboard counts only sessions. Settings and layouts from older versions still load. Run archives already on disk are left alone, and Dawsha no longer reads them.
- **Voice dictation.** The microphone button, its settings and the speech model are gone. On first start Dawsha deletes the downloaded speech model, and nothing else. Dawsha no longer asks for microphone access.

### Fixed

- The sidebar's pin icon no longer sits under the + and ⋯ buttons on hover. It now follows the project name.
- Pressing Enter right after opening the new-session picker could start nothing.
- Quitting could wait up to ten seconds for the window, and a session starting during quit could outlive the app.

## [1.7.4] - 2026-10-29

### Added

- **Files Search:** press Ctrl+Shift+F in Files to search the selected checkout. Files you ignore in Git are skipped. Search can match case, whole words or a regular expression, and limit to an include pattern. Results are grouped by file; click one to jump to that line.
- **Files Review:** step through an agent's changed files and click a `+` line to leave a comment. Send to agent types every comment, with file and line, into that session's prompt without sending it, so you press Enter. Review also has Commit… with a drafted message and file selection, and Discard file…, which asks first.
- **Agent marks in Changes:** added lines show which session or agent wrote them, with the task and time when you hover.
- **Previews:** Markdown opens as a readable preview with a Source switch, and HTML shows as a static preview with Open in browser. Images show a preview, and changed images get a drag-to-split Compare with main.
- **Send to agent** in Files lists the project's live sessions by name, then New session with this file and Copy as @mention.
- **Files bottom panel:** run commands moved to a bottom panel, with a tab for each run, Restart, Stop and a Problems tab. The status bar shows what is running and on which port.
- **Linked repos:** the Files location menu lists other repos your sessions edited alongside this project.
- **Agents details:** the Agents view has a details pane on the right. It shows the agent's task, its live tool calls or result, the files it touched (click one to open it in Files), and tokens, cost and model.
- **Agents timeline:** a Timeline view shows which agents ran side by side and for how long.
- **Usage limits for every agent:** click the usage meter to see Claude, Codex and Gemini limits with reset times and how old each reading is.
- **Sidebar:** a Waiting on you section at the top lists sessions blocked on you, across all projects.

### Changed

- **Projects sidebar:**
  - Projects show their branch and a quiet "2 live" or "needs you". The + and ⋯ buttons appear on hover or keyboard focus, and a click on a project folds it.
  - Sessions show their full name, their age and a status word.
  - The filter sits behind the search icon (Ctrl+Shift+O).
  - Sort by recent activity, name or your own order, and hide projects without sessions.
  - The narrow rail shows each project's initials and opens its sessions in a flyout.
  - The project menu has Open in Files, Rename and Remove from Dawsha. Remove asks first and says the folder stays on disk.
- **Agents:** one All · Running · Failed · Done filter with counts, flat rows whose second line shows the latest tool call or the result, and Export as Markdown in the ⋯ menu.
- **Files layout:**
  - One button at the top shows the project, branch and worktree.
  - The explorer has Files, Search and Review modes, with foldable Changes and Open in sessions sections.
  - The toolbar is down to File/Changes, Send to agent and ⋯.
  - An inspector shows the outline and the agents and commits that touched the file.
- **Dawsha Cards:**
  - Slightly lighter, clearer layers.
  - Terminals sit flush in their cards instead of a dark inset well.
  - The focused session has a soft neutral ring instead of a green outline, other sessions are a little dimmer with a hollow cursor, and a session that needs you has a solid orange ring.
  - Done is sage green, so the bright green is only for buttons and the cursor.
- Other derived dark themes get the same clearer layers. Graphite Cards and Nord have slightly brighter secondary text so it stays readable.
- **Highlights:** rule colours are swatches you can see, with a live preview, instead of a plain dropdown. The remaining plain dropdowns use Dawsha's own menus.

### Fixed

- The usage meter showed another agent's limits when the focused session had none. It switched between Claude and Codex numbers without saying whose they were. It now names the agent, and says "no limits reported" rather than borrowing numbers.

## [1.7.3] - 2026-10-27

### Added

- Files has a branch/worktree dropdown. Select an existing checkout to browse it without switching a Git branch or moving an agent. Open files and unsaved edits stay with their own checkout.
- Delete a file or folder from its Files context menu, with confirmation and the system Recycle Bin or Trash. Unsaved edits are named before deletion; permanent deletion is never used as a fallback.
- Run commands from Files in the selected checkout. Dawsha detects .NET solutions, runnable projects and launch profiles, and Node package scripts. Review or edit a command, save a local override, or add your own when detection cannot find it.
- Each run has separate output, status and Stop controls. Runs keep their original working directory when you browse another checkout.

### Changed

- Agents groups use compact headers, quieter separation, and summaries beside each title. Running, done and failed states have readable colours in dark and light themes, with text labels as well.

## [1.7.1] - 2026-10-27

### Added

- Session groups in the Agents tab fold. Groups with running or failed agents stay open, and finished ones fold to one line, such as "31 agents · 31 done". Click a header or press Left and Right to fold or unfold, or use Expand all and Collapse all. Dawsha remembers each group.
- Ctrl+Shift+J jumps to the next session that needs you. Ctrl+J still adds a new line in Claude Code.
- Files: a click opens a file in the preview tab, and Ctrl+click opens it in a new tab. Ctrl+click on a file path in a terminal opens it in Files at that line.
- Files: code is coloured like VS Code's Dark+ and Light+ themes for every language, and files show type icons in the tree and tabs.
- Right-click a file in the tree, a tab or a file path in a terminal to open it in Files or in a new tab, add it to the prompt, copy its path or relative path, open it in VS Code or show it in File Explorer.

### Changed

- Clear structure without borders. The window has distinct layers: the canvas, the top bar and sidebar, the panes, and popups. Terminals sit in a recessed well. Thin seams appear only where whole areas meet.
- The focused session has a green ring, a bold title and a raised header. A session that needs you has a dashed orange outline and says "Needs you".
- The top bar shows Sessions, Agents, Files and More. Projects, Usage, Work, Orchestrator and the other views are under More.
- The 5-hour and weekly limits show their battery gauges again, which turn yellow at 70%, orange at 80% and red at 90%.
- Focus rings show only when you use the keyboard, not after a click.
- In the light theme, terminals are light. The "Dawsha Daylight, dark terminal" theme keeps a dark one.
- Settings, the board, Files and the Agents tab follow the same layers. The orchestrator board no longer uses a coloured side stripe.
- Built-in themes without their own well (Dawsha Cards, Graphite Cards, Nord, GitHub and others) now use the shared layer ladder, so their backgrounds shift slightly.

### Fixed

- Closing the pane actions menu with Escape returns focus to its button, so the command palette shortcut works immediately.
- Agents group fold choices are saved with the app settings and survive a quick quit and relaunch.

## [1.7.0] - 2026-10-27

### Added

- The Files view, a light editor beside your sessions. It is a new tab after Agents, opened with Ctrl+Shift+E. It shows a file tree for each project and worktree with git badges (M, A, D) and the filters All, Changed and Open in sessions.
- Files open read-only, so you can select and copy freely. The Changes toggle shows what changed since main, and back. Press E or Edit for a small edit and Ctrl+S to save. If an agent changes the file meanwhile, a bar offers Reload theirs or Keep mine. Deleted files open on their changes.
- File tabs, preview or pinned, are remembered for each project.
- The right panel of the Files view lists the sessions that touched the file and an outline of it.
- Add to prompt types @path, with the selected lines, into the focused session. Open in VS Code and Copy path are there too. Only files inside your projects can be read or saved.
- Ctrl+P quick open works from anywhere, terminals included, with a preview. Enter opens the file in Files, Alt+Enter adds it to the prompt and Ctrl+Enter opens it in VS Code.
- Sessions get a tag colour automatically. It comes from the branch (feature/ is Feature, fix/, bug/ and hotfix/ are Bug, and docs/, review/ and research/ match their tags) or, without a branch, from the conversation title in English and Arabic words. A tag you set always wins, and closed sessions keep their branch. The Tag colours setting and a command in the palette turn the colours off.
- A Dim others switch in the top bar. Dimming is now off by default.
- A setting to hide the one-line recap.
- A right-click menu with Copy, Cut and Paste in text fields and the editor.

### Changed

- The context battery turns yellow at 70% instead of 50%, orange at 80% and red at 90%. Usage limits follow the same steps.
- Panes are calmer. They have no coloured top bar, the state shows as an icon and a word, the recap is plain text, and the focused pane lifts with a soft shadow instead of an outline.
- Popups, dialogs, menus, the resume picker, the groups in the top bar, the board, settings and the main views use fills and soft shadows instead of borders. Focus rings stay clear for keyboard users.
- Sidebar rows show time and cost on their own line. The × and ⋯ buttons appear on hover or focus and never cover text, and ⋯ offers Close and Remove.
- The Agents tab lists background agents grouped by session, running first, each with a small bar scaled to its session, instead of a 24-hour timeline.

## [1.6.2] - 2026-10-26

### Added

- The Agents tab, right after Sessions, shows every background agent your Claude Code and Codex sessions started, across all projects, on a timeline with one row per session. Filter by status, agent, project, time range and text, and choose whether Codex's automatic safety reviews show. Select an agent to see what it did, its model, time, tokens and cost, its last step and its result, and go to its session, show its file or copy its result. The tab shows how many agents are running. Open it with Ctrl+Shift+L.
- Continue in another agent hands over the whole conversation. Dawsha saves the session's transcript to a file and asks the new agent to read it first and say where things stand, along with the goal, files touched, what's left and the last error. The dialog shows the file, with Show in folder and Copy path, and the prompt can be edited before it's sent. Sessions without a transcript yet fall back to the recent terminal output.
- Notifications. A bell in the top bar keeps the last 50 notifications, including sessions that started needing you, with their Reopen, Undo or Go to session action. Clear asks first.
- Session tags. Mark a session Bug, Feature, Review, Research or Docs from its menu in the sidebar or the pane menu. The tag shows in the sidebar, the pane header and the board, and stays with the session when it's closed and reopened.
- Rename a session from the sidebar with F2 or a double-click, open or closed.
- Drag projects in the sidebar to reorder them.
- Reopen all the closed sessions from Today, Yesterday, This week or Earlier at once.
- Closed sessions show what they cost, or their tokens when the cost isn't known.
- Closed sessions in the command palette. Search them by name or project and reopen one.
- Each pane shows a one-line recap of what the session is doing, taken from Claude Code's own recap when it prints one.
- A setting to stop dimming the sessions you're not working in.

### Changed

- The screen for installing and updating Claude Code, Codex and Gemini CLI is now called Agent tools.
- Three sessions no longer leave one stretched across the bottom: the first gets a tall column on the left and the other two stack on the right. Five sessions get the same tall column with four on the right, and no session count leaves one pane alone on a row.
- Each pane has a coloured top edge for its state (needs you, working or idle), the top bar counts idle sessions too, and the approval bar sits at the bottom of the pane.
- Small panes keep their name and their Maximize and Close buttons, and hide less important details first.
- The resume preview says what a session was about and where it ended, in plain text without markup, with its message count and active time. Sessions other tools started, such as automatic summaries and safety reviews, are hidden unless you tick Show automatic sessions.
- The project list in the resume picker and the lists in Ask two agents use Dawsha's own menus.
- Dialogs, pickers and popups share one look and open with a short fade.
- Empty sidebars and board columns say what to do next, with a button for it.
- The project menu in the sidebar works with the arrow keys, and focus returns to the project after Pin or Move.

### Fixed

- Installing Claude Code from Dawsha no longer breaks an existing install. Dawsha now finds Claude Code installed with npm anywhere (custom npm folders, `%APPDATA%\npm`, nvm, Volta and fnm), never runs the native installer over it, and updates each install the way it was installed. Sessions start with an npm-only install on Windows. When two installs are found, Dawsha changes neither and shows both with the commands to remove one. On macOS and Linux it uses the right installer command.
- The resume picker's project menu opened behind the picker.
- Unfocused sessions in light themes no longer look washed out.

## [1.6.1] - 2026-10-25

### Added

- The sidebar filter finds sessions too. Type part of a session name, open or closed, and its project shows with just the matching sessions, even when the project or its closed sessions are folded.
- Pin a project to the top of the sidebar, and move projects up or down, from the project's ⋯ menu. The order is kept after a restart.
- The collapsed sidebar shows each project's status: a count when sessions need you, a dot while one is working. Hovering says which.
- Move around the sidebar with the keyboard. Up and Down go through projects and sessions, Home and End jump to the ends, Right and Left open and fold a project, and Delete removes a closed session. Down from the filter box goes into the list.
- Clear closed sessions. The eraser next to Closed sessions empties that project's list after you confirm. The sessions stay on disk and Resume still finds them.
- Undo after removing a closed session from the sidebar.

### Changed

- Closed sessions in the sidebar list the most recently closed first, grouped into Today, Yesterday, This week and Earlier, and each one shows how long ago it was closed (hover for the exact time).
- A project shows its five latest closed sessions, with Show all for the rest.
- Closed sessions fold away: click Closed sessions under a project to hide or show them. Folded projects and folded closed sessions stay folded after a restart.
- Every popup has an X to close it: dialogs, the command palette, the new session and resume pickers, the branch and replay pickers, and the layouts, theme and update popups. The X does the same as Esc.
- Notifications have an X too, and stay on screen while the pointer is over them, so a Reopen, an Undo or an error can be read before it goes.

## [1.6.0] - 2026-10-19

### Added

- Arabic in every session. Replies and prompts in Arabic show joined letters in right-to-left order, with numbers and English words kept in place and harakat intact, in Claude Code, Codex, Gemini and shell sessions and in Replay. Claude Code lays Arabic out itself, and Dawsha keeps its layout while joining the letters. Copy, Copy last reply, Copy prompt, transcripts and find work in normal reading order, so an Arabic word you type into find matches Claude's reply. The terminal text itself is never changed.
- A bundled Arabic font (IBM Plex Sans Arabic), sized to match the code font, so Arabic looks the same on every computer. Text boxes switch to right-to-left as you type Arabic, and Arabic session titles read correctly in the sidebar, board and panes.
- Voice dictation. Press the mic in a pane header or Ctrl+Shift+Space, speak Arabic or English, and press it again. The text is typed into the session, or into the text box you were in, without sending it. Speech becomes text on your computer with Whisper large-v3-turbo, which handles Egyptian and Gulf Arabic and Arabic mixed with English. The model downloads once (about 570 MB) and then works offline. It starts loading while you speak, so text arrives about two seconds after you stop.
- A live microphone level while you dictate, and a microphone picker in Settings > Voice dictation. If the microphone sends only silence (a muted or switched-off headset), Dawsha says so and names the microphone instead of typing nothing.
- Keyboard shortcuts sheet. Press Ctrl+/ or search the palette for Keyboard shortcuts to see every shortcut, grouped and searchable.
- Reopen a closed session. Closing an agent session shows a toast with Reopen for a few seconds.
- Remote Control checks its connection. While it is on, Dawsha checks the public link every minute, after the computer wakes or unlocks, and before it shows the link or code. If the connection has dropped, it reconnects and shows the new link with a note to scan it again, instead of a link that no longer works.

### Changed

- A calmer pane header. It keeps New terminal, Dictate, Pane actions, Maximize and Close. Session timeline, Replay, Open in VS Code and Move pane are in the pane menu and the palette.
- Full mode keeps every session name on one line, cut off with an ellipsis and shown in full on hover, in normal case with the agent's icon. Each session's close button sits right next to its name.
- In full mode and in the board peek, Esc inside a terminal always goes to the agent, so one press interrupts it. Leave full mode with Ctrl+Enter, the restore button, or Esc outside the terminal.
- Orchestrator: Mark as done closes the run's panes and removes every worktree it created, along with its merged branches. Branches with unmerged work are kept and listed, with a Retry clean-up button.
- Orchestrator: a working lead shows as Coordinating, and tasks that are waiting say why.
- In a pane with several terminal tabs, Tab and Shift+Tab go to the agent or the text box you are in, so Claude Code's Shift+Tab mode switch and shell completion work there. Switch tabs with Ctrl+PageDown and Ctrl+PageUp.

### Removed

- Snippets. Existing snippets in your settings are ignored.

### Fixed

- Orchestrator: work added after a run was reported as finished now starts. Before, the new tasks waited until the old "finished" question was answered.
- Dialogs never grow taller than the window. They scroll inside it, so their buttons stay reachable on small screens.
- Closing the session shown in full mode moves to its neighbour instead of leaving full mode, and the strip shows the same status words as the sidebar, including Needs you.
- A session started from the quick pick gets the keyboard.
- Pane, tab and sidebar menus close on a second click of their button, and stay inside the window.
- Escape from the timeline search returns to the terminal, and Escape closes Replay from its Skip idle box.
- Clearing a recording limit box keeps its value instead of saving the minimum, which could remove recordings.
- Settings import names orchestrator settings, counts the sessions Replace will close correctly, and says what it removes on the button.
- The Work view refresh and the run dashboard no longer take the caret out of a ticket editor or a handoff note.
- A reply sent from the board peek counts as a prompt for Copy last reply and Ctrl+Up.
- Remote Control: Disconnect clears the used pairing code, and the Cloudflare email box has an accessible name.
- Smaller fixes: the Tickets tiles fill their row, New run says Start run, an empty project name no longer marks the folder invalid, shortcut hints show Cmd on macOS, and the run dashboard shows a finished agent as done.

## [1.5.0] - 2026-10-17

### Added

- Orchestrator. Open it from the top bar, describe a feature or a bug, and pick the project. A lead agent sizes the work first (small, medium or large). It does small and medium work itself, and for large work starts only the agents it needs: implementers, a spec writer whose spec and mockups you approve before anything is built, and reviewers that use the agent's built-in code review. Every agent runs in its own visible pane and git worktree, so your checkout stays untouched, and a run can mix Claude Code and Codex.
- Bug runs use a single agent. Pick Claude or Codex; the model comes from your plan.
- Per-run choices in New run: the lead's model, and "Lead works alone" to keep the run to one agent.
- A dashboard for every run: its stages, the lead's estimate, tasks, every agent with its model, state and cost, and the total cost. Restart an agent that is stuck (it continues the same task in the same worktree, after a confirmation), or continue a task on another model.
- Human review collects every question the agents ask you. When a run is ready, choose Mark as done, or Push and open a PR, and add instructions for the lead, for example a missing database migration.
- Boards show the tasks of all runs in columns from To do to Done, filtered by project, run, role or model. Finished runs move to History, where you can search and export them.
- Settings > Orchestrator holds plans (Default and Budget), agent profiles with model and effort, and prices. Anthropic list prices are filled in, so costs show without setup.
- Work dashboard. Open Work in the top bar to see what you did today, this week or this month, per project or in total, and step back with ‹ and ›. Each session or orchestrator run is a Feature, a Bug, an Other change or a Conversation, worked out from its branch and your own commits. Time is the exact active time from the full transcripts; breaks over 5 minutes do not count.
- A Tickets tab groups the sessions of one branch into a ticket. Give a ticket your own name and a link that opens with a click. Names and links stay on this computer.
- Search and a project filter in the Work view, with a project chip on each item when all projects are shown.
- Copy summary copies standup text for the period, tab and filters you are looking at.

### Changed

- The orchestrator is a normal feature, on for everyone. Settings no longer has an Experimental section.

### Fixed

- Remote Control no longer fails while a new Cloudflare address is still spreading. It shows Connecting… and gives you the link once the address works, checking public DNS so a router that cached an early "not found" does not block it. If the address never comes up, it gets a fresh one once before showing a clear error with Try again.
- Remote Control errors are readable messages instead of "Error invoking remote method".
- Installing cloudflared works on more PCs. Downloads retry, go through the Windows proxy or HTTPS_PROXY, and fall back to GitHub's release pages when its API rate limit is reached. 32-bit and ARM Windows get a build that runs, an existing cloudflared install is used, a broken copy is downloaded again, and a file held by antivirus is retried. If it still fails, the error gives the manual download link and the winget command.
- Behind a proxy, the tunnel connects over HTTP/2, which proxies let through.

## [1.0.0] - 2026-10-15

### Added

- Session timeline. Open it from the Timeline button in a pane header, the pane menu, the command palette (Show session timeline) or Ctrl+Shift+T. It lists a session's prompts, replies, file reads and edits (with added and removed lines), commands, test runs (with pass and fail counts for npm, pnpm, vitest, jest, pytest, go, cargo and dotnet), errors, state changes and the permissions you answered from Dawsha, each with its time. A state bar shows how long the session was working, needing you and done, using patterns as well as colour. Filter by All, Prompts, Edits, Commands, Approvals or Tests, search with highlighted matches and Enter or Shift+Enter to move between them, and open Insights for time spent in each state, how long you kept the agent waiting, the files edited most, commands run, test trends, permission prompts and cost. Click an edit to see that file in Changes, and export the timeline as Markdown. State changes and answers are kept in memory only, so they start fresh after a restart.
- Search all sessions from the timeline. Switch the search box to All sessions, or use Search all session timelines… in the palette (Ctrl+Alt+F), to look through the prompts, replies, files, commands, test results and errors of every Claude, Codex and Gemini session of your projects, including closed ones. Results are grouped by session with up to three highlighted matches each, and can be narrowed by project, agent and event type. Clicking a result jumps to that event in the session's pane, or opens the past session read-only with a Resume session button.
- Replay any session. When you turn on Record sessions in Settings (off by default, because a recording keeps everything a terminal prints, including secrets you display), Dawsha records every terminal as a standard asciinema .cast file in its data folder (recordings/<date>/), readable only by you, with a small sidecar file naming the project, agent, title and folder. A recording stops at 32 MB and says so in the replay. Choose Pause recording in a pane's menu to stop capturing one terminal for a while. Choose Replay session in a pane's menu or with the Replay button in the pane header and the timeline, or Replay a session... in the command palette to pick from all recordings, newest first, searchable by title, project, agent and date. Works for sessions that have already exited.
- The Replay view plays a recording in a read-only terminal at its recorded size, with Space to play or pause, 1x, 4x and 16x speed, Skip idle time, a scrubber with markers for prompts you sent, permission prompts and the end of the session, and previous and next marker buttons. Dragging the scrubber jumps to any moment. Esc or Back returns to where you were.
- Search inside a recording. Matches are listed with their time, and choosing one jumps there and highlights the text. The At this point panel shows the time elapsed and a Copy screen text button.
- New Recordings settings in General: turn recording on or off (off by default; with it off, Replay explains what recording stores and offers a Turn on recording button), how many days to keep recordings (14), a maximum total size (1 GB) with oldest-first cleanup at startup and once a day, Open recordings folder, and Delete all recordings... which asks first and names how many recordings and how much space it will free.
- Approve or deny agent permission prompts from a paired phone (Remote Control, beta). A new Approvals tab lists every prompt waiting on you, with the command or edit, the agent and project, and how long it has waited. Allow once, or Deny with a quick reason or your own message that is typed into the agent. The phone also keeps a list of recent answers, desktop ones included.
- A separate "Let paired phones answer permission prompts" permission in Settings > Remote Access, off by default, and enforced on every approval request. Paired phones keep the permissions they already have.
- Phone notifications for new prompts, with Allow and Open buttons where the phone supports them (Deny is answered on the Approvals tab, so it can carry a reason), while the Dawsha page is open in the background. Optionally only when this computer has been idle for a few minutes. Alerts do not reach a closed browser.
- A safety rule for the phone: edits outside the project folder, and to CI and config files (.github, YAML, package.json, lockfiles, .env), can only be denied from the phone unless you turn on "Phone can allow edits to CI and config files". Detection reads the prompt text, so it is best effort.
- Switch the Sessions view between Grid and Board from the top bar, the palette ("Switch to board view" and "Switch to grid view") or Ctrl+Shift+B. The board has four columns: Needs you, Working, Done and Reviewed. Cards move by themselves as sessions change, and the choice is remembered.
- Act on sessions straight from their cards. Allow or Deny a permission prompt, see the last lines of a working session, open Changes, Timeline or Replay on a finished one, and mark it reviewed with a button or by dragging it to Reviewed. Close all reviewed sessions at once after a confirmation.
- Peek at any card. Click it to see the session's live terminal beside the board and send it a reply, then Open in grid to jump into the pane. Escape closes the peek, and you can also click into its terminal and type there.
- Filter the board by project and agent.
- Move Dawsha to a new PC with Settings > General > Back up and move, or the palette ("Export settings…" and "Import settings…"). Export saves your projects, snippets, layouts, highlight rules and preferences to one file. Import shows what will change, then lets you Merge (add what is new, keep what you have) or Replace (after a confirmation that names what is replaced). Projects whose folders are missing on the new PC are flagged. Remote Access, full-access settings, open sessions and usage history are never exported.

### Changed

- Ask before closing a session only while it is working. Idle, done and exited sessions close straight away.
- Replace the plain project and agent drop-downs in the all-sessions timeline search with styled filter menus that match the rest of the app, with agent logos, check marks and full keyboard support.

### Fixed

- Notice a permission prompt drawn near the top of a tall terminal, for example after the agent clears the screen. Dawsha only looked at the last few rows, so such a prompt could go unnoticed, and Needs you showed up late.
- Keep the top bar from overlapping at medium window widths, and fit the Remote Control tabs and their badge on small phones.
- Keep the close confirmation small when a session has a long title. The title is shortened in the heading and on the button, and Cancel and Close stay on one row.

## [0.5.3] - 2026-10-14

### Changed

- Say what the top bar text size buttons do: they resize every pane, while Ctrl+= and Ctrl+- (Cmd on macOS) resize only the focused pane.

### Fixed

- Keep the session state pill steady. With live session info on, the Working pill rebuilt itself on every status update, restarting its spinner and making the pane header jitter. It now shows how long the session has been in its current state, in whole minutes, and only its text changes while the state holds. The focus view's side cards follow the same rule.

## [0.5.2] - 2026-10-14

### Added

- Answer a permission prompt from the pane itself. A session that needs you shows an Allow and Deny bar above its footer, and the focus view's side panel has the same buttons.
- See every session's state at a glance: needs you, working, done, idle or exited, each with its own icon shape so it does not rely on color.
- Jump to what needs you from the top bar. It counts sessions that need you, are working or are done and not yet reviewed, and Ctrl+Shift+J goes to the next one that needs you.
- Show the number of sessions that need you on the taskbar or dock icon and in the window title.
- Turn on live session info from a pane footer. Claude panes without it show a Turn on live info button instead of an empty footer.
- Search skills and agents by name, path or project, and export everything shown at once, for all agents or one agent, into a dawsha-export folder grouped by agent.
- Follow a session into a git worktree. Open in VS Code, Explorer, Changes, Files, the branch chip and clickable file paths use the folder the agent is working in.

### Changed

- Show the 5 hour and weekly limits once in the top bar, with the reset time, instead of in every pane footer.
- Hide the tab strip on panes with a single tab, so the header is one row. The + button moves into the header.
- Cut long branch names from the start, so the end of the name stays visible.
- Put Agents, Skills and Layouts under a More menu in the top bar.
- Group sessions that need you at the top of the sidebar.
- Sort the focus view's other sessions by what needs you first, with two readable preview lines and actions on each card.
- Show projects as rows with New session and a More menu for rename, folder, default agent and remove, plus a filter.
- Walk through first-run setup in three steps that end with starting your first session.
- Show Usage summary tiles, Claude limit meters with reset times and pace, and sortable tables. Missing cost now reads "not reported".
- Show agents as cards with clear update status and the full access switch.

### Fixed

- Fix the pane footer staying empty when live session info was off, with no hint about how to turn it on.

## [0.5.1] - 2026-10-14

### Added

- Pair a phone by scanning a QR code in Remote Access settings. The code travels in the link fragment, so it never reaches the server or Cloudflare.
- Add the Dawsha Daylight light theme and the Dawsha Cards and Graphite Cards dark themes, which draw each pane as a card with the terminal inset.
- Review changes side by side or unified, with line numbers, word highlights and folded unchanged lines. Move between files with J and K, and press Space to pick a file for the commit.
- Switch Changes to This session to see only what changed after the session started. Dawsha records the starting point without touching your stash or working tree.
- Browse the project in a new Files tab: a tree of every file git does not ignore, a filter by name and a read-only view where lines changed since the last commit are tinted.

### Changed

- The Changes dialog is now a full review view with Previous, Next, Open in editor and Revert file for each file.
- Replace the Tokyo Night, Solarized Dark, Gruvbox Dark and Solarized Light themes with the new themes. Anyone using one of them moves to the closest new theme.

### Fixed

- Stop a paired phone from resizing the desktop terminal, which garbled agent output on the desktop when the phone could type.
- Clicking a desktop notification reliably brings Dawsha forward and opens that session. Notifications could be cleaned up while still on screen, so their click did nothing.

## [0.5.0] - 2026-10-13

### Added

- Add Remote Control (Beta) to public builds, with browser pairing, configurable permissions, revocable devices and a local Cloudflare Quick Tunnel.
- Resize the Projects sidebar by dragging its edge or using the keyboard; the width is saved between launches.
- Show the other sessions in a side panel when one pane is maximized, with live previews; collapse it to a strip of agent icons.
- Start sessions from a New session dialog with project cards and agent cards that show each agent's version and usage limits.

### Changed

- Label Remote Control as beta in the desktop settings and browser interface.
- Show context, 5 hour and weekly usage as charge bars that turn amber and red as they fill.
- Redesign the project rows and session rows in the sidebar, with today's usage, new session, agent menu and close buttons on each row.
- Refresh the top bar buttons: a solid New session button with its shortcut, raised tabs, a text size stepper and icon buttons for Theme and Settings.
- Mirror remote terminals from a headless terminal so the browser shows the same screen as the desktop app, and fix sending prompts from the browser.
- Refresh the Remote Access copy URL and copy code controls.
- Redesign the pane header: the title in normal case with its project and a status pill, and a status bar at the bottom with the model, usage bars, changes and branch.

### Fixed

- Make the `dawsha` command work on macOS and Linux: it now talks to the app over a Unix socket and ships in the macOS and Linux packages.

## [0.4.1] - 2026-10-12

### Fixed

- Match Linux download links and release uploads to the generated AppImage and Debian package names.

## [0.4.0] - 2026-10-12

### Added

- Run Dawsha on Linux x64 and distribute AppImage and Debian / Ubuntu packages.
- Add platform-specific Windows, macOS and Linux downloads to the English and Arabic websites.

### Changed

- Refine the platform download menu with a compact open transition and align the platform cards.

## [0.3.0] - 2026-10-12

### Added

- Run Dawsha on Apple Silicon Macs with macOS 13 Ventura or newer, with native terminals, agent discovery, process activity, and Command-key shortcuts.
- Build macOS DMG and ZIP packages and validate them on Apple Silicon GitHub Actions runners.
- Add a persistent Sessions button in the top navigation so every view has a direct route back to sessions.

### Changed

- Refresh the New session split control to fit the current compact top bar and use consistent hover, focus, and pressed states.
- Document macOS installation, data paths, and the signing requirement for in-app updates.

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

## [0.5.0-legacy] - 2026-10-09

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

## [0.4.0-legacy] - 2026-10-08

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

## [0.3.0-legacy] - 2026-10-08

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
