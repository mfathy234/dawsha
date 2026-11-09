export interface TourRect { x: number; y: number; width: number; height: number }
export interface TourSize { width: number; height: number }
export interface TourPlacement extends TourRect { side: 'left' | 'right' | 'top' | 'bottom' }

export function nextTourStep(current: number, visible: readonly boolean[]): number {
  for (let index = current + 1; index < visible.length; index += 1) if (visible[index]) return index
  return -1
}

export function previousTourStep(current: number, visible: readonly boolean[]): number {
  for (let index = current - 1; index >= 0; index -= 1) if (visible[index]) return index
  return -1
}

export function placeTourCard(target: TourRect, card: TourSize, viewport: TourSize): TourPlacement {
  const gap = 16
  const margin = 12
  const right = target.x + target.width + gap
  const left = target.x - card.width - gap
  let side: TourPlacement['side'] = right + card.width <= viewport.width - margin ? 'right' : 'left'
  let x = side === 'right' ? right : left
  if (x < margin || x + card.width > viewport.width - margin) {
    side = target.y + target.height + gap + card.height <= viewport.height - margin ? 'bottom' : 'top'
    x = target.x + target.width / 2 - card.width / 2
  }
  const y = side === 'bottom' ? target.y + target.height + gap : side === 'top' ? target.y - card.height - gap : target.y + target.height / 2 - card.height / 2
  return { x: Math.max(margin, Math.min(x, viewport.width - card.width - margin)), y: Math.max(margin, Math.min(y, viewport.height - card.height - margin)), width: card.width, height: card.height, side }
}
