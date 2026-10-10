export interface ProcessActivity {
  tabId: string
  pid: number
  name: string
  parentPid: number | null
  startedAt: number | null
  alive: boolean
}

export interface ProcessRoot {
  tabId: string
  pid: number
  startedAt: number
}
