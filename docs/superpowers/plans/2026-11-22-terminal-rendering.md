# Terminal rendering implementation plan

**Goal:** Implement Dawsha 1.10.0 terminal rendering items 1–3 in `feat/term-render`.

**Architecture:** Use Unicode 11 in live, replay, headless and phone terminals. Reuse its public width provider for string measurements. Keep optional image and ligature addons in a small live-terminal rendering module, independent of WebGL lifetime. Follow the existing rendering setting through schema, transfer, search and UI.

**Constraints:** Work only in this worktree; never install into the shared node_modules junction. Images default on; ligatures default off. Preserve context isolation, bounded image memory and hidden-terminal sleep. Keep controls readable at 1024px.

**Choices:** Unicode 11 is compatible with xterm 6 and avoids the experimental grapheme provider. The ligature addon's browser fallback joins common programming sequences without Node font access; actual glyphs require a supporting font. Image cache: 32 MB; image pixel limit: 4 million; encoded protocol limits: 8 MB.

### 1. Unicode widths
- [x] Add failing tests for mixed emoji/checkmark/CJK columns, non-Latin combining marks, headless cursor placement and prompt cell mapping.
- [x] Load Unicode 11 in every terminal and measure strings using its provider.
- [x] Check prompt scraping and Arabic overlays for independent column calculations.
- [x] Run focused unit tests and commit `fix: align terminal character widths with Unicode 11`.

### 2. Inline images
- [x] Add failing tests for defaults, sanitization, persistence, transfer and settings search.
- [x] Add bounded live-terminal image support and a live setting under Terminal rendering.
- [x] Verify image disposal and image survival across WebGL replacement with Electron tests.
- [x] Run focused tests and commit `feat: show bounded inline terminal images`.

The Electron test caught the SIXEL decoder being blocked by CSP. The desktop page now permits `wasm-unsafe-eval` specifically; JavaScript evaluation stays blocked. Sleep testing simulates document backgrounding without PTY resizing, because Windows redraws real console output over renderer-injected fixtures on resize.

### 3. Ligatures
- [ ] Add failing tests for the off default, round-trip settings and live toggling.
- [ ] Load the browser-compatible ligature addon after terminal open, enable contextual ligatures, refresh immediately on toggles and WebGL replacement.
- [ ] Verify 1024px layout, browser isolation and renderer transitions in Electron.
- [ ] Remove unused grapheme package using package-lock-only uninstall.
- [ ] Run relevant unit tests, typecheck, build and nearby Electron tests; review the final diff and commit `feat: toggle terminal font ligatures live`.

**Review focus:** Mixed-width overwrite and wrapping; Arabic combining marks; images disabled during output; image state across hidden renderer sleep; toggles before terminal mount and after renderer replacement. Browser tests use temporary profiles. No realpathSync calls without `.native`.
