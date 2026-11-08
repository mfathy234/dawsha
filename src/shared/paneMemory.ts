export interface ProcessMemoryReading {
  tabId: string
  bytes: number
}

export function sumProcessMemory(readings: readonly ProcessMemoryReading[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const reading of readings) {
    if (!reading.tabId || !Number.isFinite(reading.bytes) || reading.bytes < 0) continue
    totals[reading.tabId] = (totals[reading.tabId] ?? 0) + reading.bytes
  }
  return totals
}

export function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
