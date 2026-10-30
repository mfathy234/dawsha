# Dawsha visual audit (before the redesign)

Captured from the build of `main` at 1440x900, dark (default "Dawsha") and light ("Dawsha Daylight"), sandboxed project "Smoke" with generic fixtures. Images: `docs/redesign/current/<theme>-<NN>-<view>.png` (142 files, 71 per theme). Capture script for reference: `docs/redesign/tour.spec.ts.txt`; what succeeded or was skipped: `docs/redesign/capture-log.txt`.
Numbers below come from grepping `src/renderer/styles.css` plus the 19 component stylesheets (8,875 CSS lines in all; styles.css alone is 7,031), and from WCAG ratios computed on the token values in `src/renderer/styles.css` and `src/shared/themes.ts`. Image names are cited as `d-NN` (dark) / `l-NN` (light) for the numbered main run, `G-` for the grid run, `A-` empty app, `U-` update, `W-` what's new.

---

## 1. Inventory

Files are `dark-<id>.png` and `light-<id>.png` with the same ids.

| Id | Shows | Fidelity note |
|---|---|---|
| A-01-onboarding, A-02-empty-app | First run "Set up Dawsha" dialog, then the empty shell after Skip | ok |
| G-01-one-pane | 1 working Claude pane, sidebar with one project | ok |
| G-02-three-panes-states | 3 panes: working (1), idle with recap (2), needs-you with Allow/Deny bar (3); "1 needs you" chip; "Waiting on you" sidebar block | ok, best state capture |
| G-03-five-panes, G-04-five-panes-dimmed | 5-pane grid, then "Dim others" on | panes 2-5 show shell banner, not agent output (layout redraw wiped fed text) |
| G-05-toast-closed-pane | not captured (toast was gone before the shot) | skipped |
| G-06-sidebar-kept-session-menu | Row menu on a sidebar session (Rename, Tag as ..., Close) | ok |
| 01-grid-1-pane | 1 pane with fed Claude-style output | ok |
| 02-resume-picker | New/Resume quick pick with preview | ok |
| 03-grid-2-panes-resumed | 2 panes, 2nd resumed | agent output overwritten by fake agent "READY claude" |
| 04-grid-3-needs-working-done | 3 panes | same overwrite; use G-02 for states |
| 05-sidebar-expanded | Sidebar with 3 sessions + 3 empty projects | ok |
| 06-sidebar-project-menu | Project "..." menu | ok |
| 07-sidebar-context-menu | Right-click on a project row | no menu appears (the app has none there); that is itself a finding |
| 08-sidebar-filter | Filter field open ("Sm") | ok |
| 09-sidebar-sort-filter-menu | Sort / hide-empty menu | ok |
| 10-topbar-limits-popover | Limits by agent popover | ok |
| 11-palette, 12-palette-search | Command palette, with query | ok |
| 13-shortcuts-sheet | Keyboard shortcuts dialog | ok |
| 14-new-session-picker | Ctrl+N quick pick | ok |
| 15-layouts-popover | Saved layouts (empty) | ok |
| 16-more-menu | More menu | ok |
| 17-pane-actions-menu | Pane "..." menu (22 items) | ok |
| 18-panel-timeline | Timeline side panel | duration "515h" is a fixture-date artifact |
| 19-panel-timeline-insights | not captured | skipped (Insights already expanded in 18) |
| 20-panel-details | Details / info side panel + "Other sessions" rail | ok |
| 21-panel-changes-dialog | Changes dialog (side-by-side diff + commit box) | ok |
| 22-panel-diff | "Show diff" (opens a shell tab with raw git diff in the pane) | ok |
| 23-pane-find | Ctrl+Shift+F in a pane | ok |
| 24-pane-maximized | Maximized pane with tabs, left project rail, right "Other sessions" | ok |
| 25-confirm-close-dialog | Close-while-working confirm | ok |
| 26-toast | not captured | skipped |
| 27-notifications-bell | Notifications popover | ok |
| 28-board-layout, 29-board-peek | Board (4 columns) and card peek | ok |
| 30-crew-agents-list | Agents view, Maya (lead) goal box | ok |
| 31-crew-lead-goal, 32-crew-member-detail, 33-crew-new-agent-setup | Lead goal, Sami detail/setup, new agent "Zed" | ok |
| 34-crew-run-dialog | Run Sami dialog | ok |
| 35-crew-run-state | meant to show a running agent | not captured: shows the setup page again (run needs a real CLI) |
| 36-agent-tools-view | Agent tools (More > Agent tools) | ok |
| 37-skills-view | Skills | empty state only (no skills seeded) |
| 38-projects-view, 39-projects-tasks, 40-projects-instructions | Projects tabs | tasks empty state; instructions with CLAUDE.md |
| 41-usage-view | Usage view | ok |
| 42-work-view | Work (sessions tab) | ok |
| 43-files-tree ... 52-files-branch-menu | Files: tree, README preview, source, context menu, changes diff, review, search, quick open (Ctrl+P), run panel, branch menu | ok |
| 53-replay-view | Replay view | canvas empty at 0:00 (playback did not start) |
| 54-replay-search | not captured | skipped |
| 55-settings-general, 56-...-scrolled, 57..63 | Settings: General top and scrolled, Notifications, Agents, Updates, Highlights, Changelog, About, Remote Access | Remote tab is the "off" state only |
| 64-theme-picker | Theme popover | ok |
| U-01-update-pill, U-02-update-popover | Update pill, popover | ok |
| W-01-whats-new | What's-new dialog | ok |

Not captured at all: any toast, replay timeline search ("All sessions" tab and replay search), the phone-side Remote Access web page (only the desktop settings tab exists in the renderer build), a running/finished agent run in Agents, Skills with real entries, Tasks with data, Arabic/RTL content, a destructive delete dialog (only the close-pane confirm), the Board "Needs you" column populated, the Instructions side panel with a conflict.

---

## 2. Foundation findings

### 2.1 Type
- Font-size: 5 tokens (`--fs-status` 11, `--fs-ui` 12, `--fs-body` 13, `--fs-title` 15, `--fs-view` 22) cover 426 of ~450 declarations (ui 226, body 92, status 82, title 17, view 9). The remaining 24 are literals: `11.5px` x7, `11px` x2, `10px` x2, `13px`, `18px`, five `em` values (0.92, 1.15, 1.35, 1.7, 1), one `calc(var(--size) * .38)`, one `--popup-title-size`. Effective distinct sizes: 8 px values (10, 11, 11.5, 12, 13, 15, 18, 22) plus 5 relative ones.
- The scale is very flat at the bottom: 11 / 12 / 13 are 1px apart and carry 400 of 450 declarations. Hierarchy in screens such as d-41 and d-42 therefore depends on weight and colour, not size, which is why "Per project", "Items", "Tokens per day" headings look the same as body.
- Font-weight: 7 values (400 x16, 500 x31, 550 x1, 600 x108, 650 x6, 700 x13, 800 x1). 550/650/800 are single-use outliers; 600 is the de facto "bold" in 108 places, so nothing separates emphasis from structure.
- Font families: `--font-mono` is used 76 times vs `--font-ui` 8 times (+8 `inherit`). Mono is applied to numerals in tables (d-41, d-42), terminal chrome, pane footers ("Turn on live info", d-G-02), kbd hints, file paths. The pane footer (`Opus 5.5  Turn on live info  +3 -1  Review 1 file  main`) is entirely mono at 11px.
- Line-height: 10 values (1.5 x15, 1.45 x7, 1.4 x5, 1.55 x3, 1.35 x3, 1.65 x2, 1 x6, 20px x4, 18px, inherit). 1.35/1.4/1.45/1.5/1.55 are one idea expressed five ways.
- Letter-spacing: only 6 declarations; 1 `text-transform: uppercase` rule. The small-caps table headers in d-41/d-42 ("PROJECT", "SESSIONS", "CACHE READ") are the only tracked labels, and they wrap ("CACHE READ" on two lines in d-41).
- Arabic is bundled as `Dawsha Arabic` (IBM Plex Sans Arabic, 3 weights) with `size-adjust: 112%`, only used as the first family in both stacks. Weights 550/650/800 have no Arabic face, so they synthesise.

### 2.2 Colour
- 95 custom-property declarations in styles.css `:root` blocks (~77 unique names plus aliases). 19 of them are pure aliases (`--canvas`=`--bg`, `--chrome`=`--sidebar`, `--pane`=`--surface`, `--overlay`=`--surface-pop`, `--term-bg`=`--well`, `--faint`=`--muted`, `--done`=`--accent`, `--needs-ring`/`--needs-ink`=`--needs`, `--idle`=`--muted`, `--danger`=`--exited`). `--faint` is declared and never used (0 uses). `--t-surface: 200ms` is declared and never used (0 uses).
- Surface ladder is 6 steps in dark: `#07090c` bg, `#0d1015` well, `#0f1217` sidebar, `#161a22` surface, `#1d222c` raised, `#252b37` pop. Adjacent steps differ by 4 to 9 L*; the grid pane (`#161a22`) vs terminal (`#0d1015`) vs window (`#07090c`) is the only place the ladder is legible. Usage of the ladder: `--raised` 98 uses, `--well` 41, `--surface` 33, `--bg` 16, `--sidebar` 16, `--chrome` 13, `--pane` 12, `--surface-pop` 3, `--overlay` 1, `--canvas` 2, `--term-bg` 3. So `--raised` is the default fill for almost every control, button, chip, input and card, which is why buttons, cards and inputs read as the same grey in d-33 and d-38.
- Colour literals outside tokens: 62 hex occurrences (54 distinct) and 28 `rgb()/rgba()` (18 distinct), after the `:root` blocks. Examples: `#60a5fa` (working), tag/crew colours `#f2777a #f0a35e #ec8fc4 #e8956a #e5c76b #d97757 #d6b392 #c6c0a8 #b4acdc #b19af5 #98c7b0 #96b9db #8fb4ff #b23b82 #c0392b #b9620f #c2620a`, `rgb(255 255 255 / .28)` focus ring, `rgb(255 255 255 / .2)`. In addition there are 114 `color-mix()` calls (the real tinting system: hovers, rings, chips) and no `hsl`/`oklch`.
- Semantic colours: 5 session states (needs `#f08a3c`, working `#60a5fa`, done = accent `#34d399`, idle `#8a93a6`, exited `#f87171`) plus `--busy #f5b54a` (amber) which is not the same as "working" blue, so "busy" and "working" are two different amber/blue ideas in different places (sidebar spinner blue, Done/Working chips amber/blue in the board).
- Agent identity colours: Claude orange-red asterisk, Codex white swirl, Gemini purple sparkle, plus 8 crew avatar colours (red, orange, yellow, green, cyan, blue, violet, pink) used on both agent avatars (d-30) and chart series (d-41: Claude orange, Codex purple, Gemini blue). Purple means Codex in the chart, Gemini in the sidebar/menu, and Maya (lead) in the Agents list: three meanings.

### 2.3 Contrast (WCAG 2.x, computed)
Dark default:
- text `#d6dae3` on surface `#161a22`: 12.5:1. muted `#8a93a6` on bg 6.5, sidebar 6.1, surface 5.7, raised 5.2, pop 4.6 (borderline for 11px text on popovers).
- accent `#34d399` on surface 9.1; `--needs` `#f08a3c` on surface 7.0; working `#60a5fa` on surface 6.9; danger `#f87171` on surface 6.3. All pass.
- Disabled / dimmed content (onboarding steps 2-3 in d-A-01, disabled "Update all" in d-36, disabled "Apply to all files" in d-40, "Start a session" in d-A-01) is drawn at roughly 0.45-0.5 opacity: effective ratio about 1.6-2.2:1. Unreadable, and it is body copy, not just a button label.
Light "Dawsha Daylight":
- text `#16201b` on `#fff` 16.7; muted `#56625c` on `#e2e6e4` 5.06 (passes by 0.5), on white 6.4.
- accent `#087049` on `#e2e6e4` 4.87; busy `#8a5a00` on bg 4.71; needs `#9a4a00` on bg 4.97. All pass but with almost no margin on the grey window background.
- FAIL: `--state-working: #60a5fa` is not overridden for light themes (declared once in a global `:root` at styles.css:5681). On white it is 2.54:1, on the sidebar `#edf0ee` 2.22:1, on bg `#e2e6e4` 2.02:1. It colours the "Working" word/spinner in pane header, sidebar rows, board column header, timeline segments and the "Working" chip (l-G-02, l-28). Size 11px, so it needs 4.5:1.
- FAIL: ANSI "dim" text inside the terminal in light mode (`Read 84 lines`, `Claude Code` frame in l-G-02) is about 1.7-2.0:1.
- FAIL: onboarding dimmed steps and the disabled primary button in light (l-A-01): about 1.9:1.
- Placeholder text ("Search by name, role or job", "Commit message", "Files to include") uses muted at ~.8: ok in dark (about 4.7), marginal in light.

### 2.4 Radii, shadows, borders
- Radius tokens: `--r-control` 6px (77 uses), `--radius` = same 6px (45 uses; a duplicate), `--r-card` 10px (26), `--r-pop` 14px (7), `--r-full` (1), `--c-radius` (9, component-local), `--popup-radius` (1). Literals: `50%` x12, `2px` x8, `5px` x3, `3px` x3, `1px` x3, `10px` x3, `8px` x2, `6px` x2, `30%` x2, plus `9px`, `7px`, `11px`, `1.5px`. 33 distinct radius declarations in total, 13 of them untokenised px/% values (5, 7, 8, 9, 11 px are off-scale).
- Shadows: 39 distinct `box-shadow` values for ~85 declarations. Only 5 are tokens (`--sel-ring` 14 uses, `--field-shadow` 9, `--shadow-pop` 3, `--shadow-card` 2, `--popup-shadow` 1, `--ring`/`--pane-focus-ring` a few). The rest are inline inset seams, rings and 2px/6px accent insets. There is no consistent elevation order: popovers use `--shadow-pop` (0 16px 40px .5), dialogs a different value (popup-shadow), pane focus a ring.
- Borders: 109 `border*` declarations, 47 of them `border: 0`. Real borders: 15 top, 15 bottom, 7 full, 5 left, all `1px solid var(--border)` (`#232833` dark). Structural dividers are therefore a mix of 1px borders (`--border`) and 1px inset shadows (`--seam`, 12 uses), two near-identical mechanisms for the same job. Inputs use a third (`--field-shadow`: inset shadow plus `rgb(255 255 255 / .28)` ring, 9 uses). Result in d-33: the form inputs have a strong 28% white ring while list rows and cards have none, so inputs dominate.

### 2.5 Spacing and sizes
- Spacing tokens `--s-1..6` (4/8/12/16/24/32) are used 1,120 times across 888 of 1,217 padding/margin/gap declarations (73%). Off-token literals: 28 distinct px values, e.g. `2px` x99, `1px` x20, `6px` x13, `4px` x11, `3px` x8, `40px` x8, `32px` x6, `52px`, `7px`, `11px`, `5px`, `10px`, `1.5px`. Page gutters are hard-coded rather than tokenised: Projects, Agents `32px 40px`, Work `24px 40px 32px`, Skills `24px` (see section 4).
- Control heights: 9 distinct values for interactive elements: 20, 22, 24, 26, 28, 30, 32 (x15), 34, 36 (x10). Top bar buttons, tab pills, segmented controls, `.btn`, inputs and selects are spread across these (d-33: input 38px tall, Run button 32px, colour swatches 24px).
- 255 `width/height` declarations with ≤19px literals (icons, dots, bars), 151 min/max-width literals.

### 2.6 Layers, motion, other
- z-index: 12 distinct values (1, 2, 4, 5, 6, 10, 12, 20, 30, 40, 50, 60 x3, and 10000). No named scale; 10000 is presumably the toast layer.
- Motion tokens: `--t-feedback: 120ms` (23 uses) and `--ease-out` (21 uses); `--t-surface` 200ms unused. Literal durations: 13 distinct (60ms, 100ms, 150ms, 160ms, .5s, .9s, 1.1s, 1.2s, 1.4s x2, 1.8s, 1ms, .01ms, 0s). No `transition: all`. 9 `prefers-reduced-motion` blocks, 1 `prefers-reduced-transparency`, 1 `prefers-contrast: more`: the accessibility hooks exist.
- `backdrop-filter` appears in 3 rules (blur(6px) behind modals); there is no translucency in chrome, so the blurred scrims in d-11, d-13, d-25 are the only depth cue.
- `!important`: 6. `outline: none/0`: 14 (focus replaced by ring in `:focus-visible` rules at styles.css:175).
- Responsive: 10 `max-width` queries (700 to 1100px). The app is desktop-only, fine, but 1024px layouts are tested in e2e, 1440 is the base here.

---

## 3. Per-area findings

### 3.1 Sessions and panes (G-01, G-02, G-03, d-17, d-23, d-24)
- Pane header composition, focused pane in d-G-02: agent glyph, `3 · Smoke` (number + title), a state pill (icon + word "Needs you"), optional tag chip (`feature` in pane 1, green), optional `resumed` italic chip (d-03), then 4 right-aligned icon buttons (+, ..., maximize, close). That is up to 9 elements at 3 sizes (12px glyph, 13px bold title, 11px pill/chips, 16px icon buttons). The unfocused panes show only `+`, so the header's right side jumps from 1 to 4 buttons as focus moves (d-G-02 pane 1 vs 2).
- Unfocused pane (1) shows a state word "Working" in blue plus the tag chip in green; pane 2 shows "Idle" in grey; pane 3 "Needs you" in orange. Three different pill shapes: bare text with spinner (working), bare text with outlined circle (idle), diamond + text (needs). They are not chips and do not align across panes because titles are different lengths: the state word floats at x=520 in pane 1, x=1100 in pane 2, x=1100 in pane 3.
- The needs-you state is the most important event in the product and is carried by: a 1px orange pane ring (d-G-02 pane 3), a diamond icon + orange word, the top-bar chip "1 needs you", a sidebar "Waiting on you" section, and a bar at the bottom of the pane (`Claude is waiting for your answer` + Allow Enter + Deny Esc). That is good coverage, but the ring is 1px orange against a 1px white-ish ring on the focused pane, so a focused pane and a needs-you pane look alike (compare pane 2 and pane 3 borders in l-G-02: both are thin outlines).
- The Allow/Deny bar is at the very bottom of the pane (y=832 of 900) below a large empty terminal. The command being approved (`npm run migrate -- --env dev`) is not shown in the bar; it is only in the terminal buffer above, where the user must scroll to see it. In the fixture the command line was not on screen (CLEARed buffer) so the bar says only "Claude is waiting for your answer".
- Pane footer is a 22px strip of mono 11px chips: `Opus 5.5`, `Turn on live info`, `+3 -1`, `Review 1 file`, `main`. "Turn on live info" is a call to action rendered as a label identical to data; it appears in every pane of d-G-03 (5 times) until the user enables it. `Review 1 file` is a link with no affordance.
- 5-pane grid (d-G-03): three equal columns of narrow panes at 15px mono wrap the terminal at 33 columns (`Microsoft Windows [Version 10.0.2` / `6300.9818]`), so the content of 4 of 5 panes is unreadable without maximizing. Pane 1 header collapses; panes 2-5 show only number, title, state circle, `+`.
- Idle panes all read "Smoke" (title = project name) in the header and the sidebar (d-G-03: four rows named "Smoke", "Idle . now"). Nothing distinguishes sessions until they have a prompt-derived title.
- Pane actions menu (d-17) has 22 entries in one flat list with 6 shortcuts, 3 "Open in ..." items, 3 "Copy"/"Clear" items, two "Continue in" at the bottom, no groups or separators. Disabled items (Open in Visual Studio) are not visually separated.
- Maximized layout (d-24): four navigation structures at once: top strip of all panes (`1 Add retry... Working x | 2 Smoke Idle x | 3 ...`) at 11px, a 56px project-initials rail on the left (`SM DO BI MI`), a right "Other sessions" panel (280px) with mini cards, and the pane's own tab row (`claude | shell | +`). The terminal gets 1060 of 1440px.
- Details panel (d-20) and Timeline panel (d-18) take 50% / 40% of the pane. Timeline stacks: header with duration, empty progress bar, `Idle 11s` checkbox row, 6 filter chips (All, Prompts, Edits, Commands, Approvals, Tests), 2 scope tabs (This session / All sessions), search field with 2 arrow buttons, Insights disclosure, then the list, then Export + shortcut. 7 control rows before the first event at y=530.
- Pane "Show diff" (d-22) runs `git diff` into a new "shell" tab inside the agent pane, rendering raw patch text with an LF/CRLF warning. It is the weakest of three diff surfaces (this, Changes dialog d-21, Files d-47).

### 3.2 Grid and layouts (G-01 to G-04, d-28, d-29)
- Grid layout is fixed: 1 big left + stack on the right for 3, 3-column for 5. The board alternative (d-28) shows 4 columns with a persistent hint text in the toolbar ("Cards move by themselves as sessions change. Drag a Done card to Reviewed.") at 11px, right-aligned and truncated to 2 lines when the peek opens (d-29).
- Board peek (d-29) squeezes the 4 columns into 640px: column titles overlap content ("Add retry ..." truncated, "Reviewed 2" clipped) and a horizontal scrollbar appears at the bottom; the "+ New session" ghost button is cut to "+ New sessi". The peek terminal has its own reply field and "Send" button, "Open in grid" and close.
- Empty board columns repeat a bold sentence plus a muted second sentence ("Nothing waiting on you. Sessions that ask for permission..."), the same pattern as no other empty state.
- Dim others (d-G-04) is an icon-only half-circle toggle at x=777 next to Grid/Board; its glyph is the same half-circle used for light/dark theme in many apps, while the actual Theme control is the circled-glyph at x=1372 that looks like a help "?" (d-64 opens the Theme popover from it). Two unlabeled icons with swapped expectations.

### 3.3 Sidebar (d-05 to d-09, G-06)
- Rows: project header (`Smoke`, `main . $4.25 today`, `3 live` or `needs you` badge on the right, hover reveals + and ...), session rows with agent glyph, 13px title, 11px state line (`Working . now`). The "Idle" word is repeated per row; "now" / "1m" / "3m" timestamps are right after the state with a middle dot.
- Section labels `Active . 1`, `No sessions . 3`, `All projects`, `Waiting on you` are 11px with different colours (muted, orange, muted) and positions; "No sessions . 3" groups three project names at 13px bold (`Docs`, `Billing`, `Missing`) with no counts, no folder state; the missing-folder project "Missing" looks identical to the others (d-38 shows the error only in the Projects view).
- Header has 4 icons (search, add, collapse, and the sort icon one row below). Footer has `+ Add project` and `Manage`. `Manage` highlights as a pressed tab on the Projects view (d-39: filled "Manage" button), so it is both a button and a nav tab.
- Filter (d-08) opens as a bordered green-ring field that pushes the list down by 36px and shows a grey "All projects" label; the sort menu (d-09) covers the first project.
- Row context menus (G-06) cover neighbouring rows and the menu has no icons while the pane actions menu has icons; text "Tag as Bug / Feature / Review / Research / Docs" is coloured per tag, the only menu with coloured text.
- Right-click on a project header does nothing (d-07); right-click works only on closed/kept session rows.

### 3.4 Top bar and usage (all full-window shots; d-10, d-27, d-36)
- 17 interactive targets in one 48px row at 1440px: logo, New session + split chevron (primary green button, the loudest object on every screen), Sessions / Agents / Files / More (text tabs, current one has a filled pill), Grid / Board segmented control, Dim-others icon, the usage meter (agent glyph + name + `5h` + bar + `62%` + `1h 39m` + `week` + bar + `18%`), font stepper (- 15px +), bell, theme icon, settings gear. No grouping or spacing rhythm: gaps vary from 8 to 28px.
- Navigation is split three ways: top text tabs (Sessions, Agents, Files, More), the More dropdown (Projects, Usage, Work, Agent tools, Skills, Layouts: 6 items, no icons, d-16) and the gear (Settings). When a More page is open, the tab that lights up is "More" (d-36 to d-42) so the user cannot tell Usage from Skills from the top bar; the page title is the only cue. "Agents" (crew) vs "Agent tools" (CLI installer) vs "Skills" use near-identical words for unrelated things.
- Usage meter: tiny 38x10px bars (`5h` green with 3 of 5 segments, `week`) at 11px. When no agent session is focused it shows `stale` in italics (d-U-02). The meter and the popover (d-10) repeat "Not signed in" three times in grey. The Usage view's own "Claude limits right now" card (d-41) says "Reset time not reported" while the top bar shows `resets in 1h 37m` for the same window.
- Primary green: "New session" (filled, 36px) is the only primary-coloured control in the bar; in light the same control becomes dark green `#087049` with white text.

### 3.5 Agents / crew (d-30 to d-35)
- Two-pane layout: 328px list + detail. Header row has title "Agents" with a "9 . 8 built in" count in 11px muted, search, Import..., "+ New agent" (primary), all at different heights (search 38px, buttons 32px, primary 32px).
- List: three sections ("Lead", "Built in 7", "Yours 0") as 11px labels; avatar tiles (circle MA, rounded-square SA TA OM HA LI NO YA) in 8 colours; each row shows `Name . Role` and `Never run` (all 8 rows say "Never run": the second line carries zero information when nothing has run). Maya (lead) has a circular avatar and a violet selected row; others square. Selection shown by filled row + for Sami an inline `Run` button on hover.
- Detail page (d-32): 12 form rows with a left label column (Name . role, Colour, Instructions, Prompt, Projects, Paste to run...), the page needs 2 screen heights, no section grouping beyond 2 tiny labels ("Identity", "Job"). Built-in agents show editable-looking read-only fields. The colour picker is 8 swatches at 24px with a white double ring for selected; the ring is the same ring used for keyboard focus.
- New agent form (d-33): the Instructions textarea is 180px tall and empty while Prompt (the thing the user typed) is 100px; labels and helper text use the same 11px muted.
- Run dialog (d-34): Target field, Project select, Model as a 7-chip radio group in 2 rows, Where as a segmented control, a mono command preview in a black box, footer hint "Runs in a pane in the project above . Ctrl+Enter". It is the most considered form in the app; its chips (`Member default . Claude . Sonnet`, `Claude . Fable`...) are the 3rd chip style.
- Maya goal box (d-30): textarea, project select, model select, checkbox + primary button right-aligned: native `select` elements with OS-style arrows (dark in dark mode, but the arrow glyph and corner radius do not match the app's custom select menu in `.select-menu`).

### 3.5b Agent tools (d-36)
- 3 equal cards with tiny `Up to date` text (green, 11px, no icon), "Installed 24.12.0" in mono (this is the fake version string; the Latest 2.1.312), a bordered amber-tinted "Start with full access" panel inside each card (full-access warning uses amber border and muted amber text; unchecked in Gemini), then `Reinstall` and `Show command`. The full-access toggle is a checkbox here but a toggle switch in Settings (d-55). The top right `Update all` is an unreadable disabled green.

### 3.6 Files and diffs (d-43 to d-52)
- Left rail 280px with three modes as a segmented control (`Files | Search | Review 2`), a "Go to file... Ctrl+P" field, then 3 collapsible groups (`Changes 2`, `Open in sessions 1`, `Smoke Project`). File rows carry: language glyph (`TS` in blue), name, grey directory, status letter (M amber, A green) right-aligned. Directory names are 11px grey and the "Open in sessions" row repeats a file that also appears in Changes.
- Editor header has 5 stacked control groups: tab (`README.md x`), breadcrumb (`src / sender.ts`), `Preview | Source`, `File | Changes +4 -2`, `Send to agent v`, `...`, a layout-split icon. Two segmented controls side by side with identical styling but different semantics (what to render vs what to compare).
- Right rail: `Outline | Activity` tabs plus a collapse icon, content one line ("send 1"; "Nothing to outline in this file."). The rail reserves 270px for 1 to 3 lines.
- Bottom panel: `Run | Problems` tabs and a collapse chevron, 32px tall even when idle; when opened (d-51) shows a form with 2 selects and 6 buttons in 2 rows (`Run`, `Restart`, `Stop`, `Edit command`, `Add command`, `Choose solution/project`, `Refresh`) with disabled Restart/Stop only 1.6:1.
- Markdown preview (d-44) renders on a neutral grey `#1f1f1f`-like surface that does not belong to the blue-grey ladder (`#0d1015` / `#161a22`). In light (l-44) the same panel is white against the `#e2e6e4` window, no border.
- Diff in editor (d-47): added lines are a full-width green wash with a `+` gutter glyph and a green 2px inset marker; the removed line is a pink wash with a left red bar. The Changes dialog (d-21) uses a different treatment (side-by-side with bright green/red washes and inline highlighted spans, header text "Before, last commit / After, your working copy") and the raw pane diff (d-22) a third. Three diff colour schemes.
- Review mode (d-48): left rail turns into a list with `0 of 2 viewed`, Previous/Next buttons, checkbox rows, a note textarea, a 100%-width disabled green button and two small buttons "Commit..." and "Discard sender.ts...". The destructive "Discard" sits next to Commit, same size, no colour.
- Quick open (d-50) is the best file surface: filter, preview and kbd footer.
- Context menu (d-46): 32px rows, right-aligned shortcut text at 11px, separators. It is the only menu with shortcuts in muted right alignment and 6 groups; it appears flush at the cursor, not clamped (covers the bottom status bar).

### 3.7 Board (d-28, d-29) - see 3.2.

### 3.8 Replay and timeline (d-18, d-53)
- Replay (d-53): `Back`, orange "Replay" word and the title, read-only text on the right, the terminal canvas (empty) taking 800x660, a stats card "At this point", a search card; transport row at the bottom: skip-to-start, a big green play, skip-to-end, `0:00 / 0:07`, legend (`prompt`, `needs you`, `ended` with coloured diamonds), speed `1x 4x 16x`, `Skip idle time` checkbox. The slider track is 1100px wide with a 16px dot, but the legend markers sit below the transport instead of on the track. Two header texts (title, "Smoke . Claude Code . Oct 29 10:44 PM to running") in different greys.
- Timeline (d-18): see 3.1; events show times `12:00`, icons in 3 shapes (message, pencil, x/check), `You asked` bold prefix. Mono is used for file names and commands, UI font for prompt text. Success `24 passed` is green and failure `23 passed . 1 failed` red; both use the diff colours.

### 3.9 Skills / Projects / Work / Usage (d-37 to d-42)
- Each page re-implements its header: Projects: H1 22px + "tab group" container with a filled green-text active tab + description line; Skills: H1 + description + right-aligned Refresh, then text tabs with underline-less filled active tab, then pill filters (All Claude Codex Gemini Shared) in outlined chips with the active in green text; Usage: H1 + 3 range pills inline on the same line + right-aligned grey note; Work: H1 + 3 range pills + prev/next arrows + `Today` + `Sessions | Tickets` segmented + `Copy summary` + `Refresh` on one 48px line. Four different tab/segment designs for the same function (see section 4).
- Left page padding: Projects/Agents `40px` (content at x=288), Skills `24px` (x=272), Work `40px`, Settings has its own sidebar at x=259 and content at x=508. Titles sit at y=96 (Projects), 83 (Agents), 88 (Skills, Usage), 89 (Work).
- Usage (d-41): 4 KPI blocks (`Spend $4.25`, `Tokens 1.3K`, `Sessions 1`, `Busiest day Thu 29`) in 32px bold with 11px label above and 11px muted sub-label below: the generic hero-metric row. Chart: 7 bars with only one populated bar (violet = Codex) in 112px of height with y labels `1.3K 650 0` in mono; the legend (Claude/Codex/Gemini) is at the top right, 340px away from the bars. By project/By agent tables: mono numerals, right aligned, upper-case 10px headers with wrapping; "not reported" wraps onto two lines in a 60px cell; Claude Code is listed with `0 0 0 $4.25` so the same row contradicts itself (0 tokens, $4.25 cost).
- Work (d-42): the table is repeated as a sentence ("1 feature . 1 bug . 0 other changes . 0 conversations . 2 total") above the "Per project" table, which repeats the same 6 numbers.
- Skills (d-37): empty state is one sentence, no illustration or action; "Export skills" is a disabled-looking button next to the search.
- Projects tab (d-38): rows have a 15px bold name, mono path in grey (red when missing, plus "This folder does not exist." under it), agent glyph + name, branch, `3 sessions` with spinner, then `New session` and `...`. Row separators are 1px, row height 63px.
- Tasks tab (d-39): the project select spans 1112px, then a primary "New task" button, then two cards of different heights side by side (`No tasks in this project yet.` / `Create a task to start its history.`) that look like a list + detail but are empty states stacked at different heights.
- Instructions tab (d-40): 3 file rows, a shared textarea, 2 unlabeled checkboxes, 3 status lines starting with bold file names ("CLAUDE.md nothing to apply, the shared text is empty"), and a disabled primary; copy is lower-case run-on.

### 3.10 Remote Access / Settings (d-55 to d-64)
- Settings is a 2-column page: 210px section list + a 560px content column, with H1 "Settings" and an H2 repeating the section ("General"), plus a lede ("Keyboard shortcut, sidebar, recordings and setup.") that duplicates the nav's own subtitle. Rows are label-left / control-right with 60px row pitch; labels are 13px grey ("Sessions", "Tag colours", "Recap", "Sidebar") with the real label in the control text ("Dim sessions you're not working in"), so every row reads twice.
- Toggles: custom switches here (d-55) vs checkboxes in Agent tools/Run (d-36, d-30) vs tick boxes in Instructions (d-40). The switch's off state is a grey track with a white knob (3:1 not met in light).
- Remote Access tab (d-63): 5 stacked bordered cards (status, connect a phone, connection, phones, what a phone can do) with 11px helper text and 7 toggles; "Beta" badge next to H2. The Theme popover (d-64) opens over the tab with 8 swatch rows ("Dawsha Daylight, dark terminal" wraps to 2 lines, theme kind `dark`/`light` as right text), the background image block and two sliders (Dim 60%, Blur 0px).
- Theme lives in a topbar popover while the Settings lede tells users "Theme and background image stay in the Theme menu": a cross-reference to a control that is not in Settings.
- The setting names mix voice: "Sessions", "Tag colours", "Recap" as labels; descriptions "Off by default. Recordings keep everything a terminal prints, including secrets you display, in plain text on this PC." is a 4-line paragraph in a 240px column (d-55).

### 3.11 Dialogs, popovers, menus, toasts (d-11, 13, 15, 16, 17, 25, 27, 34, 46, W-01, U-02)
- Dialogs: command palette (640px, blur scrim), shortcuts (620px), close-confirm (460px), run (600px), What's new (560px) all use the same `--overlay` surface `#252b37` but different radii (14px vs 12px), title sizes (15/13/13), close "x" placement (inline vs corner vs none) and footers (Close / Got it / Cancel). The shortcuts sheet's search field has a 2px green focus ring while the palette's search has no field at all; the close-confirm has a coral filled destructive button with the item named: this is the right pattern.
- What's new (W-01): the changelog is rendered as bullet text with inline " - " separators inside a single list item ("... - Eight built-in agents ... - Run an agent ..."), so each bullet is a 200-word paragraph, scrolling at 700px. Headings "Added" are muted 11px.
- Update popover (U-02): 420px card hanging from the pill, 4 sections, the "Later" button is borderless text; link "View on GitHub" is underlined green.
- Notifications popover (d-27): 320px, row with icon, title, relative time and "Go to session" button; `Clear` and `x` both in the header (two ways to dismiss).
- Menus: at least 6 menu skins: `.menu` (pane actions, with icons and kbd), `.ctx-menu` (files, no icons, kbd), `.pv-menu` (preview), `.filter-menu`, `.select-menu`, sidebar menu (text only, d-06/d-09/G-06) and the More menu (text only, d-16). Row heights 28 to 34px, paddings differ, only 2 have icons, only 2 show shortcuts.
- Toasts: z-index 10000, the only shot attempted failed (toasts are removed too quickly for a screenshot); the notification history keeps the same text as the toast.

### 3.12 Onboarding and empty states (A-01, A-02, d-37, d-39, d-28, U-02)
- Onboarding (A-01): 3-step checklist in a 560px dialog: numbers 1-3 at 13px, bold step titles, 11px helper lines, `Add project` primary on step 1 only, `Open Agent tools` as a ghost link at 60% opacity, three example prompt chips ("Explain this codebase", "Find and fix a failing test", "Write a README") at 11px opacity .5, a disabled primary, a tip line, "Everything stays on this computer...", and a `Skip` button. It contains 7 text blocks and no illustration. Disabled steps are too faint to read at all (section 2.3).
- No-session shell (A-02, U-02): centred "No sessions yet / Press Ctrl+N or pick a project... / New session". Fine and short.
- Empty states elsewhere are individually written and styled: Board (2 sentences, left-aligned in column), Skills (one line), Tasks (two cards), Replay (blank canvas), Recent (none). There is no shared empty component.

### 3.13 Motion
- Interaction feedback is 120ms ease-out everywhere (`--t-feedback`), plus 13 one-off durations. Spinners (`state-spin` 1.1s linear), agent avatar breathing (crew), bar fills. No entrance motion for popovers/dialogs except opacity; no enter/exit symmetry (menus appear in place). Reduced-motion blocks exist (9). The needs-you event has no motion cue at all beyond the static ring; the crew avatars "flash" but session panes do not.

### 3.14 Light theme issues (all `l-*` files)
- `--state-working` fails (2.0-2.5:1) as measured above (l-G-02, l-28, l-03).
- The window background `#e2e6e4` is a green-grey and the panes are pure white `#fff`; pane/card separation relies on a 1px `rgb(24 28 40 / .10)` ring, 1.3:1 against the window. In l-G-02 the 3 panes are legible only by their text; the sidebar `#edf0ee` and the window `#e2e6e4` are within 1.1:1.
- Scrim behind dialogs is a heavy grey-green `rgb(...)` over the whole window (l-11, l-13, l-25): the dialog is whiter than everything but the page behind looks dirty rather than dimmed.
- Terminal ANSI dim/bright colours are tuned for dark; the faint `Claude Code` box-drawing in l-G-02 and dim result lines are nearly invisible.
- Selection tints: Maya's row in l-30 is lavender while all other selected rows are white/green: inconsistent.
- Primary buttons switch from `#34d399` (dark text) to `#087049` (white text): consistent in itself, but the top bar then has a very dark green button that outweighs everything else.

### 3.15 RTL / Arabic
- Not exercisable in the fixtures. Code-level: only `Dawsha Arabic` is registered (3 weights, `size-adjust: 112%`). The stylesheets mix 46 logical-property or `:dir` uses (`margin-inline`, `padding-inline`, `inset-inline`) with 96 physical ones (`border-left/right`, `margin-left/right`, `padding-left/right`, `left:`/`right:`), so mirroring will be partial. `dir` handling in TS exists only in `terminalArabic.ts` (terminal text); no app-level `dir` switch was found.

---

## 4. Cross-app inconsistencies

| Component | Variants found | Where |
|---|---|---|
| Page title + header | 6 patterns: H1 22px + tab group (Projects), H1 + description (Skills, Settings), H1 + inline range pills (Usage), H1 + range pills + stepper + view toggle + 2 buttons (Work), H1 + count + search + 2 buttons (Agents), no H1 (Files, Board, Replay uses a Back link) | d-38, d-37, d-41, d-42, d-30, d-43, d-28, d-53 |
| Tabs / segmented | (a) top nav text tabs with filled pill (Sessions/Agents/Files/More), (b) Grid/Board segmented with dark filled active, (c) Projects tab group in a grey container with green text, (d) Skills `Installed skills / Installed agents` filled tab + pill filters, (e) Usage/Work range pills, (f) Files `Files / Search / Review` segmented in a grey container, `Preview / Source` and `File / Changes` segmented, `Outline / Activity` tabs, `Run / Problems` tabs, (g) Replay speed `1x 4x 16x` with green outline, (h) crew `Goals / How she leads`, `Setup / Runs 0` underlined tabs, (i) timeline `This session / All sessions` | at least 9 skins |
| Buttons | primary green (36px top bar, 32px pages, 24px chips "Allow"), secondary outlined `.btn` (32px), `.btn.small` (24-28px), ghost text button (Later, Cancel, Show command), danger filled coral (close confirm), danger text red (Discard..., Delete...), icon buttons (16px glyph in 28-32px hit), orange Allow (needs state), disabled green | everywhere |
| Chips / pills | tag chip (feature green), `resumed` italic chip, state pill (icon + word, no bg), model chips (radio), filter chips (timeline, skills), status flag `Up to date`, `M`/`A` letters, `Beta` badge, `Modified`/`New` filled chips (d-21), `stale` italic, project count `3 live` | d-G-02, d-34, d-18, d-37, d-36, d-47, d-21 |
| Cards | pane (10px radius, ring), board card (ring + shadow), agent tool card (ring + amber inner panel), settings cards (Remote, 5 stacked), KPI blocks (no card), tasks empty cards, notifications rows, crew list rows | d-28, d-36, d-63, d-41, d-39 |
| Empty states | Board column (bold + muted sentences), Skills (one line), Tasks (two cards), Replay (blank), Agents "Yours 0" (3-line helper), Settings Remote "No phones are paired yet.", Layouts (sentence + primary), onboarding checklist, "No sessions yet" shell | see 3.12 |
| Dialogs | palette, shortcuts, run, close-confirm, what's-new, onboarding, changes, handoff, compare, new session quickpick, resume picker: different widths (460-1400px), radii, close-button placement (inline x, corner x, none), footer order (Cancel left of primary vs Close right) | d-11, 13, 25, 34, W-01, A-01, 21, 02 |
| Popovers | limits, notifications, layouts, update, theme, project menu: heads differ (title + count + x, title + Clear + x, title + x), widths 300-420px, shadow same `--shadow-pop` | d-10, 27, 15, U-02, 64 |
| Menus | pane actions (icons + kbd), files context (kbd, no icons), More (plain), sidebar (plain, coloured tag words), select-menu (custom), native `<select>` in Agents / Projects / Tasks / Usage | d-17, d-46, d-16, G-06, d-30, d-39 |
| Toggles | switch (Settings), checkbox (Agent tools, Maya goal, Run), plain boxes (Instructions), icon toggle (Dim others), segmented (Where: New pane / Background) | d-55, d-36, d-30, d-40, d-34 |
| Inputs | search field with icon (sidebar filter, Files "Go to file", palette), plain 38px fields (Agents search), 32px selects, textareas (180px empty, 100px prompt), inline text-input with ring (shortcuts) | d-08, d-43, d-33 |
| Diff rendering | pane raw git diff, Changes dialog side-by-side, Files inline diff | d-22, d-21, d-47 |
| Status vocabulary | `Needs you` / `Working` / `Idle` / `Done` / `Reviewed` / `Done, to review` / `resumed` / `stale` / `Up to date` / `not reported` | many |
| Page gutters | 40px (Projects, Agents, Work), 24px (Skills), 56px rail (maximize), 280px side rails | d-37 vs d-38 |

---

## 5. Top 15 problems by impact on the core loop (watch several sessions, notice which needs you, answer, review changes)

1. Allow/Deny bar does not show what is being approved. The approval sits at the bottom of a tall pane (y=832) and carries only "Claude is waiting for your answer"; the command is in the scroll buffer above (G-02). Answering is the highest-frequency action and needs context at the point of action.
2. "Needs you" is visually weaker than it should be: 1px orange ring vs 1px white focus ring, 11px orange word, and a thin top-bar chip; no motion, no size change. In light the ring (`#c2620a`) and the focused ring are both 1px outlines (l-G-02). In a 5-pane grid it would take a scan to find.
3. 5-pane grid is unreadable: 3 columns wrap terminal output at 33 characters (G-03), every pane footer repeats "Turn on live info", and pane headers drop to number + title + state circle. The grid has no "important panes bigger" behaviour for needs/working/done.
4. Pane header is overloaded and changes with focus: up to 9 elements, 3 sizes, 1 vs 4 buttons depending on focus (G-02), state word in different x positions per pane. Actions are hidden behind a 22-item flat menu (d-17).
5. Light theme state colours fail contrast: working blue at 2.0-2.5:1 (state-working token not themed), dim terminal text ~1.8:1, ring contrast between white panes and window ~1.3:1 (l-G-02, l-28).
6. Reviewing changes is spread over three diff surfaces with three colour schemes (pane raw diff d-22, Changes dialog d-21, Files d-47/d-48) plus Review mode with Discard next to Commit at the same size (d-48). The path from "pane says Review 1 file" to a reviewable diff is not obvious: the footer link has no affordance.
7. Navigation is fragmented: top tabs, a More menu whose children light "More" instead of the page (d-36..42), a gear, a project rail, and in maximize a top strip + left rail + right panel (d-24). Agents vs Agent tools vs Skills names collide.
8. Top bar density: 17 targets in one row with irregular gaps; two ambiguous icons (half-circle dim vs half-circle-like theme glyph, and a help-looking icon that opens Theme); usage meter is 11px with 38px bars, "stale" shown when no agent is focused, and disagrees with the Usage page ("Reset time not reported" vs "resets in 1h 37m").
9. Type scale has no hierarchy: 11/12/13 carry 89% of text, weight 600 is the only emphasis, mono is used for UI numbers and footers, so a screen has no clear first read (d-41, d-42, d-G-02).
10. Control height and component variants are uncontrolled: 9 control heights, 9 tab/segment skins, 6 menu skins, 5 toggle types (section 4). Every new feature adds another variant.
11. Disabled/dimmed states are unreadable (1.6-2.2:1): onboarding steps, Update all, Apply to all files, disabled Run buttons. The first-run screen is the least readable in the app (A-01 both themes).
12. Sidebar rows lack identity: four sessions titled "Smoke", each with "Idle . now"; "No sessions . 3" lists project names that look identical to live ones, the missing-folder project is not flagged; right-click on projects does nothing (d-07); menus overlap neighbours (G-06).
13. Sub-view pages are inconsistent in gutter, title position and header content (24 vs 40px, titles at y 83 to 96, 6 header patterns), and the Settings page repeats title, section name and lede, and each row twice (label + control text) (d-55).
14. Board with peek breaks: 4 columns squeezed into 640px with clipped titles, truncated cards, a horizontal scrollbar and a cut "New session" button (d-29); empty columns hold 2-sentence help text that competes with the cards.
15. Dialog/popover system lacks a shared shell: radii 12 vs 14, close-button placement, footer order, 460 to 1400px widths, What's-new renders a 200-word run-on bullet with raw " - " separators (W-01), changelog is not parsed.

Also noted (not ranked): Arabic/RTL is only partly covered by logical properties (46 logical vs 96 physical); the Usage table contradicts itself (Claude Code 0 tokens, $4.25); tokens carry 19 aliases and 2 dead variables; 62 hex + 28 rgba literals bypass the theme system, so third-party themes (Nord, Catppuccin, GitHub Light) cannot recolour them.

---

## 6. What already works and must be kept

- The state model and its coverage: five states with icon + word + colour, repeated in pane header, sidebar rows, top-bar chip ("1 needs you"), "Waiting on you" sidebar block, bell notifications and the board columns (G-02, d-28). Needs-you has a real affordance (Allow Enter / Deny Esc) with keyboard hints.
- The surface ladder and token architecture: `--bg/--sidebar/--surface/--raised/--surface-pop/--well` with themes setting them from `themes.ts`; 8 themes with swatch previews (d-64); `color-mix` tinting makes hovers/rings theme-proof; spacing tokens carry 73% of spacing; light theme is a genuine design, not an inversion (accent `#087049`, needs `#9a4a00`, text 16.7:1).
- Dark default contrast: every text/accent/state combination passes 4.5:1 on all surfaces except 11px muted on `--surface-pop` (4.6, still passing).
- The terminal is treated as the hero: dark recessed well, no chrome over it, readable mono at 15px, per-pane font stepper.
- The command palette (d-11): grouped Sessions/Actions/Projects, kbd hints, footer legend; the Ctrl+P quick open with preview (d-50); the Resume picker with preview and the two actions "Resume in new pane / this pane" (d-02); the Run dialog with live command preview (d-34); close-confirm that names the session on the destructive button (d-25).
- Files workspace: Changes / Open in sessions / tree grouping, M/A badges, inline diff with gutter markers, search with options, "Send to agent" and "Add to prompt" tying files back to the agent loop (d-43 to d-50).
- Agents "crew": avatars with live state, built-in roster, Maya's plan-first goal box, Yours/Built-in sections (d-30..d-34), and the clear "Never run" / state words.
- The notification flow: bell with badge, history with "Go to session" (d-27), and the Waiting-on-you block that jumps to the session (Ctrl+Shift+J).
- Accessibility plumbing: 9 reduced-motion blocks, reduced-transparency and prefers-contrast queries, `:focus-visible` rings, aria-labels on panes ("Task 1 ..."), roles on tabs/dialogs, `[hidden]` guard.
- Keyboard-first design: shortcuts sheet with search (d-13), Ctrl+1-9 focus, Ctrl+Shift+J, N/P in Review, Ctrl+Enter in dialogs.
- Calm-by-default intentions: no gradients, no glow, no `transition: all`, no decorative blur; `Dim others` and `Recap` features serve the monitoring job.
