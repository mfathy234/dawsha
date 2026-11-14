import { DOMImplementation, DOMParser, XMLSerializer, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'

export type DiagramResult = { ok: true; svg: string } | {
  ok: false
  error: string
  line?: number
  reason?: 'java' | 'jar' | 'render' | 'superseded'
}

export interface DiagramStatus {
  java: boolean
  jar: boolean
  jarOverride?: boolean
  downloadMegabytes: number
  version: string
}

export function parseJavaVersion(output: string): number | null {
  const match = output.match(/(?:openjdk|java)(?:\s+version)?\s+"?(\d+)(?:\.(\d+))?/i)
  if (!match) return null
  const version = Number(match[1]) === 1 ? Number(match[2]) : Number(match[1])
  return Number.isInteger(version) && version > 0 ? version : null
}

/** PlantUML's pipe CLI writes ERROR, a zero-based source line, then its own message. */
export function parseDiagramError(stderr: string, svg: string): { error: string; line?: number } {
  const plainSvg = svg.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  const message = stderr.trim() || plainSvg.trim() || 'PlantUML could not draw this diagram'
  const match = message.match(/(?:\bERROR\s*\r?\n\s*(\d+)|\bline\s+(\d+))/i)
  const line = match ? (match[1] !== undefined ? Number(match[1]) + 1 : Number(match[2])) : undefined
  return { error: message.slice(0, 8000), ...(line && line > 0 ? { line } : {}) }
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
const SVG_ELEMENTS = new Set((
  'svg g defs style rect path line circle ellipse polyline polygon text tspan textPath title desc ' +
  'clipPath mask marker pattern linearGradient radialGradient stop use image a symbol switch ' +
  'filter feGaussianBlur feOffset feBlend feMerge feMergeNode feColorMatrix feFlood feComposite ' +
  'feComponentTransfer feFuncR feFuncG feFuncB feFuncA feMorphology feTurbulence feDisplacementMap ' +
  'feDiffuseLighting feSpecularLighting fePointLight feDistantLight feSpotLight'
).split(' '))
const SVG_ATTRIBUTES = new Set((
  'id class role aria-label aria-labelledby aria-describedby aria-roledescription focusable ' +
  'width height viewBox preserveAspectRatio version x y x1 y1 x2 y2 dx dy cx cy r rx ry d points ' +
  'transform opacity fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin ' +
  'stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity clip-path clip-rule mask filter ' +
  'marker-start marker-mid marker-end font-family font-size font-weight font-style text-anchor ' +
  'dominant-baseline alignment-baseline textLength lengthAdjust letter-spacing word-spacing writing-mode ' +
  'unicode-bidi direction color display visibility overflow vector-effect shape-rendering text-rendering ' +
  'image-rendering paint-order style markerUnits markerWidth markerHeight orient refX refY patternUnits ' +
  'patternContentUnits patternTransform gradientUnits gradientTransform spreadMethod offset stop-color ' +
  'stop-opacity clipPathUnits maskUnits maskContentUnits filterUnits primitiveUnits color-interpolation-filters ' +
  'result in in2 stdDeviation type values tableValues slope intercept amplitude exponent operator k1 k2 k3 k4 ' +
  'surfaceScale diffuseConstant specularConstant specularExponent limitingConeAngle azimuth elevation ' +
  'targetX targetY targetZ pointsAtX pointsAtY pointsAtZ xChannelSelector yChannelSelector scale stitchTiles ' +
  'baseFrequency numOctaves seed kernelUnitLength'
).split(' '))

/** No CSS escapes, comments, at-rules, or resource functions; fragment paint/marker references are safe. */
function safeDiagramCss(css: string): boolean {
  if (/[\\@<>\u0000-\u0008\u000b\u000e-\u001f]|\/\*|\*\/|\b(?:expression|image|image-set|-webkit-image-set|cross-fade|src|paint|element)\s*\(|(?:behavior|-moz-binding)\s*:/i.test(css)) return false
  const withoutFragments = css.replace(/\burl\(\s*(?:"#[\w:.-]+"|'#[\w:.-]+'|#[\w:.-]+)\s*\)/gi, '')
  return !/\burl\s*\(/i.test(withoutFragments)
}

/**
 * Parse untrusted SVG as XML, then build a new SVG using static geometry only.
 * Namespace declarations and unknown elements/attributes never enter the result.
 * Previews additionally use img URLs rather than inserting SVG into the DOM.
 */
export function sanitizeDiagramSvg(source: string): string {
  if (source.length > 8 * 1024 * 1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) return ''
  try {
    const original = new DOMParser({ onError: () => { throw new Error('Invalid diagram XML') } }).parseFromString(source, 'image/svg+xml')
    const root = original.documentElement
    if (!root || root.localName !== 'svg' || (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE)) return ''
    const document = new DOMImplementation().createDocument(SVG_NAMESPACE, 'svg', null)
    const output = document.documentElement!
    const allowUnnamespaced = !root.namespaceURI
    const copy = (input: XmlElement, target: XmlElement, depth: number): void => {
      if (depth > 128) throw new Error('Diagram XML is too deeply nested')
      for (let index = 0; index < input.attributes.length; index++) {
        const attribute = input.attributes.item(index)!
        const name = attribute.localName ?? attribute.name
        const value = attribute.value
        if (/^on/i.test(name)) continue
        if (name === 'href' && (!attribute.namespaceURI || attribute.namespaceURI === XLINK_NAMESPACE)) {
          if (/^#[\w:.-]+$/.test(value) || (input.localName === 'image' && /^data:image\/(?:png|jpeg|gif);base64,[\w+/=\s]+$/i.test(value))) {
            if (attribute.namespaceURI === XLINK_NAMESPACE) target.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', value)
            else target.setAttribute('href', value)
          }
          continue
        }
        if (attribute.namespaceURI === XML_NAMESPACE && name === 'space' && /^(?:default|preserve)$/.test(value)) {
          target.setAttributeNS(XML_NAMESPACE, 'xml:space', value)
          continue
        }
        if (!attribute.namespaceURI && SVG_ATTRIBUTES.has(name) && safeDiagramCss(value)) target.setAttribute(name, value)
      }
      for (let child: XmlNode | null = input.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          if (input.localName !== 'style' || safeDiagramCss(child.nodeValue ?? '')) target.appendChild(document.createTextNode(child.nodeValue ?? ''))
        } else if (child.nodeType === 1) {
          const element = child as XmlElement
          const name = element.localName ?? ''
          if ((!element.namespaceURI && !allowUnnamespaced) || (element.namespaceURI && element.namespaceURI !== SVG_NAMESPACE) || !SVG_ELEMENTS.has(name)) continue
          if (name === 'style' && !safeDiagramCss(element.textContent ?? '')) continue
          const clean = document.createElementNS(SVG_NAMESPACE, name)
          target.appendChild(clean)
          copy(element, clean, depth + 1)
        }
      }
    }
    copy(root, output, 0)
    return new XMLSerializer().serializeToString(output)
  } catch { return '' }
}

