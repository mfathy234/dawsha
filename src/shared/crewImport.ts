import { CREW_COLOURS, INSTRUCTIONS_MAX, PROMPT_MAX, initialsOf, isColour, type CrewColour, type CrewMember, type CrewPermissions, type PastePattern } from './crew'
import type { AgentKind } from './types'

export interface Frontmatter {
  data: Record<string, string>
  body: string
}

const unquote = (value: string): string => value.trim().replace(/^(["'])(.*)\1$/s, '$2')

export function parseFrontmatter(source: string): Frontmatter {
  const text = source.replace(/^﻿/, '').replace(/\r\n/g, '\n')
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (!match) return { data: {}, body: text.trim() }
  const data: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(lines[i])
    if (!head) continue
    const [, key, rest] = head
    const block = /^[|>][+-]?$/.test(rest.trim())
    const parts: string[] = block ? [] : [rest]
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]) || (block && lines[i + 1].trim() === ''))) {
      i += 1
      parts.push(lines[i].trim())
    }
    data[key.toLowerCase()] = unquote(parts.join(block && rest.trim().startsWith('|') ? '\n' : ' ').trim())
  }
  return { data, body: text.slice(match[0].length).trim() }
}

export interface ParsedSource {
  name: string
  description: string
  model: string
  colour: CrewColour | null
  tools: string[]
  body: string
}

export function parseSourceFile(fileName: string, source: string): ParsedSource {
  const { data, body } = parseFrontmatter(source)
  const stem = fileName.replace(/\.[^.]+$/, '')
  const tools = (data.tools ?? '').split(/[,\s]+/).map((tool) => tool.trim()).filter(Boolean)
  return {
    name: data.name?.trim() || stem,
    description: (data.description ?? '').replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim(),
    model: (data.model ?? '').trim().toLowerCase(),
    colour: isColour(data.color?.toLowerCase()) ? (data.color.toLowerCase() as CrewColour) : null,
    tools,
    body
  }
}

const NAME_POOL = ['Rami', 'Zaid', 'Layla', 'Karim', 'Dina', 'Faris', 'Mona', 'Hadi', 'Salma', 'Nabil', 'Rana', 'Tamer', 'Jana', 'Ziad', 'Reem', 'Adam', 'Lubna', 'Samer', 'Noor', 'Basel']

function hashOf(text: string): number {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return hash
}

export function suggestName(seed: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()))
  const start = hashOf(seed) % NAME_POOL.length
  for (let step = 0; step < NAME_POOL.length; step += 1) {
    const name = NAME_POOL[(start + step) % NAME_POOL.length]
    if (!used.has(name.toLowerCase())) return name
  }
  for (let n = 2; ; n += 1) if (!used.has(`${NAME_POOL[start]} ${n}`.toLowerCase())) return `${NAME_POOL[start]} ${n}`
}

export function suggestColour(seed: string, preferred: CrewColour | null, taken: readonly CrewColour[] = []): CrewColour {
  if (preferred) return preferred
  const free = CREW_COLOURS.filter((colour) => !taken.includes(colour))
  const pool = free.length > 0 ? free : CREW_COLOURS
  return pool[hashOf(seed) % pool.length]
}

export function roleFromDescription(description: string, fallback: string): string {
  const first = description.split(/(?<=[.!?])\s|\s[-–—]\s|;/)[0]?.trim().replace(/[.!?]+$/, '') ?? ''
  if (first === '') return fallback
  const words = first.split(/\s+/)
  let role = words.slice(0, 6).join(' ')
  if (role.length > 48) role = role.slice(0, 47).trimEnd() + '…'
  return role[0].toUpperCase() + role.slice(1)
}

const humanize = (name: string): string => name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

export function claudeModelOf(value: string): string {
  const lower = value.toLowerCase()
  for (const model of ['fable', 'opus', 'sonnet', 'haiku']) if (lower.includes(model)) return model
  return 'sonnet'
}

const ENV_WORDS = /\b(dev|stage|staging|uat|preprod|prod)\b/gi

export interface FieldHint {
  field: string
  why: string
}

export interface Inference {
  fields: FieldHint[]
  paste: PastePattern[]
  permissions: CrewPermissions | null
  permissionsWhy: string
  projects: string[]
  projectsWhy: string
}

export function inferFromText(text: string, projectNames: readonly string[] = []): Inference {
  const fields: FieldHint[] = []
  const paste: PastePattern[] = []
  const envWords = new Set((text.match(ENV_WORDS) ?? []).map((word) => word.toLowerCase().replace('staging', 'stage')))
  const hasEnv = envWords.size >= 2 || (envWords.size >= 1 && /\benvironments?\b/i.test(text))
  const wantsId = /correlation[ -]?id|trace[ -]?id|request[ -]?id|\bguid\b/i.test(text)
  const wantsPr = /\bPRs?\b|pull[ -]request/.test(text)
  const wantsBuild = /build (url|link|id|number)|pipeline run/i.test(text)
  const wantsUrl = !wantsPr && !wantsBuild && /\b(url|link)\b|https?:\/\//i.test(text)
  if (wantsId) {
    fields.push({ field: 'id', why: 'Found in the text: a correlation or trace id' })
    paste.push({ kind: 'guid', field: 'id', ...(hasEnv ? { envField: 'env' } : {}) })
  }
  if (hasEnv) fields.push({ field: 'env', why: 'Found in the text: one of dev, stage, uat or preprod' })
  if (wantsPr) {
    fields.push({ field: 'pr', why: 'Found in the text: a pull request' })
    paste.push({ kind: 'pr', field: 'pr' })
  }
  if (wantsBuild) {
    fields.push({ field: 'build', why: 'Found in the text: a build link' })
    paste.push({ kind: 'build', field: 'build' })
  }
  if (wantsUrl) {
    fields.push({ field: 'url', why: 'Found in the text: a URL' })
    paste.push({ kind: 'url', field: 'url' })
  }
  const readOnly = /read[- ]only/i.test(text)
  const projects = projectNames.filter((name) => name.length >= 3 && new RegExp(`(^|[^\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(text))
  return {
    fields,
    paste,
    permissions: readOnly ? 'read' : null,
    permissionsWhy: readOnly ? 'The text says read-only' : 'Nothing about read-only, so it asks before changes',
    projects,
    projectsWhy: projects.length > 0 ? `The text mentions ${projects.join(', ')}` : 'No project mentioned, so it can run in any'
  }
}

const FIELD_PHRASE: Record<string, (name: string) => string> = {
  id: () => 'Correlation id {{id}}',
  env: () => 'on {{env}}',
  pr: () => 'PR {{pr}}',
  build: () => 'Build {{build}}',
  url: () => '{{url}}'
}

export interface SkillInput {
  name: string
  description: string
  body: string
  path: string
  agent: AgentKind | 'shared'
}

export interface MemberDraft {
  member: CrewMember
  why: {
    who: string
    fields: string
    prompt: string
    instructions: string
    permissions: string
    projects: string
    paste: string
    startup: string
  }
}

export function draftFromSkill(input: SkillInput, taken: { names: readonly string[]; colours: readonly CrewColour[] }, projectNames: readonly string[]): MemberDraft {
  const text = `${input.description}\n${input.body.slice(0, 2500)}`
  const found = inferFromText(text, projectNames)
  const name = suggestName(input.name, taken.names)
  const phrases = found.fields.map((hint) => FIELD_PHRASE[hint.field]?.(input.name)).filter((phrase): phrase is string => Boolean(phrase))
  const prompt = [`Use the ${input.name} skill.`, ...phrases.length > 0 ? [phrases.join(' ') + '.'] : []].join(' ')
  const permissions = found.permissions ?? 'ask'
  const member: CrewMember = {
    id: '',
    name,
    role: roleFromDescription(input.description, humanize(input.name)),
    initials: initialsOf(name),
    colour: suggestColour(input.name, null, taken.colours),
    builtin: false,
    hidden: false,
    lead: false,
    source: { kind: 'skill', path: input.path, linked: true },
    description: input.description.slice(0, 400),
    instructions: `Use the ${input.name} skill and follow it exactly. It is at ${input.path}; read it first if your CLI cannot load skills.`.slice(0, INSTRUCTIONS_MAX),
    prompt: prompt.slice(0, PROMPT_MAX),
    runner: 'claude',
    model: 'sonnet',
    effort: '',
    permissions,
    startup: 'lean',
    projects: found.projects,
    paste: found.paste
  }
  return {
    member,
    why: {
      who: 'Role from the skill’s description',
      fields: found.fields.length > 0 ? found.fields.map((hint) => hint.why).join('. ') : 'No obvious fields, so a run asks for a task',
      prompt: 'Built from the skill name and the fields',
      instructions: 'On Codex and Gemini, the member reads the skill file itself',
      permissions: found.permissionsWhy,
      projects: found.projectsWhy,
      paste: found.paste.length > 0 ? 'Pasting a match offers this member first' : 'Nothing to recognise, so paste to run skips it',
      startup: 'Lean by default. Switch to Usual if the skill needs MCP tools'
    }
  }
}

export function draftFromAgentFile(file: ParsedSource, path: string, taken: { names: readonly string[]; colours: readonly CrewColour[] }, projectNames: readonly string[]): MemberDraft {
  const found = inferFromText(`${file.description}\n${file.body.slice(0, 2500)}`, projectNames)
  const name = suggestName(file.name, taken.names)
  const edits = file.tools.length > 0 && !file.tools.some((tool) => /^(Edit|Write|MultiEdit|NotebookEdit|Bash)$/i.test(tool))
  const permissions: CrewPermissions = found.permissions ?? (edits ? 'read' : 'ask')
  const phrases = found.fields.map((hint) => FIELD_PHRASE[hint.field]?.(file.name)).filter((phrase): phrase is string => Boolean(phrase))
  const member: CrewMember = {
    id: '',
    name,
    role: roleFromDescription(file.description, humanize(file.name)),
    initials: initialsOf(name),
    colour: suggestColour(file.name, file.colour, taken.colours),
    builtin: false,
    hidden: false,
    lead: false,
    source: { kind: 'agent', path, linked: true },
    description: file.description.slice(0, 400),
    instructions: file.body.slice(0, INSTRUCTIONS_MAX),
    prompt: phrases.length > 0 ? `${phrases.join(' ')}.`.slice(0, PROMPT_MAX) : '',
    runner: 'claude',
    model: claudeModelOf(file.model),
    effort: '',
    permissions,
    startup: 'lean',
    projects: found.projects,
    paste: found.paste
  }
  return {
    member,
    why: {
      who: file.colour ? 'Colour from the agent file’s color field' : 'Role from the agent’s description',
      fields: found.fields.length > 0 ? found.fields.map((hint) => hint.why).join('. ') : 'No obvious fields, so a run asks for a task',
      prompt: 'Built from the fields found in the text',
      instructions: 'The agent file’s own instructions, re-read each time it runs',
      permissions: file.tools.length > 0 && edits ? 'The agent has no editing tools' : found.permissionsWhy,
      projects: found.projectsWhy,
      paste: found.paste.length > 0 ? 'Pasting a match offers this member first' : 'Nothing to recognise, so paste to run skips it',
      startup: 'Lean by default'
    }
  }
}

export function promptTemplate(body: string): string {
  return body
    .replace(/\$ARGUMENTS\b/g, '{{task}}')
    .replace(/\$(\d)\b/g, (_all, digit: string) => `{{arg${digit}}}`)
    .slice(0, PROMPT_MAX)
}

export function draftFromPrompt(file: ParsedSource, path: string, taken: { names: readonly string[]; colours: readonly CrewColour[] }): MemberDraft {
  const name = suggestName(file.name, taken.names)
  const member: CrewMember = {
    id: '',
    name,
    role: roleFromDescription(file.description, humanize(file.name)),
    initials: initialsOf(name),
    colour: suggestColour(file.name, file.colour, taken.colours),
    builtin: false,
    hidden: false,
    lead: false,
    source: { kind: 'prompt', path, linked: true },
    description: file.description.slice(0, 400),
    instructions: '',
    prompt: promptTemplate(file.body),
    runner: 'codex',
    model: '',
    effort: '',
    permissions: 'ask',
    startup: 'lean',
    projects: [],
    paste: []
  }
  return {
    member,
    why: {
      who: 'Role from the prompt’s description',
      fields: 'Arguments in the prompt become fields',
      prompt: 'The Codex prompt file itself, re-read each time it runs',
      instructions: 'A Codex prompt is the message, so there are no separate instructions',
      permissions: 'Codex runs with full access on this PC',
      projects: 'No project mentioned, so it can run in any',
      paste: 'Nothing to recognise, so paste to run skips it',
      startup: 'Lean by default'
    }
  }
}

export interface LinkedSource {
  description: string
  body: string
}

/** A linked member follows its file: the description always, and the instructions or prompt where the file is the job. */
export function mergeLinked(member: CrewMember, source: LinkedSource): CrewMember {
  if (!member.source.linked) return member
  const description = source.description === '' ? member.description : source.description.slice(0, 400)
  if (member.source.kind === 'agent') return { ...member, description, instructions: source.body === '' ? member.instructions : source.body.slice(0, INSTRUCTIONS_MAX) }
  if (member.source.kind === 'prompt') return { ...member, description, prompt: source.body === '' ? member.prompt : promptTemplate(source.body) }
  return { ...member, description }
}
