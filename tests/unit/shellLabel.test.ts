import { describe, expect, it } from 'vitest'
import { ClaudeChatReader } from '../../src/main/chatLog/claudeReader'
import type { ChatTool } from '../../src/shared/chatLog'
import { shellLabel } from '../../src/shared/shellLabel'

const FOLDER = 'C:\\Users\\Dev\\Projects\\app'

describe('shellLabel', () => {
  it('uses the description and keeps the raw command', () => {
    const label = shellLabel({ command: 'B="/c/x"; npx vitest run', description: 'Run the unit tests', folder: FOLDER })
    expect(label).toEqual({ text: 'Run the unit tests', command: 'B="/c/x"; npx vitest run', described: true })
  })

  it('ignores a blank description', () => {
    expect(shellLabel({ command: 'ls', description: '  ' }).text).toBe('ls')
  })

  it('strips a leading cd into the session folder, in git-bash form', () => {
    const label = shellLabel({ command: 'cd /c/Users/Dev/Projects/app && npx tsc --noEmit', folder: FOLDER })
    expect(label.text).toBe('npx tsc --noEmit')
    expect(label.command).toBe('cd /c/Users/Dev/Projects/app && npx tsc --noEmit')
  })

  it('strips a cd below the folder, with a semicolon, quotes or backslashes', () => {
    expect(shellLabel({ command: 'cd "C:\\Users\\Dev\\Projects\\app\\src"; ls', folder: FOLDER }).text).toBe('ls')
    expect(shellLabel({ command: "cd 'c:/users/dev/projects/app/' && git status", folder: FOLDER }).text).toBe('git status')
  })

  it('keeps a cd that leaves the folder, a sibling with the same prefix, or has no folder to compare', () => {
    expect(shellLabel({ command: 'cd /c/Users/Dev/Projects/other && ls', folder: FOLDER }).text).toBe('cd /c/Users/Dev/Projects/other && ls')
    expect(shellLabel({ command: 'cd /c/Users/Dev/Projects/app-two && ls', folder: FOLDER }).text).toBe('cd /c/Users/Dev/Projects/app-two && ls')
    expect(shellLabel({ command: 'cd /c/Users/Dev/Projects/app && ls' }).text).toBe('cd /c/Users/Dev/Projects/app && ls')
  })

  it('collapses whitespace and newlines', () => {
    expect(shellLabel({ command: 'python - <<"PY"\nprint(1)\n   PY' }).text).toBe('python - <<"PY" print(1) PY')
  })

  it('leaves command undefined when the text is the command itself', () => {
    expect(shellLabel({ command: 'ls -la' }).command).toBeUndefined()
  })

  it('bounds a very long command', () => {
    expect(shellLabel({ command: 'x'.repeat(1000) }).text.length).toBeLessThanOrEqual(240)
  })
})

describe('chat readers use shellLabel', () => {
  const claude = (input: object, folder?: string): ChatTool => {
    const reader = new ClaudeChatReader(folder)
    const record = { type: 'assistant', uuid: 'a', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'Bash', input }] } }
    reader.feed(JSON.stringify(record) + '\n')
    return reader.items()[0] as ChatTool
  }

  it('shows Claude Code\'s description and keeps the command for the detail', () => {
    const tool = claude({ command: 'B="/c/x"; npx vitest run', description: 'Run the unit tests' })
    expect(tool.target).toBe('Run the unit tests')
    expect(tool.command).toBe('B="/c/x"; npx vitest run')
  })

  it('drops the cd into the session folder', () => {
    const tool = claude({ command: 'cd /c/Users/Dev/Projects/app && ls' }, FOLDER)
    expect(tool.target).toBe('ls')
  })
})
