/** Reject constructs that can fetch before Mermaid's output is made inert. */
export function localMermaidError(text: string): string | null {
  if (text.length > 200_000) return 'This diagram is too large to preview. Open its source to edit it.'
  if (/<\s*(?:img|image|iframe|link|style)\b|\burl\s*\(|@import|@\{|^\s*(?:properties|details)\s|(?:\b|["'])(?:img|icon)["']?\s*:|%%\s*\{|^\s*---/im.test(text)) {
    return 'Images, rich node metadata, custom styles and configuration directives are not supported in local diagram previews.'
  }
  return null
}
