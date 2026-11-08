const BLOCK_SCALAR = /^[>|][+-]?$/

/**
 * The `description:` value from YAML front matter, as one line. Handles plain values and block
 * scalars (`>`, `|`, `>-`, `|-`), whose text sits on the indented lines that follow.
 */
export function frontMatterDescription(front: string): string | undefined {
  const lines = front.split(/\r?\n/)
  const at = lines.findIndex((line) => /^description:/.test(line))
  if (at < 0) return undefined
  const inline = lines[at].replace(/^description:\s*/, '').trim()
  const raw = BLOCK_SCALAR.test(inline) ? blockText(lines.slice(at + 1)) : inline
  const value = raw.replace(/^["']|["']$/g, '').trim()
  return value === '' ? undefined : value
}

function blockText(rest: readonly string[]): string {
  const end = rest.findIndex((line) => line.trim() !== '' && !/^\s/.test(line))
  const body = end < 0 ? rest : rest.slice(0, end)
  return body.map((line) => line.trim()).filter((line) => line !== '').join(' ')
}
