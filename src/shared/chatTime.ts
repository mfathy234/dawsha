export const dayKey = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** "Today", "Yesterday", or the date; in the user's own locale. */
export function dayLabel(at: number, now: number, locale?: string): string {
  if (dayKey(at) === dayKey(now)) return 'Today'
  if (dayKey(at) === dayKey(now - 24 * 60 * 60 * 1000)) return 'Yesterday'
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
  return new Date(at).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

export const timeLabel = (at: number, locale?: string): string => new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

export const fullTimeLabel = (at: number, locale?: string): string => new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' })

/** The indexes where a new day starts: before the first dated item and each time the day changes. Items without a time never start one. */
export function dayStarts(times: readonly (number | undefined)[]): number[] {
  const starts: number[] = []
  let current = ''
  times.forEach((at, index) => {
    if (at === undefined) return
    const key = dayKey(at)
    if (key === current) return
    current = key
    starts.push(index)
  })
  return starts
}
