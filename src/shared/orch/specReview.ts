export interface SpecComment { target: string; text: string }

/** Feedback remains a single Markdown item per comment, even when it has several lines. */
export function formatSpecComments(comments: readonly SpecComment[], note = ''): string | null {
  const items = [...comments, { target: 'spec', text: note }].filter((c) => c.text.trim())
  return items.map((c) => `- [${c.target === 'spec' ? 'spec' : `mockup ${c.target}`}] ${c.text.trim().replace(/\r?\n/g, '\n  ')}`).join('\n') || null
}
