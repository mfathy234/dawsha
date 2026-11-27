// node tests/perf/profileTop.cjs <file.cpuprofile> [count]: the functions with the most self time, as a share of the profile.
const { readFileSync } = require('node:fs')
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const count = Number(process.argv[3] ?? 25)
const byId = new Map(profile.nodes.map((node) => [node.id, node]))
const self = new Map()
let total = 0
profile.samples.forEach((id, i) => {
  const delta = profile.timeDeltas[i] ?? 0
  total += delta
  self.set(id, (self.get(id) ?? 0) + delta)
})
const byFunction = new Map()
for (const [id, time] of self) {
  const { callFrame } = byId.get(id)
  const key = `${callFrame.functionName || '(anonymous)'} ${callFrame.url.split(/[\\/]/).slice(-2).join('/')}:${callFrame.lineNumber + 1}`
  byFunction.set(key, (byFunction.get(key) ?? 0) + time)
}
const rows = [...byFunction].sort((a, b) => b[1] - a[1]).slice(0, count)
const idle = byFunction.get('(idle) :1') ?? 0
console.log(`total ${(total / 1000).toFixed(0)} ms, idle ${(idle / 1000).toFixed(0)} ms, busy ${((total - idle) / 1000).toFixed(0)} ms`)
for (const [key, time] of rows) console.log(`${(time / 1000).toFixed(0).padStart(7)} ms ${((time / total) * 100).toFixed(1).padStart(5)}%  ${key}`)
