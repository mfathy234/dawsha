import { describe, expect, it } from 'vitest'
import { appendHistory, historyAt, MAX_CHAT_HISTORY } from '../../src/shared/chatHistory'

describe('chat history', () => {
  it('caps entries and removes consecutive repeats', () => {
    expect(appendHistory(['same'], 'same')).toEqual(['same'])
    expect(appendHistory(Array.from({ length: MAX_CHAT_HISTORY }, (_, i) => `${i}`), 'next')).toHaveLength(MAX_CHAT_HISTORY)
  })
  it('navigates older/newer and restores the draft at the end', () => {
    expect(historyAt(['a', 'b'], -1, 'draft', -1)).toEqual({ index: 1, value: 'b' })
    expect(historyAt(['a', 'b'], 1, 'draft', 1)).toEqual({ index: -1, value: 'draft' })
  })
})
