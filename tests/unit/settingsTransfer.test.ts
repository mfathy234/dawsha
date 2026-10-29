import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../../src/shared/settingsSchema'
import {
  EXCLUDED_KEYS,
  INCLUDED_KEYS,
  TRANSFER_MAX_BYTES,
  buildEnvelope,
  buildTransferData,
  folderKey,
  importToastText,
  parseTransfer,
  planImport,
  previewLines,
  replaceConfirmLabel,
  replaceWarning,
  transferFileName,
  type TransferData,
  type TransferMode
} from '../../src/shared/settingsTransfer'
import type { Project, SavedLayout, Settings } from '../../src/shared/types'

const project = (id: string, folder: string, name = id): Project => ({ id, name, folder, defaultAgent: 'claude' })
const layout = (id: string, name: string, projectId: string): SavedLayout => ({
  id,
  name,
  createdAt: 1,
  focusedIndex: 0,
  panes: [{ projectId, tabs: [{ agent: 'claude', label: 'claude' }], activeIndex: 0, fontSize: 15 }]
})

function rich(): Settings {
  return {
    ...defaultSettings(),
    projects: [project('a', 'C:\\work\\alpha', 'Alpha'), project('b', 'C:\\work\\beta', 'Beta')],
    layouts: [layout('l1', 'Morning', 'a')],
    sessionsLayout: 'board',
    paletteShortcut: 'Alt+Space',
    recordings: { enabled: true, keepDays: 30, maxMegabytes: 500 },
    remoteAccess: { ...defaultSettings().remoteAccess, allowedEmail: 'me@example.com', terminalInput: true },
    onboardingDismissed: true,
    lastSeenVersion: '0.5.3',
    keptSessions: [{ projectId: 'a', agent: 'claude', sessionId: 'sess-1', title: 'Old', closedAt: 5 }],
    theme: { id: 'nord', image: { enabled: true, path: 'C:\\Users\\me\\bg.png', dim: 50, blur: 2 } }
  }
}

const wrap = (data: unknown, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ app: 'dawsha', kind: 'settings-export', version: 1, exportedAt: '2026-10-15T10:00:00.000Z', appVersion: '1.0.0', data, ...over })

const parsed = (data: unknown): Partial<TransferData> => {
  const result = parseTransfer(wrap(data))
  if (!result.ok) throw new Error(result.error)
  return result.transfer.data
}

const run = (current: Settings, data: Partial<TransferData>, mode: TransferMode, missing: string[] = []) => {
  let n = 0
  return planImport({ current, data, mode, missingFolders: new Set(missing), newId: () => `new-${(n += 1)}` })
}

describe('what is exported', () => {
  it('considers every top-level settings key as included or explicitly excluded', () => {
    const keys = Object.keys(defaultSettings()).sort()
    const covered = [...INCLUDED_KEYS, ...EXCLUDED_KEYS].map(String).sort()
    expect(covered).toEqual(keys)
    expect(INCLUDED_KEYS.filter((key) => (EXCLUDED_KEYS as readonly string[]).includes(key))).toEqual([])
  })

  it('never includes remote access, sessions or machine state', () => {
    const data = buildTransferData(rich())
    const text = JSON.stringify(data)
    for (const key of EXCLUDED_KEYS) expect(Object.keys(data)).not.toContain(key)
    expect(text).not.toContain('me@example.com')
    expect(text).not.toContain('allowedEmail')
    expect(text).not.toContain('terminalInput')
    expect(text).not.toContain('sess-1')
    expect(text).not.toContain('bg.png')
  })

  it('keeps projects, layouts and preferences', () => {
    const data = buildTransferData(rich())
    expect(data.projects).toHaveLength(2)
    expect(data.layouts).toHaveLength(1)
    expect(data.sessionsLayout).toBe('board')
    expect(data.paletteShortcut).toBe('Alt+Space')
    expect(data.recordings).toEqual({ enabled: true, keepDays: 30, maxMegabytes: 500 })
    expect(data.theme).toEqual({ id: 'nord' })
  })

  it('builds a versioned envelope and a dated file name', () => {
    const now = new Date(2026, 9, 5, 12)
    const envelope = buildEnvelope(rich(), '1.0.0', now)
    expect(envelope).toMatchObject({ app: 'dawsha', kind: 'settings-export', version: 1, appVersion: '1.0.0', exportedAt: now.toISOString() })
    expect(transferFileName(now)).toBe('dawsha-settings-2026-10-05.json')
  })
})

describe('parseTransfer', () => {
  it('still reads an older export that carries snippets and drops them', () => {
    const envelope = { ...buildEnvelope(rich(), '1.0.0', new Date()) }
    const old = { ...envelope, data: { ...envelope.data, snippets: [{ id: 's1', name: 'Old', text: 'text', projectId: null, shortcut: 1 }] } }
    const result = parseTransfer(JSON.stringify(old))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transfer.data.projects).toHaveLength(2)
      expect('snippets' in result.transfer.data).toBe(false)
    }
  })

  it('round-trips an exported envelope', () => {
    const envelope = buildEnvelope(rich(), '1.0.0', new Date())
    const result = parseTransfer(JSON.stringify(envelope))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.transfer.data.projects).toHaveLength(2)
      expect(result.transfer.appVersion).toBe('1.0.0')
    }
  })

  it('rejects bad JSON, foreign files, wrong kind and unknown versions with clear messages', () => {
    expect(parseTransfer('{nope')).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') })
    expect(parseTransfer('[]')).toMatchObject({ ok: false, error: expect.stringContaining('not exported by Dawsha') })
    expect(parseTransfer(wrap({}, { app: 'other' }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({}, { kind: 'transcript' }))).toMatchObject({ ok: false, error: expect.stringContaining('not a settings export') })
    expect(parseTransfer(wrap({}, { version: 2 }))).toMatchObject({ ok: false, error: expect.stringContaining('version 2') })
    expect(parseTransfer(wrap(null))).toMatchObject({ ok: false, error: expect.stringContaining('no data') })
  })

  it('rejects oversize input', () => {
    expect(parseTransfer(wrap({}), TRANSFER_MAX_BYTES + 1)).toMatchObject({ ok: false, error: expect.stringContaining('too large') })
  })

  it('rejects wrong field types', () => {
    expect(parseTransfer(wrap({ projects: 'x' }))).toMatchObject({ ok: false, error: expect.stringContaining('"projects" must be a list') })
    expect(parseTransfer(wrap({ projects: [1] }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({ highlights: [] }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({ sidebarCollapsed: 'yes' }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({ sessionsLayout: 'tiles' }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({ sidebarWidth: 'wide' }))).toMatchObject({ ok: false })
    expect(parseTransfer(wrap({ theme: { id: 3 } }))).toMatchObject({ ok: false })
  })

  it('drops unknown keys and never carries remote access even when the file has it', () => {
    const data = parsed({
      remoteAccess: { allowedEmail: 'x@y.z', terminalInput: true },
      fullAccess: { claude: true, codex: true, gemini: true },
      workspace: { panes: [] },
      keptSessions: [],
      whatever: 1,
      sessionsLayout: 'board'
    })
    expect(Object.keys(data)).toEqual(['sessionsLayout'])
  })

  it('only carries keys present in the file and sanitises values', () => {
    const data = parsed({ recordings: { enabled: true, keepDays: 99999, maxMegabytes: 1 }, projects: [{ id: 'a', folder: 'C:\\x', evil: 1 }, { id: 'b' }] })
    expect(data.recordings).toEqual({ enabled: true, keepDays: 365, maxMegabytes: 50 })
    expect(data.projects).toEqual([{ id: 'a', name: 'x', folder: 'C:\\x', defaultAgent: 'claude' }])
    expect(data.paletteShortcut).toBeUndefined()
    const result = parseTransfer(wrap({ projects: [{ id: 'a', folder: 'C:\\x' }, { id: 'b' }] }))
    expect(result.ok && result.transfer.skipped).toBe(1)
  })
})

describe('folderKey', () => {
  it('ignores case and trailing separators for Windows paths only', () => {
    expect(folderKey('C:\\Work\\Alpha\\')).toBe(folderKey('c:/work/alpha'))
    expect(folderKey('/home/Me/App')).not.toBe(folderKey('/home/me/app'))
  })
})

describe('planImport merge', () => {
  const incoming = (): Partial<TransferData> =>
    parsed({
      projects: [project('a', 'c:\\work\\alpha\\', 'Alpha import'), project('z', 'D:\\new\\zed', 'Zed')],
      layouts: [layout('l9', 'morning', 'a'), layout('l8', 'Zed day', 'z')],
      sessionsLayout: 'board',
      theme: { id: 'nord' }
    })

  it('adds new projects by folder, keeps existing ones and detects missing folders', () => {
    const current = { ...defaultSettings(), projects: [project('a', 'C:\\work\\alpha', 'Alpha')], sessionsLayout: 'grid' as const }
    const plan = run(current, incoming(), 'merge', ['D:\\new\\zed'])
    expect(plan.patch.projects?.map((p) => p.name)).toEqual(['Alpha', 'Zed'])
    expect(plan.summary).toMatchObject({ projectsTotal: 2, projectsNew: 1, projectsExisting: 1, projectsMissing: 1 })
    expect(plan.patch.sessionsLayout).toBe('board')
    expect(plan.patch.theme?.id).toBe('nord')
    expect(previewLines(plan.summary)[0]).toBe('2 projects (1 new, 1 already here)')
    expect(previewLines(plan.summary).join('\n')).toContain('1 folder not found')
  })

  it('adds layouts by name, remapping project ids', () => {
    const current = {
      ...defaultSettings(),
      projects: [project('keep', 'C:\\work\\alpha')],
      layouts: [layout('lx', 'Morning', 'keep')]
    }
    const plan = run(current, incoming(), 'merge')
    expect(plan.patch.layouts?.map((l) => l.name)).toEqual(['Morning', 'Zed day'])
    expect(plan.patch.layouts?.[1].panes[0].projectId).toBe(plan.patch.projects?.find((p) => p.name === 'Zed')?.id)
    expect(plan.summary).toMatchObject({ layoutsNew: 1 })
  })

  it('gives imported items a fresh id when theirs is already taken', () => {
    const current = { ...defaultSettings(), projects: [project('z', 'C:\\other')] }
    const plan = run(current, incoming(), 'merge')
    const ids = plan.patch.projects?.map((p) => p.id) ?? []
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('z')
  })

  it('skips layouts whose projects are not in the file', () => {
    const data = { layouts: [layout('l', 'Orphan', 'ghost')] }
    const plan = run(defaultSettings(), data, 'merge')
    expect(plan.patch.layouts).toEqual([])
    expect(plan.summary.skippedLayouts).toBe(1)
  })

  it('leaves lists alone when the file does not mention them', () => {
    const plan = run(rich(), { sessionsLayout: 'grid' }, 'merge')
    expect(Object.keys(plan.patch)).toEqual(['sessionsLayout'])
  })
})

describe('what the preview and the toast say', () => {
  it('ignores retired feature settings in older exports', () => {
    // Compatibility fixture: exports before removal included orchestrator profiles and plans.
    const data = parsed({ orchestrator: { profiles: [{ id: 'lead' }], plans: [{ id: 'default' }] }, experimental: { orchestrator: true }, theme: { id: 'nord' } })
    expect(data).toEqual({ theme: { id: 'nord' } })
    const plan = run(rich(), data, 'merge')
    expect(previewLines(plan.summary)).toEqual(['Preferences: Theme'])
  })

  it('mentions preferences in the toast only when the file had some', () => {
    const projectsOnly = run(rich(), parsed({ projects: [project('n', 'D:\\nova', 'Nova')] }), 'merge')
    expect(importToastText(projectsOnly.summary)).toBe('Imported 1 project.')
    const both = run(rich(), parsed({ projects: [project('n', 'D:\\nova', 'Nova')], sessionsLayout: 'grid' }), 'merge')
    expect(importToastText(both.summary)).toBe('Imported 1 project and preferences.')
    expect(importToastText(run(rich(), parsed({ sessionsLayout: 'grid' }), 'merge').summary)).toBe('Imported preferences.')
  })
})

describe('planImport replace', () => {
  it('replaces the lists, keeps ids of folders that match and names what is removed', () => {
    const current = rich()
    const data = parsed({
      projects: [project('q', 'c:/work/alpha', 'Alpha new'), project('n', 'D:\\n', 'Nova')],
      layouts: []
    })
    const plan = run(current, data, 'replace')
    expect(plan.patch.projects?.map((p) => [p.id, p.name])).toEqual([['a', 'Alpha new'], ['n', 'Nova']])
    expect(plan.patch.layouts).toEqual([])
    expect(plan.summary.removedProjects).toEqual(['Beta'])
    expect(plan.summary.replacedLayouts).toBe(1)
    const warning = replaceWarning(plan.summary, 2)
    expect(warning).toContain('Beta')
    expect(warning).toContain('2 open sessions')
  })

  it('names what Replace removes on its button, in correct English', () => {
    const plan = run(rich(), parsed({ projects: [project('q', 'c:/work/alpha', 'Alpha')], layouts: [] }), 'replace')
    expect(replaceConfirmLabel(plan.summary)).toBe('Replace and remove 1 project, 1 layout')
  })

  it('never touches remote access or full access in the export or the patch', () => {
    expect(INCLUDED_KEYS).not.toContain('fullAccess')
    expect(Object.keys(buildTransferData(defaultSettings()))).not.toContain('fullAccess')
    const plan = run(rich(), parsed({ projects: [], sessionsLayout: 'board' }), 'replace')
    expect(Object.keys(plan.patch)).not.toContain('remoteAccess')
    expect(Object.keys(plan.patch)).not.toContain('fullAccess')
    expect(importToastText(plan.summary)).toContain('Imported')
  })
})
