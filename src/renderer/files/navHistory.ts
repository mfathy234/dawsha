export interface NavPoint {
  path: string
  pos: number
}

export interface NavHistory {
  back: readonly NavPoint[]
  forward: readonly NavPoint[]
}

export const EMPTY_HISTORY: NavHistory = { back: [], forward: [] }

const MAX_ENTRIES = 100

const same = (a: NavPoint, b: NavPoint): boolean => a.path === b.path && a.pos === b.pos

/** A jump left `from`: it becomes the Back target and anything Forward is dropped. */
export function recordJump(history: NavHistory, from: NavPoint): NavHistory {
  const last = history.back[history.back.length - 1]
  const back = last && same(last, from) ? history.back : [...history.back, from].slice(-MAX_ENTRIES)
  return { back, forward: [] }
}

export interface Step {
  history: NavHistory
  to: NavPoint
}

/** Back from `current`: the latest Back entry is the place to open, `current` moves to Forward. */
export function stepBack(history: NavHistory, current: NavPoint): Step | null {
  const to = history.back[history.back.length - 1]
  if (!to) return null
  return { to, history: { back: history.back.slice(0, -1), forward: [...history.forward, current].slice(-MAX_ENTRIES) } }
}

export function stepForward(history: NavHistory, current: NavPoint): Step | null {
  const to = history.forward[history.forward.length - 1]
  if (!to) return null
  return { to, history: { back: [...history.back, current].slice(-MAX_ENTRIES), forward: history.forward.slice(0, -1) } }
}

/** Closed files cannot be reopened, so their entries are dropped. */
export function forgetPath(history: NavHistory, path: string): NavHistory {
  return { back: history.back.filter((point) => point.path !== path), forward: history.forward.filter((point) => point.path !== path) }
}
