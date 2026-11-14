import { describe, expect, it } from 'vitest'
import { askingLine, notifyAttribution, replySnippet, toastXml } from '../../src/shared/notifyContent'

describe('askingLine', () => {
  it('says what the agent wants to run or edit', () => {
    expect(askingLine({ tool: 'Bash', target: 'npm run build', options: [] })).toBe('Wants to run npm run build')
    expect(askingLine({ tool: 'Edit', target: 'src/app.ts', options: [] })).toBe('Wants to edit src/app.ts')
    expect(askingLine({ tool: 'Write', target: 'notes.md', options: [] })).toBe('Wants to write notes.md')
    expect(askingLine({ tool: 'WebFetch', target: 'https://example.com', options: [] })).toBe('Wants to use WebFetch: https://example.com')
  })
  it('falls back when the prompt names nothing', () => {
    expect(askingLine({ tool: 'Requested action', target: '', options: [] })).toBe('Waiting for your approval')
    expect(askingLine(null)).toBe('Waiting for your approval')
  })
  it('keeps a long command to one readable line', () => {
    const line = askingLine({ tool: 'Bash', target: `npm test ${'x'.repeat(300)}\nsecond line`, options: [] })
    expect(line.length).toBeLessThanOrEqual(140)
    expect(line).not.toContain('\n')
    expect(line.endsWith('…')).toBe(true)
  })
})

describe('replySnippet', () => {
  it('takes the last lines of the reply, without markdown marks', () => {
    expect(replySnippet('Working on it\n\n## Done\n- **Bumped** the version to `1.8.5`.\n')).toBe('Done Bumped the version to 1.8.5.')
  })
  it('is null for an empty reply', () => {
    expect(replySnippet('  \n \n')).toBeNull()
  })
  it('caps the length', () => {
    expect(replySnippet('word '.repeat(100))!.length).toBeLessThanOrEqual(140)
  })
})

describe('notifyAttribution', () => {
  it('names the project and the agent', () => {
    expect(notifyAttribution('dawsha', 'claude')).toBe('dawsha · Claude Code')
    expect(notifyAttribution(undefined, 'shell')).toBe('Shell')
  })
})

describe('toastXml', () => {
  it('lays out title, body and attribution and escapes XML', () => {
    const xml = toastXml({ title: 'Fix <login> & "auth"', body: "It's done", attribution: 'app · Codex', silent: false })
    expect(xml).toContain('<text hint-maxLines="1">Fix &lt;login&gt; &amp; &quot;auth&quot;</text>')
    expect(xml).toContain('<text>It&apos;s done</text>')
    expect(xml).toContain('<text placement="attribution">app · Codex</text>')
    expect(xml).not.toContain('silent="true"')
  })
  it('mutes the sound when asked', () => {
    expect(toastXml({ title: 't', body: 'b', silent: true })).toContain('<audio silent="true"/>')
  })
  it('leaves out an empty attribution', () => {
    expect(toastXml({ title: 't', body: 'b', silent: true })).not.toContain('attribution')
  })
  it('renders escaped protocol actions only for permission notifications', () => {
    const xml = toastXml({ title: 'Permission', body: 'Review', silent: true, actions: [{ content: 'Allow', arguments: 'dawsha-action:allow?pane=p&request=abc' }, { content: 'Deny', arguments: 'dawsha-action:deny?pane=p&request=abc' }] })
    expect(xml).toContain('<actions>')
    expect(xml).toContain('<action content="Allow" arguments="dawsha-action:allow?pane=p&amp;request=abc" activationType="protocol"/>')
    expect(xml).toContain('content="Deny"')
    expect(toastXml({ title: 'Done', body: 'Finished', silent: false })).not.toContain('<actions>')
  })
})
