# Terminal rendering

All live terminals, replay terminals, the headless remote mirror and the phone's
browser terminal use `@xterm/addon-unicode11@0.9.0` with active version `11`.
String column measurements use the same addon's public width provider, including
combining marks. The Arabic overlay reads widths directly from xterm cells.

Unicode 11 was chosen because xterm still labels the grapheme addon experimental.
It keeps column calculations deterministic across WebGL, DOM and headless
terminals. It does not collapse joined emoji sequences into a single grapheme.
See the [upstream addon list](https://github.com/xtermjs/xterm.js#addons).

The existing **Terminal rendering** settings area in General contains:

| Setting | Default | Behavior |
| --- | --- | --- |
| Show images in the terminal | On | Live terminals decode sixel and iTerm IIP images. |
| Font ligatures | Off | Live terminals join common programming sequences in supporting fonts. |

Both preferences apply immediately to existing terminals and to future ones.
They are persisted, searchable, and included in settings export/import.

## Images

`@xterm/addon-image@0.9.0` is loaded only in live desktop terminals. Its FIFO
cache is limited to 32 MB, individual images to 4 million pixels, and each
protocol payload to 8 MB. Cache usage is checked after rendering because the
addon can allocate scaled copies during font zoom without enforcing its limit.
Decoder scratch space and temporary scaled canvases are additional to the cache.
Terminal output cannot enable window size reports through this addon.

A sixel finalization guard also bounds declared dimensions and implicit height
to 4096, repeat counts to 4096 and declared pixel area to 4 million. This prevents
zero-width images with excessive height from forcing unbounded cursor movement.
The guard operates through xterm's public parser API and covers split writes.

Disabling images clears stored images and blocks both image protocols. The addon
instance stays attached until terminal disposal so image IDs left in buffer cells
cannot collide with new images after re-enabling. Evicted images leave blank
cells. The image canvas and storage survive WebGL sleep/wake and renderer changes.
Disposing the terminal releases addons, parser blockers and the cache watcher.

The desktop CSP permits `wasm-unsafe-eval` for the image decoder. It continues to
block JavaScript `unsafe-eval`. Browser-created image bitmaps decode IIP images;
no Node bridge or additional remote sources are needed.

## Ligatures

`@xterm/addon-ligatures@0.10.0` loads after terminal open. Its browser fallback
recognizes common sequences such as `===`, `!=`, `=>`, `->` and `<=`, and uses
the existing character joiner service shared by DOM and WebGL. The addon enables
`calt` and `liga`; disabling it removes the joiner and refreshes existing text.
Context isolation and denied local-font permissions remain in place. No Node
font access is exposed. Actual joined glyphs depend on a supporting installed
font, such as JetBrains Mono, already preferred by Dawsha's terminal font stack.
See the [upstream fallback documentation](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-ligatures#fallback-ligatures).

Keep the three addons above in package.json/package-lock.json. The unused
`@xterm/addon-unicode-graphemes` dependency was removed with a package-lock-only
uninstall; shared node_modules were left unchanged.
