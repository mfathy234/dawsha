import type { BlockLine } from '../../src/shared/terminalBlocks'

export const toLines = (text: string): BlockLine[] =>
  text.split('\n').map((line, row) => ({ row, rows: 1, text: line }))

export const CLAUDE_SESSION = `> run the unit tests and fix what fails

● Bash(npm test)
  ⎿  Test Files  1 failed | 187 passed (188)
     ✗ tests/unit/miniWindow.test.ts > detail keeps approval focus
     AssertionError: expected undefined to be 'allow'
      ❯ tests/unit/miniWindow.test.ts:212:34
     Duration 8.2s

● Bash(sed -n 180,240p tests/unit/miniWindow.test.ts)
  ⎿  describe('detail', () => {
     ... +58 lines (ctrl+o to expand)

● Update(src/renderer/mini/detail.ts)
  ⎿  Updated src/renderer/mini/detail.ts with 6 additions and 2 removals
      41 -  render(detail, store.get(id))
      41 +  const state = await store.whenReady(id)
      42 +  render(detail, state)

● The detail view rendered before the session state arrived. It now waits.

● Bash(npm test -- miniWindow)
  ⎿  38 passed (1.4s)

╭──────────────────────────────╮
│ >                            │
╰──────────────────────────────╯`

export const CODEX_SESSION = `› fix the flaky mini window test

• Explored
  └ Read detail.ts

• Ran npm test
  └ FAIL tests/unit/miniWindow.test.ts
    1 failed | 187 passed

• Edited src/renderer/mini/detail.ts (+6 -2)
    @@ -41,7 +41,11 @@ export function openDetail(
    -  render(detail, store.get(id))
    +  render(detail, state)

• All tests pass now.`

export const PERMISSION_SESSION = `● Bash(rm -rf build)
  ⎿  Running…

╭───────────────────────────────╮
│ Bash command                  │
│ Do you want to proceed?       │
│ ❯ 1. Yes                      │
╰───────────────────────────────╯`
