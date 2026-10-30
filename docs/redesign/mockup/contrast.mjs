import fs from 'node:fs'
const css = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
const grab = (name) => css.split(`[data-theme='${name}'] {`)[1].split('\n}')[0]
const blocks = { dark: grab('dark'), light: grab('light') }
const vars = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const mix = (a, b, p) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * p + parseInt(b.slice(i, i + 2), 16) * (1 - p)).toString(16).padStart(2, '0')).join('')
let fail = 0
for (const t of ['dark', 'light']) {
  const v = vars(blocks[t])
  const surfaces = ['bg', 'sidebar', 'surface', 'raised', 'pop', 'well']
  const texts = ['text', 'text-2', 'text-3', 'accent-ink', 'st-working', 'st-needs', 'st-done', 'st-idle', 'st-error', 'danger']
  for (const x of texts) for (const s of surfaces) { const r = cr(v[x], v[s]); if (r < 4.5) { fail++; console.log(t, 'FAIL', x, 'on', s, r.toFixed(2)) } }
  for (const x of ['term-fg', 'term-dim', 'term-add', 'term-del', 'term-warn', 'term-cmd', 'term-prompt']) { const r = cr(v[x], v.well); const r2 = cr(v[x], v.surface); if (r < 4.5 || r2 < 4.5) { fail++; console.log(t, 'FAIL', x, r.toFixed(2), r2.toFixed(2)) } }
  for (const s of ['working', 'needs', 'done', 'idle', 'error']) for (const base of ['surface', 'sidebar', 'well']) { const bg = mix(v['st-' + s], v[base], 0.14); const r = cr(v['st-' + s], bg); if (r < 4.5) { fail++; console.log(t, 'FAIL tint', s, base, r.toFixed(2)) } }
  for (const [a, b] of [['on-accent', 'accent'], ['on-danger-fill', 'danger-fill'], ['ag-claude-fg', 'ag-claude-bg'], ['ag-codex-fg', 'ag-codex-bg'], ['ag-gemini-fg', 'ag-gemini-bg']]) { const r = cr(v[a], v[b]); if (r < 4.5) { fail++; console.log(t, 'FAIL', a, b, r.toFixed(2)) } }
  // accent-ink on accent tint
  const r = cr(v['accent-ink'], mix(v.accent, v.surface, 0.14)); if (r < 4.5) { fail++; console.log(t, 'FAIL accent chip', r.toFixed(2)) }
  console.log(t, 'text-3 on pop', cr(v['text-3'], v.pop).toFixed(2), 'text-3 on bg', cr(v['text-3'], v.bg).toFixed(2))
}
console.log(fail ? fail + ' failures' : 'all pass')
