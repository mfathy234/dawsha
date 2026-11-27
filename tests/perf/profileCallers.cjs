// node tests/perf/profileCallers.cjs <file.cpuprofile> <functionName> [depth]: where the time of a function was spent, by calling stack.
const { readFileSync } = require('node:fs')
const profile = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const target = process.argv[3]
const depth = Number(process.argv[4] ?? 6)
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
const parent = new Map()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
const self = new Map()
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)))
const stacks = new Map()
const label = (node) => `${node.callFrame.functionName || '(anon)'}@${node.callFrame.url.split(/[\/]/).pop()}:${node.callFrame.lineNumber + 1}`
for (const [id, time] of self) {
  let node = nodes.get(id)
  if (node.callFrame.functionName !== target) continue
  const chain = []
  let current = id
  for (let i = 0; i < depth && current !== undefined; i += 1) { chain.push(label(nodes.get(current))); current = parent.get(current) }
  const key = chain.join(' < ')
  stacks.set(key, (stacks.get(key) ?? 0) + time)
}
for (const [key, time] of [...stacks].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`${(time / 1000).toFixed(0).padStart(6)} ms  ${key}`)
