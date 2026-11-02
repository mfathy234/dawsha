import { describe, expect, it } from 'vitest'
import {
  initialAttention,
  stepAttention,
  type AttentionMemory,
  type AttentionObservation
} from '../../src/shared/attention'
import { detectPermissionPrompt } from '../../src/shared/permissionPrompt'

const away: AttentionObservation = { status: 'idle', waiting: false, focused: false, visible: true, windowFocused: true }

const run = (observations: Partial<AttentionObservation>[], start: AttentionMemory = initialAttention()) => {
  let memory = start
  const steps = observations.map((o) => {
    const step = stepAttention(memory, { ...away, ...o })
    memory = step.memory
    return step
  })
  return { steps, memory }
}

describe('stepAttention', () => {
  it('does not mark a pane that was never busy', () => {
    const { steps } = run([{ status: 'idle' }, { status: 'idle' }])
    expect(steps.map((s) => s.memory.attention)).toEqual(['none', 'none'])
  })

  it('marks done on busy to idle and keeps it until the pane is focused', () => {
    const { steps } = run([
      { status: 'busy' },
      { status: 'idle' },
      { status: 'idle' },
      { status: 'idle', focused: true }
    ])
    expect(steps.map((s) => s.memory.attention)).toEqual(['none', 'done', 'done', 'none'])
  })

  it('only notifies when the window is unfocused or the pane is not visible', () => {
    const seen = run([{ status: 'busy' }, { status: 'idle' }]).steps[1]
    expect(seen.notify).toBeNull()
    const hidden = run([{ status: 'busy' }, { status: 'idle', visible: false }]).steps[1]
    expect(hidden.notify).toBe('done')
    const blurred = run([{ status: 'busy' }, { status: 'idle', windowFocused: false }]).steps[1]
    expect(blurred.notify).toBe('done')
  })

  it('notifies once per finish, not on every poll', () => {
    const { steps } = run([{ status: 'busy' }, { status: 'idle', visible: false }, { status: 'idle', visible: false }])
    expect(steps.map((s) => s.notify)).toEqual([null, 'done', null])
  })

  it('does not mark a pane the user is watching', () => {
    const { steps } = run([
      { status: 'busy', focused: true },
      { status: 'idle', focused: true }
    ])
    expect(steps[1].memory.attention).toBe('none')
    expect(steps[1].notify).toBeNull()
  })

  it('a focused pane in an unfocused window still counts as unseen', () => {
    const { steps } = run([
      { status: 'busy', focused: true, windowFocused: false },
      { status: 'idle', focused: true, windowFocused: false }
    ])
    expect(steps[1].memory.attention).toBe('done')
    expect(steps[1].notify).toBe('done')
  })

  it('marks needs while a permission prompt waits, then clears when answered', () => {
    const { steps } = run([
      { status: 'busy' },
      { status: 'busy', waiting: true },
      { status: 'busy', waiting: true },
      { status: 'busy', waiting: false }
    ])
    expect(steps.map((s) => s.memory.attention)).toEqual(['none', 'needs', 'needs', 'none'])
    expect(steps.map((s) => s.notify)).toEqual([null, null, null, null])
    const hidden = run([{ status: 'busy' }, { status: 'busy', waiting: true, visible: false }, { status: 'busy', waiting: true, visible: false }])
    expect(hidden.steps.map((s) => s.notify)).toEqual([null, 'needs', null])
  })

  it('needs wins over done and a new busy turn clears done', () => {
    const { steps } = run([
      { status: 'busy' },
      { status: 'idle' },
      { status: 'idle', waiting: true },
      { status: 'busy' }
    ])
    expect(steps.map((s) => s.memory.attention)).toEqual(['none', 'done', 'needs', 'none'])
  })

  it('clears everything when the process exits', () => {
    const { steps } = run([{ status: 'busy' }, { status: 'idle' }, { status: 'exited', waiting: true }])
    expect(steps[2].memory.attention).toBe('none')
  })
})

describe('detectPermissionPrompt', () => {
  const prompt = [
    ' Bash command',
    '   npm test',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    "   2. Yes, and don't ask again for npm test commands",
    '   3. No, and tell Claude what to do differently (esc)'
  ].join('\n')

  it('recognises the permission menu in the last lines', () => {
    expect(detectPermissionPrompt(prompt)).toBe(true)
    expect(detectPermissionPrompt(`${'old output\n'.repeat(40)}${prompt}`)).toBe(true)
  })

  it('ignores ordinary output and prompts that scrolled away', () => {
    expect(detectPermissionPrompt('1. Yes we can list things\nplain text')).toBe(false)
    expect(detectPermissionPrompt(`${prompt}\n${'later output\n'.repeat(30)}`)).toBe(false)
    expect(detectPermissionPrompt('')).toBe(false)
  })
})

describe('detectPermissionPrompt with a mostly blank screen', () => {
  it('ignores empty rows below the menu', () => {
    const screen = ['Do you want to proceed?', '❯ 1. Yes', '  2. No', ...Array(20).fill('')].join('\n')
    expect(detectPermissionPrompt(screen)).toBe(true)
  })
})

describe('stepAttention with a flickering prompt', () => {
  const hidden: Partial<AttentionObservation> = { status: 'idle', visible: false }

  it('stays needs through a short flicker and notifies once', () => {
    const { steps } = run([
      { ...hidden, waiting: true, now: 0 },
      { ...hidden, waiting: false, now: 1_500 },
      { ...hidden, waiting: true, now: 3_000 },
      { ...hidden, waiting: false, now: 4_500 },
      { ...hidden, waiting: true, now: 6_000 }
    ])
    expect(steps.map((s) => s.memory.attention)).toEqual(['needs', 'needs', 'needs', 'needs', 'needs'])
    expect(steps.filter((s) => s.notify === 'needs')).toHaveLength(1)
  })

  it('clears needs once the prompt has been gone longer than the grace period', () => {
    const { steps } = run([
      { ...hidden, waiting: true, now: 0 },
      { ...hidden, waiting: false, now: 20_000 }
    ])
    expect(steps[1].memory.attention).toBe('none')
  })

  it('does not notify again for a new prompt within the cooldown when the user never looked', () => {
    const { steps } = run([
      { ...hidden, waiting: true, now: 0 },
      { ...hidden, waiting: false, now: 20_000 },
      { ...hidden, waiting: true, now: 30_000 }
    ])
    expect(steps[2].memory.attention).toBe('needs')
    expect(steps[2].notify).toBeNull()
  })

  it('notifies for a new prompt after the user has looked at the pane', () => {
    const { steps } = run([
      { ...hidden, waiting: true, now: 0 },
      { status: 'idle', waiting: false, focused: true, now: 5_000 },
      { ...hidden, waiting: true, now: 10_000 }
    ])
    expect(steps[2].notify).toBe('needs')
  })
})
