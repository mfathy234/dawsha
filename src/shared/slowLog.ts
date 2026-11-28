export interface SlowReport {
  /** How long the page's task ran. */
  ms: number
  /** The view that was open, such as "grid". */
  view: string
  /** What the page could tell about the task: its attribution, or the panes that were open. */
  detail: string
  /** The functions that ran during the task, when the page could sample them. */
  profile?: { self: { frame: string; ms: number }[]; inclusive: { frame: string; ms: number }[] }
  /** The slowest named steps the page ran just before. */
  phases?: { name: string; ms: number }[]
}
