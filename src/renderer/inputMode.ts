const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta'])

// Chromium can keep a keyboard focus ring on a button that is clicked afterwards (for example after Alt+Tab back into the window).
// Tracking the last input device lets the stylesheet show focus rings only while the keyboard is in use.
export function installInputMode(): void {
  const root = document.documentElement
  root.dataset.input = 'pointer'
  document.addEventListener('pointerdown', () => { root.dataset.input = 'pointer' }, true)
  document.addEventListener('keydown', (event) => {
    if (!MODIFIERS.has(event.key)) root.dataset.input = 'keyboard'
  }, true)
}
