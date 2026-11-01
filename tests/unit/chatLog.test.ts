import { describe, expect, it } from 'vitest'
import {
  CHAT_VIEWS_MAX,
  boundText,
  chatCapable,
  chatPhase,
  defaultViewFor,
  foldLines,
  rememberChatView,
  resolveChatView,
  sanitizeChatViews,
  sanitizeSessionViews,
  textDirection,
  type ChatItem
} from '../../src/shared/chatLog'

const message: ChatItem = { kind: 'message', id: 'm', role: 'agent', text: 'hi' }
const limit: ChatItem = { kind: 'notice', id: 'n', notice: 'limit', text: 'limit' }

describe('which agents have a chat view', () => {
  it('offers it for Claude and Codex only', () => {
    expect(chatCapable('claude')).toBe(true)
    expect(chatCapable('codex')).toBe(true)
    expect(chatCapable('gemini')).toBe(false)
    expect(chatCapable('shell')).toBe(false)
    expect(chatCapable(null)).toBe(false)
  })

  it('never resolves to Chat for Gemini or a shell, whatever was stored or chosen', () => {
    expect(resolveChatView({ agent: 'gemini', tabView: 'chat', remembered: 'chat', fallback: 'chat' })).toBe('terminal')
    expect(resolveChatView({ agent: 'shell', fallback: 'chat' })).toBe('terminal')
  })

  it('prefers the session choice, then what it remembered, then the default', () => {
    expect(resolveChatView({ agent: 'claude', tabView: 'terminal', remembered: 'chat', fallback: 'chat' })).toBe('terminal')
    expect(resolveChatView({ agent: 'claude', remembered: 'chat', fallback: 'terminal' })).toBe('chat')
    expect(resolveChatView({ agent: 'codex', fallback: 'chat' })).toBe('chat')
    expect(resolveChatView({ agent: 'codex', fallback: 'terminal' })).toBe('terminal')
  })
})

describe('remembered views', () => {
  it('keeps only well formed entries', () => {
    expect(sanitizeChatViews({ 'claude:abc-1': 'chat', 'gemini:x': 'chat', 'codex:y': 'maybe', 'claude:': 'chat' })).toEqual({ 'claude:abc-1': 'chat' })
    expect(sanitizeChatViews('nope')).toEqual({})
    expect(sanitizeChatViews([])).toEqual({})
  })

  it('updates without changing the original and forgets the oldest past the limit', () => {
    const base = { 'claude:a': 'terminal' as const }
    const next = rememberChatView(base, 'claude:a', 'chat')
    expect(base['claude:a']).toBe('terminal')
    expect(next['claude:a']).toBe('chat')
    let views: Record<string, 'chat' | 'terminal'> = {}
    for (let i = 0; i < CHAT_VIEWS_MAX + 5; i += 1) views = rememberChatView(views, `claude:s${i}`, 'chat')
    expect(Object.keys(views)).toHaveLength(CHAT_VIEWS_MAX)
    expect(views['claude:s0']).toBeUndefined()
  })
})

describe('default view per agent', () => {
  it('uses the default stored for each agent', () => {
    expect(sanitizeSessionViews({ claude: 'terminal', codex: 'chat' })).toEqual({ claude: 'terminal', codex: 'chat' })
  })

  it('moves an older single default to both agents', () => {
    expect(sanitizeSessionViews(undefined, 'chat')).toEqual({ claude: 'chat', codex: 'chat' })
    expect(sanitizeSessionViews({ codex: 'terminal' }, 'chat')).toEqual({ claude: 'chat', codex: 'terminal' })
  })

  it('falls back to the terminal when nothing valid is stored', () => {
    expect(sanitizeSessionViews(undefined)).toEqual({ claude: 'terminal', codex: 'terminal' })
    expect(sanitizeSessionViews({ claude: 'maybe', codex: 7 }, 'nope')).toEqual({ claude: 'terminal', codex: 'terminal' })
    expect(sanitizeSessionViews([], null)).toEqual({ claude: 'terminal', codex: 'terminal' })
  })

  it('has no default for Gemini or a shell', () => {
    const views = { claude: 'chat' as const, codex: 'chat' as const }
    expect(defaultViewFor(views, 'codex')).toBe('chat')
    expect(defaultViewFor(views, 'gemini')).toBe('terminal')
    expect(defaultViewFor(views, 'shell')).toBe('terminal')
  })
})

describe('text helpers', () => {
  it('bounds characters and lines and says it cut', () => {
    expect(boundText('a\nb\nc', 100, 2)).toEqual({ text: 'a\nb\n…', truncated: true })
    expect(boundText('abcdef', 3).truncated).toBe(true)
    expect(boundText('short', 100)).toEqual({ text: 'short', truncated: false })
  })

  it('folds long text by lines', () => {
    expect(foldLines('a\nb', 5)).toEqual({ head: 'a\nb', hidden: 0 })
    expect(foldLines('a\nb\nc\nd', 2)).toEqual({ head: 'a\nb', hidden: 2 })
  })

  it('reads direction from the first strong character', () => {
    expect(textDirection('ضيف زرار dark')).toBe('rtl')
    expect(textDirection('123 hello مرحبا')).toBe('ltr')
    expect(textDirection('   ')).toBe('ltr')
  })
})

describe('chatPhase', () => {
  it('keeps the working indicator until the session stops working, even with a reply already shown', () => {
    expect(chatPhase({ items: [message], working: true, needsApproval: false })).toBe('working')
    expect(chatPhase({ items: [message], working: false, needsApproval: false })).toBe('done')
  })

  it('puts an approval before everything and shows a limit only when it is the last thing', () => {
    expect(chatPhase({ items: [message], working: true, needsApproval: true })).toBe('approval')
    expect(chatPhase({ items: [message, limit], working: false, needsApproval: false })).toBe('limit')
    expect(chatPhase({ items: [limit, message], working: false, needsApproval: false })).toBe('done')
  })

  it('is empty for a session with nothing yet', () => {
    expect(chatPhase({ items: [], working: false, needsApproval: false })).toBe('empty')
  })
})
