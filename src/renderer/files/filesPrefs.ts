import { defaultLayout, parseLayout, type FilesLayout } from '../../shared/filesLayout'

const KEY = 'dawsha.files.layout'

let layout: FilesLayout | null = null

/** The remembered Files layout (folded sections, inspector, bottom panel). Storage can be blocked, so it falls back to the default. */
export function filesLayout(): FilesLayout {
  if (layout) return layout
  try {
    layout = parseLayout(JSON.parse(localStorage.getItem(KEY) ?? 'null'))
  } catch {
    layout = defaultLayout()
  }
  return layout
}

export function updateLayout(change: (current: FilesLayout) => FilesLayout): FilesLayout {
  layout = change(filesLayout())
  try {
    localStorage.setItem(KEY, JSON.stringify(layout))
  } catch {
    // remembered for this run only
  }
  return layout
}
