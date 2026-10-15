import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import type { Sandbox } from '../e2e/helpers'
import { castEventLine, castHeaderLine } from '../../src/shared/cast'
import { CLAUDE_IDS } from './resumeFixtures'

const MINUTE = 60_000

const jsonl = (records: unknown[]): string => `${records.map((record) => JSON.stringify(record)).join('\n')}\n`

const claudeDir = (sandbox: Sandbox, folder: string): string => {
  const dir = join(sandbox.claudeHome, 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  return dir
}

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * MINUTE).toISOString()

const text = (minutesAgo: number, value: string): unknown => ({
  type: 'assistant',
  timestamp: at(minutesAgo),
  message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: value }] }
})

const tool = (minutesAgo: number, id: string, name: string, input: Record<string, unknown>): unknown => ({
  type: 'assistant',
  timestamp: at(minutesAgo),
  message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] }
})

const result = (minutesAgo: number, id: string, content: string): unknown => ({
  type: 'user',
  timestamp: at(minutesAgo),
  message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }
})

const prompt = (minutesAgo: number, value: string): unknown => ({ type: 'user', timestamp: at(minutesAgo), message: { content: value } })

export function writeActiveTranscript(sandbox: Sandbox, folder: string): void {
  const edit = (minutesAgo: number, id: string, file: string): unknown[] => [
    tool(minutesAgo, id, 'Edit', { file_path: join(folder, file), old_string: 'a', new_string: 'b' }),
    result(minutesAgo - 0.5, id, 'ok')
  ]
  const records = [
    prompt(42, 'Add a dark mode toggle to the settings page and remember the choice between visits.'),
    text(41, 'I will start with the settings components and the theme context.'),
    tool(40, 'r1', 'Read', { file_path: join(folder, 'src/components/Settings.tsx') }),
    result(39.5, 'r1', 'ok'),
    ...edit(36, 'e1', 'src/context/theme.tsx'),
    ...edit(33, 'e2', 'src/components/ThemeToggle.tsx'),
    ...edit(31, 'e3', 'src/components/Settings.tsx'),
    ...edit(29, 'e4', 'src/context/theme.tsx'),
    tool(26, 't1', 'Bash', { command: 'npm test -- ThemeToggle' }),
    result(25, 't1', 'Tests  2 failed | 11 passed (13)'),
    ...edit(23, 'e5', 'src/components/ThemeToggle.tsx'),
    tool(21, 't2', 'Bash', { command: 'npm test -- ThemeToggle' }),
    result(20, 't2', 'Tests  13 passed (13)'),
    prompt(17, 'Also keep the choice when the system theme changes, and add a test for it.'),
    ...edit(14, 'e6', 'src/context/theme.test.tsx'),
    tool(11, 't3', 'Bash', { command: 'npm run lint' }),
    result(10, 't3', 'No problems found'),
    tool(8, 't4', 'Bash', { command: 'npm test' }),
    result(7, 't4', 'Tests  41 passed (41)'),
    text(6, 'Done. The toggle is in Settings, the choice is saved in localStorage and follows the system theme until you pick one.'),
    { type: 'ai-title', aiTitle: 'Add dark mode toggle' }
  ]
  writeFileSync(join(claudeDir(sandbox, folder), `${CLAUDE_IDS['acme-web']}.jsonl`), jsonl(records))
}

function claudeClosed(sandbox: Sandbox, folder: string, id: string, title: string, daysAgo: number, records: unknown[]): void {
  const path = join(claudeDir(sandbox, folder), `${id}.jsonl`)
  writeFileSync(path, jsonl([...records, { type: 'ai-title', aiTitle: title }]))
  const old = new Date(Date.now() - daysAgo * 1440 * MINUTE)
  utimesSync(path, old, old)
}

export function writeClosedSessions(sandbox: Sandbox, folder: (name: string) => string): void {
  const base = (daysAgo: number): number => daysAgo * 1440
  claudeClosed(sandbox, folder('billing-api'), '8d2a4c10-6b3e-4f7a-9c15-0e1d2f3a4b05', 'Handle Stripe rate limits', 2, [
    prompt(base(2) + 50, 'The nightly invoice sync fails with 429 errors from Stripe. Add backoff so a rate limit does not fail the job.'),
    text(base(2) + 48, 'Stripe sends a Retry-After header. I will wrap the client so a rate limit waits and retries up to five times.'),
    tool(base(2) + 45, 'a1', 'Edit', { file_path: join(folder('billing-api'), 'src/sync/stripeClient.ts'), old_string: 'a', new_string: 'b' }),
    tool(base(2) + 40, 'a2', 'Bash', { command: 'npm test -- stripeClient' }),
    result(base(2) + 39, 'a2', 'Tests  9 passed (9)'),
    text(base(2) + 36, 'The client now honors Retry-After and logs each rate limit once per minute.')
  ])
  claudeClosed(sandbox, folder('acme-web'), '5c7e9a21-3d4b-4e86-8f10-2a3b4c5d6e07', 'Debounce the search box', 6, [
    prompt(base(6) + 30, 'Typing in the search box fires a request per key. Debounce it and respect the API rate limit.'),
    text(base(6) + 28, 'I will debounce by 250 ms and cancel the request in flight when a new key arrives.'),
    tool(base(6) + 25, 'b1', 'Edit', { file_path: join(folder('acme-web'), 'src/components/SearchBox.tsx'), old_string: 'a', new_string: 'b' }),
    tool(base(6) + 20, 'b2', 'Bash', { command: 'npm test -- SearchBox' }),
    result(base(6) + 19, 'b2', 'Tests  6 passed (6)')
  ])
  const codexId = '019aaaaa-0000-7000-8000-00000000f003'
  const dir = join(sandbox.codexHome, 'sessions', '2026', '10', '10')
  mkdirSync(dir, { recursive: true })
  const codexPath = join(dir, `rollout-2026-10-10T09-00-00-${codexId}.jsonl`)
  writeFileSync(
    codexPath,
    jsonl([
      { type: 'session_meta', payload: { id: codexId, cwd: folder('mobile-shell'), timestamp: at(base(4) + 60) } },
      { type: 'turn_context', payload: { model: 'gpt-5.6-sol' } },
      { timestamp: at(base(4) + 55), type: 'event_msg', payload: { type: 'user_message', message: 'Push token refresh hammers the server on app start. Add a rate limit.' } },
      { timestamp: at(base(4) + 54), type: 'event_msg', payload: { type: 'agent_message', message: 'Adding a rate limit of one refresh per five minutes, stored across launches.' } }
    ])
  )
  writeFileSync(join(sandbox.codexHome, 'session_index.jsonl'), `${JSON.stringify({ id: codexId, thread_name: 'Throttle push token refresh' })}\n`, { flag: 'a' })
  const old = new Date(Date.now() - 4 * 1440 * MINUTE)
  utimesSync(codexPath, old, old)
}

const ESC = String.fromCharCode(27)
const dim = (value: string): string => `${ESC}[2m${value}${ESC}[0m`
const bold = (value: string): string => `${ESC}[1m${value}${ESC}[0m`
const green = (value: string): string => `${ESC}[32m${value}${ESC}[0m`
const cyan = (value: string): string => `${ESC}[36m${value}${ESC}[0m`
const amber = (value: string): string => `${ESC}[33m${value}${ESC}[0m`

export const REPLAY_ID_FOLDER = '2026-10-14'
export const REPLAY_ID = `${REPLAY_ID_FOLDER}/acme-web-add-dark-mode-toggle`

export function writeReplay(sandbox: Sandbox, folder: string): void {
  const startedAt = Date.now() - 3 * 3_600_000
  const lines: Array<[number, string, 'o' | 'm']> = [
    [0.4, '\r\n', 'o'],
    [1.0, 'prompt', 'm'],
    [1.0, `${bold('> Add a dark mode toggle to the settings page')}\r\n\r\n`, 'o'],
    [3.5, `${green('●')} I will start with the settings components and the theme context.\r\n`, 'o'],
    [6.0, dim('  ⎿  Read src/components/Settings.tsx (84 lines)\r\n'), 'o'],
    [6.4, dim('  ⎿  Read src/context/theme.tsx (31 lines)\r\n\r\n'), 'o'],
    [11.0, `${green('●')} Adding a ${cyan('ThemeToggle')} and saving the choice in localStorage.\r\n`, 'o'],
    [16.0, dim('  ⎿  Update src/context/theme.tsx  (+18 -3)\r\n'), 'o'],
    [19.0, dim('  ⎿  Create src/components/ThemeToggle.tsx  (+42)\r\n'), 'o'],
    [22.0, dim('  ⎿  Update src/components/Settings.tsx  (+9 -0)\r\n\r\n'), 'o'],
    [27.0, `${green('●')} Running the tests for the new component.\r\n\r\n`, 'o'],
    [28.0, 'permission', 'm'],
    [28.0, ` Bash command\r\n   npm test -- ThemeToggle\r\n\r\n Do you want to proceed?\r\n ${cyan('❯')} 1. Yes\r\n   2. Yes, and don't ask again for npm test commands\r\n   3. No, and tell Claude what to do differently\r\n\r\n`, 'o'],
    [61.0, dim('  ⎿  Tests  2 failed | 11 passed (13)\r\n\r\n'), 'o'],
    [64.0, `${green('●')} Two tests expect the old default theme. Fixing them.\r\n`, 'o'],
    [70.0, dim('  ⎿  Update src/components/ThemeToggle.tsx  (+4 -2)\r\n'), 'o'],
    [75.0, dim('  ⎿  Bash npm test -- ThemeToggle\r\n'), 'o'],
    [82.0, `${green('●')} All 13 tests pass.\r\n\r\n`, 'o'],
    [84.0, 'prompt', 'm'],
    [84.0, `${bold('> Also keep the choice when the system theme changes, and add a test for it.')}\r\n\r\n`, 'o'],
    [90.0, `${green('●')} Listening to prefers-color-scheme until you pick a theme yourself.\r\n`, 'o'],
    [96.0, dim('  ⎿  Update src/context/theme.tsx  (+11 -2)\r\n'), 'o'],
    [101.0, dim('  ⎿  Create src/context/theme.test.tsx  (+36)\r\n\r\n'), 'o'],
    [110.0, `${green('●')} All 41 tests pass and the lint check is clean.\r\n\r\n`, 'o'],
    [112.0, `${amber('✻')} Done. Ready for review.\r\n`, 'o'],
    [113.0, 'exit', 'm']
  ]
  const day = join(sandbox.userData, 'recordings', REPLAY_ID_FOLDER)
  mkdirSync(day, { recursive: true })
  const header = castHeaderLine({ version: 2, width: 112, height: 30, timestamp: Math.floor(startedAt / 1000) })
  const body = lines.map(([t, data, kind]) => castEventLine(t, kind, data)).join('')
  const base = join(day, 'acme-web-add-dark-mode-toggle')
  writeFileSync(`${base}.cast`, header + body, 'utf8')
  writeFileSync(
    `${base}.json`,
    JSON.stringify({
      terminalId: 'demo-terminal-1',
      projectId: 'acme-web',
      projectName: 'acme-web',
      agent: 'claude',
      title: 'Add dark mode toggle',
      cwd: folder,
      startedAt,
      endedAt: startedAt + 113_000,
      exitCode: 0,
      endReason: null,
      cols: 112,
      rows: 30
    }),
    'utf8'
  )
}

export async function shrinkTo(png: Buffer, width: number, height: number): Promise<Buffer> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const data = await page.evaluate(
      async ([source, w, h]) => {
        const image = new Image()
        image.src = `data:image/png;base64,${source}`
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = w as number
        canvas.height = h as number
        const context = canvas.getContext('2d')!
        context.imageSmoothingQuality = 'high'
        context.drawImage(image, 0, 0, w as number, h as number)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      [png.toString('base64'), width, height]
    )
    return Buffer.from(data, 'base64')
  } finally {
    await browser.close()
  }
}
