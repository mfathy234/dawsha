export interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

export interface ProfileSummary {
  /** The functions with the most time of their own. */
  self: { frame: string; ms: number }[]
  /** The functions that were on the stack the longest, whatever their own time: shows which feature ran when the time went to native code. */
  inclusive: { frame: string; ms: number }[]
}

const FRAMES_KEPT = 10
const MAX_DEPTH = 200
const IDLE = new Set(['(idle)', '(program)', '(root)'])

function label(node: CpuProfile['nodes'][number]): string {
  const { functionName, url, lineNumber } = node.callFrame
  const file = url.split(/[\\/]/).pop() ?? ''
  return `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`.trim()
}

function top(totals: Map<string, number>): { frame: string; ms: number }[] {
  return [...totals].sort((a, b) => b[1] - a[1]).slice(0, FRAMES_KEPT).map(([frame, ms]) => ({ frame, ms: Math.round(ms) }))
}

/** What ran in the last `windowMs` of a CPU profile, by own time and by time on the stack. */
export function summarizeProfile(profile: CpuProfile, windowMs: number): ProfileSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
  const parents = new Map<number, number>()
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
  const samples = profile.samples ?? []
  const deltas = profile.timeDeltas ?? []
  const own = new Map<string, number>()
  const inclusive = new Map<string, number>()
  let remaining = windowMs
  for (let index = samples.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const weight = (deltas[index] ?? 0) / 1000
    remaining -= weight
    const first = nodes.get(samples[index])
    if (!first || IDLE.has(first.callFrame.functionName)) continue
    const seen = new Set<string>()
    let current: number | undefined = samples[index]
    for (let depth = 0; current !== undefined && depth < MAX_DEPTH; depth += 1) {
      const node = nodes.get(current)
      if (!node) break
      const name = label(node)
      if (depth === 0) own.set(name, (own.get(name) ?? 0) + weight)
      if (!seen.has(name) && !IDLE.has(node.callFrame.functionName)) inclusive.set(name, (inclusive.get(name) ?? 0) + weight)
      seen.add(name)
      current = parents.get(current)
    }
  }
  return { self: top(own), inclusive: top(inclusive) }
}
