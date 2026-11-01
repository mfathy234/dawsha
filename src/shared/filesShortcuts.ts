import { bind, formatShortcut, type KeyBinding } from './shortcuts'

export const FILE_ASK_SHORTCUT = 'Ctrl+I'

export function fileHistoryBinding(direction: 'back' | 'forward', platform = typeof navigator === 'undefined' ? '' : navigator.platform): KeyBinding {
  if (platform.toLowerCase().includes('mac') || platform === 'darwin') {
    return { key: '-', ctrl: true, shift: direction === 'forward', alt: false, physicalCtrl: true }
  }
  return bind(direction === 'back' ? 'Alt+ArrowLeft' : 'Alt+ArrowRight')
}

export function fileHistoryShortcut(direction: 'back' | 'forward'): { keys: KeyBinding[]; shortcut: string } {
  const binding = fileHistoryBinding(direction)
  return { keys: [binding], shortcut: formatShortcut(binding) }
}
