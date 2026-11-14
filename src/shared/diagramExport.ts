export const DIAGRAM_EXPORT_MAX = 16 * 1024 * 1024

export function diagramFileName(path: string): string {
  const leaf = path.split(/[\\/]/).pop() ?? ''
  const stem = leaf.replace(/\.[^.]*$/, '').replace(/[<>:"|?*\x00-\x1f]/g, '').trim()
  return `${stem || 'diagram'}.svg`
}

export function validDiagramPng(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DIAGRAM_EXPORT_MAX && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/.test(value)
}
