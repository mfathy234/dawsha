import { describe, expect, it } from 'vitest'
import {
  claudeModelOf,
  draftFromAgentFile,
  draftFromPrompt,
  draftFromSkill,
  inferFromText,
  mergeLinked,
  parseFrontmatter,
  parseSourceFile,
  promptTemplate,
  roleFromDescription,
  suggestName
} from '../../src/shared/crewImport'

const TAKEN = { names: ['Maya', 'Sami'], colours: [] as never[] }

const CORRELATION = {
  name: 'correlation-id',
  description:
    'Investigates why a Microtec ERP request failed from its correlation id (trace id) by pulling every log line and span from OpenObserve. Use when the user pastes a correlation id and names an environment (dev, stage, uat, preprod).',
  body: '# Correlation id investigation\nRead-only. Never print credentials.\n1. Resolve the branch',
  path: 'C:\\Users\\me\\.claude\\skills\\correlation-id',
  agent: 'claude' as const
}

describe('frontmatter', () => {
  it('reads plain, quoted and folded values', () => {
    const { data, body } = parseFrontmatter(
      ['---', 'name: pr-review', 'description: "Reviews PRs: for Microtec"', 'model: opus', 'color: orange', 'notes: >', '  folded one', '  folded two', '---', '', 'Body text', 'more'].join('\n')
    )
    expect(data).toMatchObject({ name: 'pr-review', description: 'Reviews PRs: for Microtec', model: 'opus', color: 'orange', notes: 'folded one folded two' })
    expect(body).toBe('Body text\nmore')
  })

  it('handles CRLF, a BOM and files without frontmatter', () => {
    expect(parseFrontmatter('\uFEFF---\r\nname: a\r\n---\r\nhello').data.name).toBe('a')
    expect(parseFrontmatter('just text')).toEqual({ data: {}, body: 'just text' })
    expect(parseFrontmatter('---\nname: unterminated').body).toContain('unterminated')
  })

  it('parses an agent file with Claude Code fields', () => {
    const file = parseSourceFile('pr-review.md', '---\nname: pr-review\ndescription: Review an Azure DevOps pull request\nmodel: claude-opus-4\ncolor: Orange\ntools: Read, Grep, Glob\n---\nBe careful.')
    expect(file).toMatchObject({ name: 'pr-review', model: 'claude-opus-4', colour: 'orange', tools: ['Read', 'Grep', 'Glob'], body: 'Be careful.' })
    expect(parseSourceFile('x.md', 'no frontmatter').name).toBe('x')
    expect(parseSourceFile('x.md', '---\ncolor: mauve\n---\n').colour).toBeNull()
  })
})

describe('identities', () => {
  it('suggests free names and is stable', () => {
    expect(suggestName('pr-review', ['Rami'])).not.toBe('Rami')
    expect(suggestName('pr-review', [])).toBe(suggestName('pr-review', []))
    expect(suggestName('anything', ['Maya'])).not.toBe('Maya')
  })

  it('writes a short role from a description', () => {
    expect(roleFromDescription('Review an Azure DevOps pull request against the standards. More text.', 'x')).toBe('Review an Azure DevOps pull request')
    expect(roleFromDescription('', 'Fallback')).toBe('Fallback')
    expect(claudeModelOf('claude-opus-4-1')).toBe('opus')
    expect(claudeModelOf('inherit')).toBe('sonnet')
  })
})

describe('skill to member inference', () => {
  it('finds an id and an environment, read-only, a project and the paste patterns', () => {
    const { member, why } = draftFromSkill(CORRELATION, TAKEN, ['Platforms', 'InfrastructureServices', 'dawsha'])
    expect(member.prompt).toContain('{{id}}')
    expect(member.prompt).toContain('{{env}}')
    expect(member.permissions).toBe('read')
    expect(member.paste).toEqual([{ kind: 'guid', field: 'id', envField: 'env' }])
    expect(member.source).toEqual({ kind: 'skill', path: CORRELATION.path, linked: true })
    expect(member.instructions).toContain(CORRELATION.path)
    expect(member.instructions).toContain('read it first if your CLI cannot load skills')
    expect(member.startup).toBe('lean')
    expect(member.role.length).toBeGreaterThan(5)
    expect(why.permissions).toMatch(/read-only/)
    expect(why.fields).toMatch(/correlation/)
    expect(TAKEN.names).not.toContain(member.name)
  })

  it('finds projects mentioned in the text', () => {
    const found = inferFromText('Works on Platforms and the dawsha repo.', ['Platforms', 'dawsha', 'Other'])
    expect(found.projects).toEqual(['Platforms', 'dawsha'])
    expect(inferFromText('nothing here', ['Platforms']).projects).toEqual([])
  })

  it('finds a PR and a URL, but not words inside other words', () => {
    expect(inferFromText('Reviews a pull request by number', []).fields.map((f) => f.field)).toEqual(['pr'])
    expect(inferFromText('Reviews PR 12', []).paste).toEqual([{ kind: 'pr', field: 'pr' }])
    expect(inferFromText('Summarises a web page from its URL', []).fields.map((f) => f.field)).toEqual(['url'])
    expect(inferFromText('Gets the build url of a run', []).paste).toEqual([{ kind: 'build', field: 'build' }])
    expect(inferFromText('Helps a developer with the production deployment procedure', []).fields).toEqual([])
    expect(inferFromText('Runs on dev or stage', []).fields.map((f) => f.field)).toEqual(['env'])
  })

  it('asks for a task when nothing obvious is found and asks before changes by default', () => {
    const { member, why } = draftFromSkill({ ...CORRELATION, name: 'taste', description: 'Anti-slop design rules for landing pages.', body: '' }, TAKEN, [])
    expect(member.permissions).toBe('ask')
    expect(member.paste).toEqual([])
    expect(member.prompt).toBe('Use the taste skill.')
    expect(why.fields).toMatch(/task/)
  })

  it('reads an agent file: colour, model, tools and instructions', () => {
    const file = parseSourceFile('rami.md', '---\nname: pr-review\ndescription: Reviews a pull request in Platforms.\nmodel: opus\ncolor: orange\ntools: Read, Grep\n---\nNever edit.')
    const { member } = draftFromAgentFile(file, 'C:/a/pr-review.md', TAKEN, ['Platforms'])
    expect(member).toMatchObject({ colour: 'orange', model: 'opus', permissions: 'read', instructions: 'Never edit.', projects: ['Platforms'] })
    expect(member.source).toEqual({ kind: 'agent', path: 'C:/a/pr-review.md', linked: true })
    expect(member.prompt).toBe('PR {{pr}}.')
    const editing = draftFromAgentFile(parseSourceFile('b.md', '---\ntools: Read, Edit, Bash\n---\nx'), 'C:/a/b.md', TAKEN, [])
    expect(editing.member.permissions).toBe('ask')
  })

  it('reads a Codex prompt with arguments', () => {
    const file = parseSourceFile('plan.md', '---\ndescription: Plan a change\n---\nPlan $ARGUMENTS and also $1.')
    const { member } = draftFromPrompt(file, 'C:/c/plan.md', TAKEN)
    expect(member.runner).toBe('codex')
    expect(member.prompt).toBe('Plan {{task}} and also {{arg1}}.')
    expect(promptTemplate('$ARGUMENTS')).toBe('{{task}}')
  })
})

describe('linked members', () => {
  const linked = draftFromAgentFile(parseSourceFile('a.md', '---\ndescription: old\n---\nold body'), 'C:/a.md', TAKEN, []).member
  it('follow their file', () => {
    expect(mergeLinked(linked, { description: 'new', body: 'new body' })).toMatchObject({ description: 'new', instructions: 'new body' })
    expect(mergeLinked(linked, { description: '', body: '' })).toMatchObject({ description: 'old', instructions: 'old body' })
  })
  it('keep their own name and settings, and unlinked members do not move', () => {
    expect(mergeLinked(linked, { description: 'x', body: 'y' }).name).toBe(linked.name)
    const frozen = { ...linked, source: { ...linked.source, linked: false } }
    expect(mergeLinked(frozen, { description: 'x', body: 'y' })).toBe(frozen)
  })
  it('only update the description of a skill member', () => {
    const skill = draftFromSkill(CORRELATION, TAKEN, []).member
    const merged = mergeLinked(skill, { description: 'changed', body: 'ignored' })
    expect(merged.description).toBe('changed')
    expect(merged.instructions).toBe(skill.instructions)
  })
})
