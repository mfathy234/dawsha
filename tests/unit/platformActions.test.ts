import { expect, it } from 'vitest'
import { buildJumpList, parseDesktopAction, recentProjects } from '../../src/shared/platformActions'
import { newlyWaiting, waitingSessionIds } from '../../src/shared/waitingAttention'
import { migrateSettings } from '../../src/shared/settingsSchema'

it('finds newly waiting sessions even when the count stays the same', () => {
  expect(newlyWaiting(['a'], ['a', 'a'])).toEqual([])
  expect(newlyWaiting(['a'], ['b'])).toEqual(['b'])
  expect(newlyWaiting([], ['a', 'a', 'b'])).toEqual(['a', 'b'])
  expect(newlyWaiting(['a'], [])).toEqual([])
})

it('keeps an acknowledged prompt in the waiting set until it actually ends', () => {
  const waiting = { id: 'a', exited: false, waiting: true, attention: 'needs' }
  const before = waitingSessionIds([waiting])
  const acknowledged = waitingSessionIds([{ ...waiting, attention: 'none' }])
  expect(newlyWaiting(before, acknowledged)).toEqual([])
  expect(waitingSessionIds([{ ...waiting, waiting: false }])).toEqual(['a'])
  expect(waitingSessionIds([{ ...waiting, waiting: false, attention: 'none' }])).toEqual([])
  expect(waitingSessionIds([{ ...waiting, exited: true }])).toEqual([])
})

it('parses desktop launch arguments without interpreting CLI arguments', () => {
  expect(parseDesktopAction(['app.exe', '--new-session=project%20one'])).toEqual({ kind: 'new-session', projectId: 'project one' })
  expect(parseDesktopAction(['app.exe', '--new-session'])).toEqual({ kind: 'new-session', projectId: null })
  expect(parseDesktopAction(['app.exe', '--mini-window'])).toEqual({ kind: 'mini-window' })
  expect(parseDesktopAction(['app.exe', '--new-session=%GG'])).toBeNull()
  expect(parseDesktopAction(['app.exe', '--new-session='])).toBeNull()
  expect(parseDesktopAction(['app.exe', 'start', 'project'])).toBeNull()
})

const projects = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: `Project ${i}`, folder: `/p${i}`, defaultAgent: 'claude' as const }))

it('builds five recent project tasks and the two standard tasks, respecting removals', () => {
  const list = buildJumpList(projects, ['gone', 'p6', 'p6', 'p4'], 'Dawsha.exe', 'dawsha.ico', [], '"C:\\dev app" ')
  expect(list[0].name).toBe('New Claude session')
  expect(list[0].items).toHaveLength(5)
  expect(list[0].items[0]).toMatchObject({ title: 'Project 6', description: 'New Claude session in Project 6', args: '"C:\\dev app" --new-session=p6', program: 'Dawsha.exe' })
  expect(list[1].items.map(item => item.title)).toEqual(['New session', 'Mini window'])
  // Every entry shows Dawsha's own icon file, never the running program's (electron.exe when run from source).
  expect(list.flatMap(category => category.items).every(item => item.iconPath === 'dawsha.ico' && item.iconIndex === 0)).toBe(true)
  expect(buildJumpList(projects, [], 'Dawsha.exe', 'dawsha.ico', ['--new-session=p0'])[0].items.some(item => item.args === '--new-session=p0')).toBe(false)
  expect(recentProjects(projects, ['p5', 'p5', 'missing']).map(p => p.id)).toEqual(['p5', 'p0', 'p1', 'p2', 'p3'])
})

it('persists only distinct known project IDs for the desktop recent list', () => {
  const settings = migrateSettings({ projects, recentProjectIds: ['p4', 'unknown', 'p4', 'p2', 1] })
  expect(settings.recentProjectIds).toEqual(['p4', 'p2'])
})
