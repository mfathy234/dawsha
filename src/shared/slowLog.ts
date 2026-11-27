export interface SlowReport {
  /** How long the page's task ran. */
  ms: number
  /** The view that was open, such as "grid". */
  view: string
  /** What the page could tell about the task: its attribution, or the panes that were open. */
  detail: string
}
