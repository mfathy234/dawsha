import qrcode from 'qrcode-generator'

const SVG = 'http://www.w3.org/2000/svg'
const QUIET_ZONE = 4

// A QR code as one SVG path. Dark modules on a light tile, whatever the app theme,
// because phone cameras read dark-on-light codes most reliably.
export function qrSvg(text: string, label: string): SVGSVGElement {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  const count = code.getModuleCount()
  const size = count + QUIET_ZONE * 2
  let d = ''
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`
    }
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', label)
  svg.setAttribute('shape-rendering', 'crispEdges')
  const background = document.createElementNS(SVG, 'rect')
  background.setAttribute('width', String(size))
  background.setAttribute('height', String(size))
  background.setAttribute('fill', '#ffffff')
  const modules = document.createElementNS(SVG, 'path')
  modules.setAttribute('d', d)
  modules.setAttribute('fill', '#0c0e12')
  svg.append(background, modules)
  return svg
}
