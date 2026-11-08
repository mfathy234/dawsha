export interface SleepState {
  visible: boolean
  hiddenSince: number | null
}

export function terminalShouldSleep(state: SleepState, now: number, timeoutMs: number, enabled: boolean): boolean {
  return enabled && !state.visible && state.hiddenSince !== null && now - state.hiddenSince >= timeoutMs
}
