import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { SettingsStore } from '../../src/main/settingsStore'

const tempFile = (): string => join(mkdtempSync(join(tmpdir(), 'cg-settings-')), 'settings.json')

describe('migrateSettings', () => {
  it('loads older settings while discarding the retired dictation field', () => {
    for (const dictation of [{ language: 'ar', model: 'turbo', microphone: 'old-device' }, 'invalid', null]) {
      const file = tempFile()
      writeFileSync(file, JSON.stringify({ ...defaultSettings(), paletteShortcut: 'Alt+Space', dictation }))
      const loaded = new SettingsStore(file).load()
      expect(loaded.warning).toBeNull()
      expect(loaded.settings.paletteShortcut).toBe('Alt+Space')
      expect(loaded.settings).not.toHaveProperty('dictation')
      expect(defaultSettings()).not.toHaveProperty('dictation')
    }
  })

  it('persists the Files layout through a settings reload and repairs a bad one', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    const layout = { sections: { changes: false, open: true, tree: true }, inspector: { open: false, tab: 'activity' as const }, explorer: { open: false }, panel: { minimised: false, height: 260 } }
    store.update({ filesLayout: layout })
    expect(new SettingsStore(file).load().settings.filesLayout).toEqual(layout)
    expect(migrateSettings({ filesLayout: 'nope' }).filesLayout.panel.minimised).toBe(true)
  })
  it('persists bounded, boolean agent fold choices through a settings reload', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ agentFolds: { 'claude:busy': false, 'codex:done': true } })
    expect(new SettingsStore(file).load().settings.agentFolds).toEqual({ 'claude:busy': false, 'codex:done': true })
    expect(migrateSettings({ agentFolds: { good: false, bad: 'yes' } }).agentFolds).toEqual({ good: false })
    const many = Object.fromEntries(Array.from({ length: 420 }, (_, i) => [`s${i}`, false]))
    expect(Object.keys(migrateSettings({ agentFolds: many }).agentFolds)).toHaveLength(400)
    expect(migrateSettings({ agentFolds: [] }).agentFolds).toEqual({})
  })
  it('loads old settings while dropping retired feature settings and profiles', () => {
    // Compatibility fixture: old files stored orchestrator settings and an experimental flag.
    const old = { experimental: { orchestrator: true }, orchestrator: { profiles: [{ id: 'lead' }], plans: [{ id: 'default' }] }, orch: { enabled: true } }
    expect(migrateSettings(old)).toEqual(defaultSettings())
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ ...defaultSettings(), ...old, theme: { id: 'nord' } }))
    const loaded = new SettingsStore(file).load()
    expect(loaded.settings.theme.id).toBe('nord')
    expect(Object.keys(loaded.settings)).not.toContain('experimental')
    expect(Object.keys(loaded.settings)).toEqual(Object.keys(defaultSettings()))
  })
  it('shows the recap by default and only turns it off when told to', () => {
    expect(defaultSettings().showRecap).toBe(true)
    expect(migrateSettings({}).showRecap).toBe(true)
    expect(migrateSettings({ showRecap: 'no' }).showRecap).toBe(true)
    expect(migrateSettings({ showRecap: false }).showRecap).toBe(false)
    expect(defaultSettings().colorSessionsByTag).toBe(true)
    expect(migrateSettings({ colorSessionsByTag: 'no' }).colorSessionsByTag).toBe(true)
    expect(migrateSettings({ colorSessionsByTag: false }).colorSessionsByTag).toBe(false)
  })
  it('leaves dimming off by default, only turns it on when told to and ignores the old key', () => {
    expect(defaultSettings().dimOtherPanes).toBe(false)
    expect(migrateSettings({}).dimOtherPanes).toBe(false)
    expect(migrateSettings({ dimIdlePanes: true }).dimOtherPanes).toBe(false)
    expect(migrateSettings({ dimOtherPanes: 'yes' }).dimOtherPanes).toBe(false)
    expect(migrateSettings({ dimOtherPanes: true }).dimOtherPanes).toBe(true)
  })
  it('keeps closed sessions and task history only for known projects', () => {
    const projects = [{ id: 'api', name: 'API', folder: 'C:\\work\\api', defaultAgent: 'codex' }]
    const keptSessions = [{ projectId: 'api', agent: 'codex', sessionId: 'session-1', title: 'Fix export', closedAt: 100 }, { projectId: 'missing', agent: 'claude', sessionId: 'x', title: 'Orphan', closedAt: 100 }]
    const tasks = [{ id: 'task-1', projectId: 'api', title: 'Export cleanup', note: 'Keep output stable', createdAt: 100, sessionKeys: ['codex:session-1'], events: [{ id: 'event-1', kind: 'commit', text: 'abc123', at: 120 }] }]
    const migrated = migrateSettings({ projects, keptSessions, tasks })
    expect(migrated.keptSessions).toHaveLength(1)
    expect(migrateSettings({ projects, keptSessions: [{ ...keptSessions[0], branch: 'fix/'+'x'.repeat(500) }, { ...keptSessions[0], sessionId: 's2', branch: 7 }] }).keptSessions.map((k) => k.branch?.length)).toEqual([200, undefined])
    expect(migrated.tasks).toEqual(tasks)
    expect(migrateSettings(JSON.parse(JSON.stringify(migrated))).tasks).toEqual(tasks)
  })
  it('keeps sidebar folds only for known projects, once each', () => {
    const projects = [{ id: 'api', name: 'API', folder: 'C:\\work\\api' }, { id: 'web', name: 'Web', folder: 'C:\\work\\web' }]
    expect(defaultSettings().foldedProjects).toEqual([])
    expect(defaultSettings().foldedClosedSessions).toEqual([])
    const migrated = migrateSettings({ projects, foldedProjects: ['web', 'gone', 'web', 3, null], foldedClosedSessions: ['api', {}] })
    expect(migrated.foldedProjects).toEqual(['web'])
    expect(migrated.foldedClosedSessions).toEqual(['api'])
    expect(migrateSettings({ projects, foldedProjects: 'api', foldedClosedSessions: { api: true } }).foldedProjects).toEqual([])
    expect(migrateSettings({ foldedProjects: ['api'] }).foldedProjects).toEqual([])
    expect(migrateSettings(JSON.parse(JSON.stringify(migrated))).foldedProjects).toEqual(['web'])
  })
  it('keeps open Files tabs for known projects, de-duplicated and capped at 12', () => {
    const projects = [{ id: 'api', name: 'API', folder: 'C:\\work\\api' }]
    const many = Array.from({ length: 20 }, (_, index) => `src/f${index}.ts`)
    expect(defaultSettings().filesTabs).toEqual({})
    const migrated = migrateSettings({ projects, filesTabs: { api: ['a.ts', 'a.ts', 5, '', 'b.ts'], gone: ['x.ts'], web: 'no' } })
    expect(migrated.filesTabs).toEqual({ 'api|c:/work/api': ['a.ts', 'b.ts'] })
    expect(migrateSettings({ projects, filesTabs: { api: many } }).filesTabs['api|c:/work/api']).toHaveLength(12)
    expect(migrateSettings({ projects, filesTabs: 'x' }).filesTabs).toEqual({})
  })
  it('keeps the onboarding dismissal only when it is exactly true', () => {
    expect(migrateSettings({}).onboardingDismissed).toBe(false)
    expect(migrateSettings({ onboardingDismissed: 'yes' }).onboardingDismissed).toBe(false)
    expect(migrateSettings({ onboardingDismissed: true }).onboardingDismissed).toBe(true)
  })

  it('clamps the persisted project panel width and supplies a default', () => {
    expect(migrateSettings({}).sidebarWidth).toBe(248)
    expect(migrateSettings({ sidebarWidth: 150 }).sidebarWidth).toBe(208)
    expect(migrateSettings({ sidebarWidth: 999 }).sidebarWidth).toBe(420)
    expect(migrateSettings({ sidebarWidth: 'wide' }).sidebarWidth).toBe(248)
  })

  it('keeps a valid palette shortcut in a normal form and falls back to Ctrl+K otherwise', () => {
    expect(migrateSettings({}).paletteShortcut).toBe('Ctrl+K')
    expect(migrateSettings({}).fullAccess).toEqual({ claude: true, codex: true, gemini: false })
    expect(migrateSettings({ fullAccess: { codex: false, gemini: true, claude: 'yes' } }).fullAccess).toEqual({
      claude: true,
      codex: false,
      gemini: true
    })
    expect(migrateSettings({ fullAccess: [] }).fullAccess).toEqual({ claude: true, codex: true, gemini: false })
    const primaryModifier = navigator.platform.toLowerCase().includes('mac') ? 'Cmd' : 'Ctrl'
    expect(migrateSettings({ paletteShortcut: 'ctrl+alt+p' }).paletteShortcut).toBe(`${primaryModifier}+Alt+P`)
    expect(migrateSettings({ paletteShortcut: 'P' }).paletteShortcut).toBe('Ctrl+K')
    expect(migrateSettings({ paletteShortcut: 42 }).paletteShortcut).toBe('Ctrl+K')
  })

  it('defaults private remote permissions off and sanitizes them independently', () => {
    const none = { commands: false, answers: false, messages: false, sessions: false, fullOutput: false }
    const off = { allowedEmail: '', capabilities: none, autoReconnect: true, notifyLinkChange: true, approvalsNotify: true, approvalsOnlyWhenAway: false, approvalsAwayMinutes: 3, approvalsAllowConfigEdits: false }
    expect(defaultSettings().remoteAccess).toEqual(off)
    expect(migrateSettings({ remoteAccess: { capabilities: { messages: true, sessions: 'yes', fullOutput: true } } }).remoteAccess).toEqual({ ...off, capabilities: { ...none, messages: true, fullOutput: true } })
    expect(migrateSettings({ remoteAccess: { approvalsAwayMinutes: 500, approvalsNotify: 'no', autoReconnect: false } }).remoteAccess).toMatchObject({ approvalsAwayMinutes: 60, approvalsNotify: true, autoReconnect: false, notifyLinkChange: true })
  })

  it('moves the old phone permissions into capabilities and never turns on full output', () => {
    const migrated = migrateSettings({ remoteAccess: { terminalInput: true, sessionControl: false, approvals: true } }).remoteAccess
    expect(migrated.capabilities).toEqual({ commands: true, answers: true, messages: true, sessions: false, fullOutput: false })
    expect(migrated).not.toHaveProperty('approvals')
  })

  it('returns defaults for junk input', () => {
    expect(migrateSettings(null)).toEqual(defaultSettings())
    expect(migrateSettings('x')).toEqual(defaultSettings())
    expect(migrateSettings([])).toEqual(defaultSettings())
  })

  it('migrates a v1 file without ids, theme or workspace', () => {
    const result = migrateSettings({
      version: 1,
      projects: [{ name: 'acme-web', path: 'C:\\Work\\acme-web' }, { folder: 'C:\\Work\\Hr\\' }]
    })
    expect(result.version).toBe(2)
    expect(result.projects).toHaveLength(2)
    expect(result.projects[0]).toMatchObject({ name: 'acme-web', folder: 'C:\\Work\\acme-web' })
    expect(result.projects[0].id).toBeTruthy()
    expect(result.projects[1].name).toBe('Hr')
    expect(result.projects[0].id).not.toBe(result.projects[1].id)
    expect(result.theme.id).toBe('grid-dark')
    expect(result.theme.image.enabled).toBe(false)
  })

  it('drops projects without a folder and clamps values', () => {
    const result = migrateSettings({
      projects: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', folder: 'C:\\b', fontSize: 99 }],
      theme: { id: 'nord', image: { enabled: true, path: 'C:\\img.png', dim: 400, blur: -3 } }
    })
    expect(result.projects).toEqual([{ id: 'b', name: 'B', folder: 'C:\\b', defaultAgent: 'claude', fontSize: 28 }])
    expect(result.theme.image).toEqual({ enabled: true, path: 'C:\\img.png', dim: 90, blur: 0 })
  })

  it('disables the image when no path is stored', () => {
    const result = migrateSettings({ theme: { id: 'nord', image: { enabled: true, path: null } } })
    expect(result.theme.image.enabled).toBe(false)
  })

  it('keeps only workspace panes whose project still exists', () => {
    const result = migrateSettings({
      projects: [{ id: 'p', name: 'P', folder: 'C:\\p' }],
      workspace: {
        focusedIndex: 5,
        panes: [
          { projectId: 'p', tabs: [{ kind: 'claude', label: 'claude' }, { kind: 'shell', label: 'shell' }], activeIndex: 1, fontSize: 18 },
          { projectId: 'gone', tabs: [{ kind: 'claude', label: 'claude' }], activeIndex: 0, fontSize: 15 },
          { projectId: 'p', tabs: [], activeIndex: 0, fontSize: 15 }
        ]
      }
    })
    expect(result.workspace.panes).toHaveLength(1)
    expect(result.workspace.panes[0].activeIndex).toBe(1)
    expect(result.workspace.focusedIndex).toBe(0)
  })

  it('keeps a valid session starting point on a tab and drops a broken one', () => {
    const baseline = { ref: 'a1b2c3d4e5f6', at: 1_760_000_000_000, untracked: ['notes.txt', 7] }
    const result = migrateSettings({
      projects: [{ id: 'p', name: 'P', folder: 'C:\\p' }],
      workspace: {
        focusedIndex: 0,
        panes: [
          {
            projectId: 'p',
            tabs: [
              { agent: 'claude', label: 'claude', baseline },
              { agent: 'claude', label: 'claude', baseline: { ref: '--evil', at: 'soon' } }
            ],
            activeIndex: 0,
            fontSize: 15
          }
        ]
      }
    })
    const [kept, dropped] = result.workspace.panes[0].tabs
    expect(kept.baseline).toEqual({ ref: 'a1b2c3d4e5f6', at: 1_760_000_000_000, untracked: ['notes.txt'] })
    expect(dropped.baseline).toBeUndefined()
  })
})

describe('agent settings migration', () => {
  it('defaults a missing or invalid defaultAgent to claude and keeps codex and gemini', () => {
    const result = migrateSettings({
      projects: [
        { id: 'a', name: 'A', folder: 'C:\\a' },
        { id: 'b', name: 'B', folder: 'C:\\b', defaultAgent: 'codex' },
        { id: 'c', name: 'C', folder: 'C:\\c', defaultAgent: 'gemini' },
        { id: 'd', name: 'D', folder: 'C:\\d', defaultAgent: 'bard' }
      ]
    })
    expect(result.projects.map((p) => p.defaultAgent)).toEqual(['claude', 'codex', 'gemini', 'claude'])
  })

  it('reads legacy tab kind as agent and keeps a session id only for codex tabs', () => {
    const result = migrateSettings({
      projects: [{ id: 'p', name: 'P', folder: 'C:\\p' }],
      workspace: {
        focusedIndex: 0,
        panes: [
          {
            projectId: 'p',
            activeIndex: 0,
            fontSize: 15,
            tabs: [
              { kind: 'claude', label: 'claude', sessionId: 'abc-resumed' },
              { agent: 'codex', label: 'codex', sessionId: '019aaaaa-0000-7000-8000-000000000001' },
              { agent: 'codex', label: 'codex 2' },
              { agent: 'gemini', label: 'gemini', sessionId: '11111111-2222-4333-8444-555555555555' },
              { kind: 'shell', label: 'shell' }
            ]
          }
        ]
      }
    })
    expect(result.workspace.panes[0].tabs).toEqual([
      { agent: 'claude', label: 'claude', sessionId: 'abc-resumed' },
      { agent: 'codex', label: 'codex', sessionId: '019aaaaa-0000-7000-8000-000000000001' },
      { agent: 'codex', label: 'codex 2' },
      { agent: 'gemini', label: 'gemini', sessionId: '11111111-2222-4333-8444-555555555555' },
      { agent: 'shell', label: 'shell' }
    ])
  })
})

describe('SettingsStore', () => {
  it('starts with defaults when the file is missing', () => {
    const store = new SettingsStore(tempFile())
    const { settings, warning } = store.load()
    expect(settings).toEqual(defaultSettings())
    expect(warning).toBeNull()
  })

  it('saves, reloads and merges patches', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.load()
    store.update({ projects: [{ id: 'p1', name: 'One', folder: 'C:\\one', defaultAgent: 'codex' }] })
    store.update({ sidebarCollapsed: true })
    const reloaded = new SettingsStore(file).load().settings
    expect(reloaded.projects).toEqual([{ id: 'p1', name: 'One', folder: 'C:\\one', defaultAgent: 'codex' }])
    expect(reloaded.sidebarCollapsed).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
  })

  it('keeps a corrupt file as a backup and reports a warning', () => {
    const file = tempFile()
    writeFileSync(file, '{ not json', 'utf8')
    const { settings, warning } = new SettingsStore(file).load()
    expect(settings).toEqual(defaultSettings())
    expect(warning).toContain('reset')
    const dir = file.replace(/[\\/][^\\/]+$/, '')
    expect(readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(true)
  })
})

describe('sessionInfo settings', () => {
  it('defaults notifications on and sound off, and keeps stored booleans', () => {
    expect(migrateSettings({}).sessionInfo).toEqual({ notifications: true, sound: false })
    expect(migrateSettings({ sessionInfo: { notifications: false, sound: true } }).sessionInfo).toEqual({
      notifications: false,
      sound: true
    })
    expect(migrateSettings({ sessionInfo: { notifications: 'yes' } }).sessionInfo.notifications).toBe(true)
  })
})

describe('migrateSettings splits and pinned', () => {
  const base = {
    projects: [{ id: 'a', name: 'acme-web', folder: 'C:\Work\acme-web' }],
    workspace: { focusedIndex: 0, panes: [] as unknown[] }
  }
  const pane = (extra: Record<string, unknown> = {}) => ({
    projectId: 'a',
    activeIndex: 0,
    fontSize: 14,
    tabs: [{ agent: 'shell', label: 'shell' }],
    ...extra
  })

  it('accepts old files without splits or pins', () => {
    const result = migrateSettings({ ...base, workspace: { focusedIndex: 0, panes: [pane()] } })
    expect(result.workspace.splits).toBeUndefined()
    expect(result.workspace.panes[0].pinned).toBeUndefined()
  })

  it('keeps valid splits and drops bad split data', () => {
    const good = migrateSettings({ ...base, workspace: { ...base.workspace, splits: { '2x2': { cols: [1, 3], rows: [1, 1] } } } })
    expect(good.workspace.splits).toEqual({ '2x2': { cols: [0.25, 0.75], rows: [0.5, 0.5] } })
    const bad = migrateSettings({ ...base, workspace: { ...base.workspace, splits: { x: 1, '2x2': { cols: 'no' } } } })
    expect(bad.workspace.splits).toBeUndefined()
    expect(migrateSettings({ ...base, workspace: { ...base.workspace, splits: [] } }).workspace.splits).toBeUndefined()
  })

  it('keeps only the first pinned pane in the workspace', () => {
    const result = migrateSettings({
      ...base,
      workspace: { focusedIndex: 0, panes: [pane({ pinned: true }), pane({ pinned: true }), pane({ pinned: 'yes' })] }
    })
    expect(result.workspace.panes.map((p) => p.pinned)).toEqual([true, undefined, undefined])
  })

  it('carries splits and pins through saved layouts', () => {
    const result = migrateSettings({
      ...base,
      layouts: [
        { id: 'l1', name: 'Morning', createdAt: 1, focusedIndex: 0, panes: [pane({ pinned: true })], splits: { '1x1': { cols: [1], rows: [1] }, '2x1': { cols: [1, 3], rows: [2] } } }
      ]
    })
    expect(result.layouts[0].panes[0].pinned).toBe(true)
    expect(result.layouts[0].splits).toEqual({ '2x1': { cols: [0.25, 0.75], rows: [1] } })
  })

  it('loads an old settings file that still has a snippets key and drops the key silently', () => {
    const old = { snippets: [{ id: 's1', name: 'Old', text: 'Review the diff', projectId: null, shortcut: 1 }], sessionsLayout: 'board' }
    const result = migrateSettings(old)
    expect(result.sessionsLayout).toBe('board')
    expect('snippets' in result).toBe(false)
  })

  it('reads a settings.json from disk that has snippets without throwing', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ snippets: 'not even a list', projects: [] }), 'utf8')
    expect(() => new SettingsStore(file).load()).not.toThrow()
  })
})
