const { appendFileSync, mkdirSync } = require('node:fs')
const { dirname } = require('node:path')

// A stand-in for Claude or Codex. It echoes what it is typed, and when a line is submitted it writes the
// user's message and a reply into the session log, the reply in two pieces so a half-written line is seen.
const kind = process.argv[2] || 'claude'
const log = process.env.CHAT_LOG
const stamp = () => new Date().toISOString()
let typed = ''
let n = 0

function userLine(text) {
  if (kind === 'codex') {
    return { timestamp: stamp(), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', id: `u${n}`, content: [{ type: 'text', text }] } } }
  }
  return { type: 'user', uuid: `u${n}`, timestamp: stamp(), message: { role: 'user', content: text } }
}

function replyLine(text) {
  if (kind === 'codex') {
    return { timestamp: stamp(), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'AgentMessage', id: `a${n}`, content: [{ type: 'Text', text }], phase: 'final_answer' } } }
  }
  return { type: 'assistant', uuid: `a${n}`, timestamp: stamp(), message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

function writeLog(text) {
  if (!log) return
  mkdirSync(dirname(log), { recursive: true })
  n += 1
  appendFileSync(log, JSON.stringify(userLine(text)) + '\n')
  const reply = JSON.stringify(replyLine(`Echo: ${text}`)) + '\n'
  const half = Math.floor(reply.length / 2)
  setTimeout(() => appendFileSync(log, reply.slice(0, half)), 200)
  setTimeout(() => appendFileSync(log, reply.slice(half)), 700)
}

process.stdout.write(`READY ${kind}\r\n`)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8').replace(/\u001b\[20[01]~/g, '')
  if (text === '\u001b') return
  typed += text.replace(/\r/g, '')
  if (text.includes('\r')) {
    process.stdout.write(`GOT ${JSON.stringify(typed)}\r\n`)
    if (typed.trim() !== '') writeLog(typed)
    typed = ''
  }
})
setInterval(() => undefined, 60_000)
