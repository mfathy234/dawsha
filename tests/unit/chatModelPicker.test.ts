import { describe, expect, it } from 'vitest'
import { canPickModel, currentChoice, effortCommand, effortLevels, modelChoices, modelCommand, modelLine, modelSetText } from '../../src/shared/chatModels'

describe('chat model picker logic', () => {
  it('offers Claude models and efforts, and nothing for Gemini', () => {
    expect(modelChoices('claude').map((choice) => choice.id)).toEqual(['opus', 'sonnet', 'haiku'])
    expect(effortLevels('claude')).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(canPickModel('gemini')).toBe(false)
    expect(canPickModel('codex')).toBe(true)
  })

  it('finds the choice a model name belongs to', () => {
    expect(currentChoice('claude', 'Opus 5.5')?.id).toBe('opus')
    expect(currentChoice('claude', 'claude-sonnet-5-5')?.id).toBe('sonnet')
    expect(currentChoice('claude', 'something-else')).toBeNull()
    expect(currentChoice('claude', null)).toBeNull()
  })

  it('drives the agent with its own commands', () => {
    expect(modelCommand('claude', 'sonnet')).toBe('/model sonnet')
    expect(effortCommand('claude', 'high')).toBe('/effort high')
    expect(modelCommand('codex', 'x')).toBe('/model')
    expect(effortCommand('codex', 'high')).toBe('/model')
  })

  it('writes the bar text and the thread row', () => {
    expect(modelLine('Opus 5.5', 'medium')).toBe('Opus 5.5 · medium')
    expect(modelLine('Opus 5.5', null)).toBe('Opus 5.5')
    expect(modelLine(null, null)).toBe('Model')
    expect(modelSetText('Sonnet', 'high')).toBe('Model set to Sonnet · high')
  })
})
