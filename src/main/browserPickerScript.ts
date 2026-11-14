/** Runs in a separate, API-free JavaScript world in the sandboxed guest. Keep this function self-contained. */
function installPicker(): Promise<unknown> {
  const scope = window as unknown as { __dawshaCancelPick?: () => void }
  scope.__dawshaCancelPick?.()
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483647;outline:2px solid Highlight;outline-offset:-2px;background:transparent;display:none'
    document.documentElement.append(overlay)
    const compact = (value: string | null | undefined, max = 500): string => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
    const unique = (selector: string): boolean => {
      try { return document.querySelectorAll(selector).length === 1 } catch { return false }
    }
    const selectorFor = (element: Element): string => {
      const parts: string[] = []
      let current: Element | null = element
      while (current && parts.join(' > ').length < 1800) {
        const tag = current.localName
        if (current.id) {
          const id = `${tag}#${CSS.escape(current.id)}`
          if (unique(id)) return [id, ...parts].join(' > ').slice(0, 2048)
        }
        const testId = current.getAttribute('data-testid')
        if (testId) {
          const tested = `${tag}[data-testid="${CSS.escape(testId)}"]`
          if (unique(tested)) return [tested, ...parts].join(' > ').slice(0, 2048)
        }
        let part = tag + Array.from(current.classList).slice(0, 3).map((name) => `.${CSS.escape(name)}`).join('')
        if (current === element && unique(part)) return part.slice(0, 2048)
        const siblings = current.parentElement ? Array.from(current.parentElement.children).filter((sibling) => sibling.localName === tag) : []
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`
        parts.unshift(part)
        const selector = parts.join(' > ')
        if (unique(selector)) return selector.slice(0, 2048)
        current = current.parentElement
      }
      return parts.join(' > ').slice(0, 2048)
    }
    const highlight = (element: Element | null): void => {
      if (!element || element === overlay) return
      const rect = element.getBoundingClientRect()
      Object.assign(overlay.style, { display: 'block', left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` })
    }
    const finish = (element: Element | null): void => {
      cleanup()
      if (!element) return resolve(null)
      const rect = element.getBoundingClientRect()
      const labelled = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent ?? '').join(' ') : ''
      resolve({ tag: element.localName, id: compact(element.id), classes: Array.from(element.classList).slice(0, 20).map((name) => name.slice(0, 200)), name: compact(labelled || element.getAttribute('aria-label') || labels || element.getAttribute('alt') || element.textContent || element.getAttribute('title')), text: compact(element.textContent), selector: selectorFor(element), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } })
    }
    const move = (event: MouseEvent): void => { if (event.isTrusted) highlight(event.target instanceof Element ? event.target : null) }
    const swallow = (event: Event): void => { if (event.isTrusted) { event.preventDefault(); event.stopImmediatePropagation() } }
    const click = (event: MouseEvent): void => {
      if (!event.isTrusted) return
      swallow(event)
      finish(event.target instanceof Element ? event.target : null)
    }
    const key = (event: KeyboardEvent): void => {
      if (!event.isTrusted) return
      if (event.key === 'Escape') { swallow(event); finish(null) }
      else if (event.key === 'Enter' && document.activeElement instanceof Element) { swallow(event); finish(document.activeElement) }
    }
    const focus = (): void => highlight(document.activeElement)
    const cleanup = (): void => {
      document.removeEventListener('mousemove', move, true)
      document.removeEventListener('pointerdown', swallow, true)
      document.removeEventListener('pointerup', swallow, true)
      document.removeEventListener('click', click, true)
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focus, true)
      overlay.remove()
      delete scope.__dawshaCancelPick
    }
    scope.__dawshaCancelPick = () => finish(null)
    document.addEventListener('mousemove', move, true)
    document.addEventListener('pointerdown', swallow, true)
    document.addEventListener('pointerup', swallow, true)
    document.addEventListener('click', click, true)
    document.addEventListener('keydown', key, true)
    document.addEventListener('focusin', focus, true)
  })
}

export const PICKER_WORLD = 1017
export const PICKER_SCRIPT = `(${installPicker.toString()})()`
export const CANCEL_PICKER_SCRIPT = 'window.__dawshaCancelPick?.()'
