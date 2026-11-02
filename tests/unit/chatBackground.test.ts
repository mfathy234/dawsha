import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import { backgroundSummary, elapsedLabel, parseTaskNotifications } from '../../src/shared/chatBackground'
import type { ChatMessage } from '../../src/shared/chatLog'

const lines = (...records: unknown[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'
const at = (second: number): string => `2026-11-02T08:00:${String(second).padStart(2, '0')}.000Z`

// Shapes copied from a real Claude Code session log, with the text replaced.
const agentUse = (id: string, description: string, second = 1) => ({
  type: 'assistant',
  uuid: `use-${id}`,
  timestamp: at(second),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Agent', input: { description, subagent_type: 'general-purpose', model: 'sonnet', prompt: 'Do the thing' } }] }
})
const agentLaunched = (id: string, agentId: string, second = 2) => ({
  type: 'user',
  uuid: `res-${id}`,
  timestamp: at(second),
  toolUseResult: { isAsync: true, status: 'async_launched', agentId, description: 'from result', prompt: 'Do the thing' },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: `Async agent launched successfully.\nagentId: ${agentId}` }] }] }
})
const shellUse = (id: string, command: string, description?: string) => ({
  type: 'assistant',
  uuid: `use-${id}`,
  timestamp: at(3),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, run_in_background: true, ...(description ? { description } : {}) } }] }
})
const shellLaunched = (id: string, taskId: string) => ({
  type: 'user',
  uuid: `res-${id}`,
  timestamp: at(4),
  toolUseResult: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: taskId },
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: `Command running in background with ID: ${taskId}.` }] }
})
const notification = (taskId: string, toolUseId: string, status: string, second: number, result = '', summary = 'finished') => ({
  type: 'user',
  uuid: `note-${taskId}-${second}`,
  timestamp: at(second),
  origin: { kind: 'task-notification' },
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>C:\\x\\${taskId}.output</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n${result ? `<result>${result}</result>\n` : ''}<usage><tool_uses>3</tool_uses></usage>\n</task-notification>`
  }
})

function read(...records: unknown[]): ClaudeChatReader {
  const reader = new ClaudeChatReader()
  reader.feed(lines(...records))
  return reader
}

describe('background work in a Claude log', () => {
  it('shows a launch with no notification as running', () => {
    const [task] = read(agentUse('t1', 'Research gaps'), agentLaunched('t1', 'a111')).background()
    expect(task).toMatchObject({ id: 'a111', launchId: 't1', kind: 'agent', title: 'Research gaps', agentType: 'general-purpose', status: 'running' })
    expect(task.startedAt).toBe(Date.parse(at(2)))
    expect(task.finishedAt).toBeUndefined()
  })

  it('does not count a plain Agent call that finished in the foreground', () => {
    const done = { type: 'user', uuid: 'r', toolUseResult: { status: 'completed', agentId: 'x', content: [] }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'report' }] } }
    expect(read(agentUse('t1', 'Sync work'), done).background()).toEqual([])
  })

  it('marks an agent done with its report when the notification comes', () => {
    const [task] = read(agentUse('t1', 'Research gaps'), agentLaunched('t1', 'a111'), notification('a111', 't1', 'completed', 30, '# Findings\n\nAll good.')).background()
    expect(task.status).toBe('done')
    expect(task.finishedAt).toBe(Date.parse(at(30)))
    expect(task.resultPreview).toContain('All good.')
  })

  it('maps failed, killed and stopped notifications', () => {
    const reader = read(
      agentUse('t1', 'One'), agentLaunched('t1', 'a1'),
      agentUse('t2', 'Two'), agentLaunched('t2', 'a2'),
      agentUse('t3', 'Three'), agentLaunched('t3', 'a3'),
      notification('a1', 't1', 'failed', 10),
      notification('a2', 't2', 'killed', 11),
      notification('a3', 't3', 'stopped', 12)
    )
    expect(reader.background().map((task) => task.status)).toEqual(['failed', 'stopped', 'stopped'])
  })

  it('pairs a notification that is read before its launch result', () => {
    const reader = read(agentUse('t1', 'Early'), notification('a111', 't1', 'completed', 9, 'report'), agentLaunched('t1', 'a111', 8))
    expect(reader.background()[0]).toMatchObject({ status: 'done', finishedAt: Date.parse(at(9)) })
  })

  it('pairs by task id when the notification has no tool-use id', () => {
    const note = notification('a111', 't1', 'completed', 9)
    note.message.content = note.message.content.replace(/<tool-use-id>.*<\/tool-use-id>\n/, '')
    expect(read(agentUse('t1', 'No id'), agentLaunched('t1', 'a111'), note).background()[0].status).toBe('done')
  })

  it('keeps the latest notification when an agent notifies again', () => {
    const reader = read(agentUse('t1', 'Again'), agentLaunched('t1', 'a111'), notification('a111', 't1', 'failed', 9), notification('a111', 't1', 'completed', 20, 'second'))
    expect(reader.background()[0]).toMatchObject({ status: 'done', resultPreview: 'second' })
  })

  it('tracks a background shell command', () => {
    const reader = read(shellUse('s1', 'npm ci && npm test', 'Install and test'), shellLaunched('s1', 'b0ax8c0zl'))
    expect(reader.background()[0]).toMatchObject({ id: 'b0ax8c0zl', kind: 'shell', title: 'Install and test', status: 'running' })
    reader.feed(lines(notification('b0ax8c0zl', 's1', 'completed', 40, '', 'Background command "Install and test" completed (exit code 0)')))
    expect(reader.background()[0]).toMatchObject({ status: 'done', summary: expect.stringContaining('exit code 0') })
  })

  it('titles a shell command with no description by its command', () => {
    expect(read(shellUse('s1', 'npm run build\nnpm test'), shellLaunched('s1', 'bx')).background()[0].title).toBe('npm run build')
  })

  it('ignores a notification for work it never saw launched', () => {
    expect(read(notification('zzz', 'tX', 'stopped', 5)).background()).toEqual([])
  })

  it('keeps the notification out of the visible messages', () => {
    const reader = read({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'hello' } }, agentUse('t1', 'X'), agentLaunched('t1', 'a1'), notification('a1', 't1', 'completed', 9, 'report'))
    const messages = reader.items().filter((item): item is ChatMessage => item.kind === 'message')
    expect(messages.map((m) => m.text)).toEqual(['hello'])
  })

  it('reads notifications from a text block too', () => {
    const note = notification('a111', 't1', 'completed', 9)
    const blocks = { ...note, message: { role: 'user', content: [{ type: 'text', text: note.message.content }] } }
    expect(read(agentUse('t1', 'Blocks'), agentLaunched('t1', 'a111'), blocks).background()[0].status).toBe('done')
  })

  it('keeps log text as plain text', () => {
    const [task] = read(agentUse('t1', '<img src=x onerror=alert(1)>'), agentLaunched('t1', 'a1')).background()
    expect(task.title).toBe('<img src=x onerror=alert(1)>')
  })
})

describe('background helpers', () => {
  it('parses several notifications and skips text that is not one', () => {
    const a = notification('a', 't1', 'completed', 1).message.content
    const b = notification('b', 't2', 'failed', 2).message.content
    expect(parseTaskNotifications(`${a}\n${b}`).map((n) => [n.taskId, n.status])).toEqual([['a', 'completed'], ['b', 'failed']])
    expect(parseTaskNotifications('just a message')).toEqual([])
  })

  it('counts and times', () => {
    const base = { id: 'i', launchId: 'l', kind: 'agent' as const, title: 't', startedAt: 0 }
    expect(backgroundSummary([{ ...base, status: 'running' }, { ...base, status: 'running' }, { ...base, status: 'done' }, { ...base, status: 'failed' }])).toBe('2 running · 1 done · 1 failed')
    expect(elapsedLabel(42_000)).toBe('42s')
    expect(elapsedLabel(185_000)).toBe('3m 05s')
    expect(elapsedLabel(3_720_000)).toBe('1h 02m')
  })
})
