const name = process.argv[2] || 'agent'
const kbps = Number(process.env.STREAM_KBPS ?? 30)
const startedAt = Date.now()
const quietMs = Number(process.env.STREAM_AFTER_MS ?? 0)
const ESC = '\x1b'
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega parser store render sidebar session worktree branch commit review pane terminal buffer stream'.split(' ')
let seed = [...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 7)
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const sentence = (count) => Array.from({ length: count }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ')
let step = 0
let spinner = 0
let echoes = 0
const BOX = 3

const paragraph = () => `${ESC}[39m${sentence(30 + Math.floor(rnd() * 40))}.\r\n`
const toolBlock = () => [
  `${ESC}[1;32m●${ESC}[0m ${ESC}[1mBash${ESC}[0m(npm test -- ${sentence(2).replace(' ', '-')})\r\n`,
  ...Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => `  ${ESC}[2m⎿${ESC}[0m  ${ESC}[36m${sentence(12)}${ESC}[0m ${ESC}[90m${sentence(3)}${ESC}[0m\r\n`),
  `  ${ESC}[32m+${ESC}[0m ${sentence(8)}\r\n  ${ESC}[31m-${ESC}[0m ${sentence(9)}\r\n`
].join('')
const longLine = () => `${sentence(70)}\r\n`

const drawBox = (first) => {
  const up = first ? '' : `${ESC}[${BOX}A${ESC}[J`
  const dots = '✻✶✷✸✹'[spinner % 5]
  spinner += 1
  return `${up}${ESC}[33m${dots} Working… (${Math.floor(step / 10)}s · esc to interrupt)${ESC}[0m\r\n╭${'─'.repeat(60)}╮\r\n│ > ${ESC}[2mTry "fix the failing test"${ESC}[0m${' '.repeat(30)}│\r\n╰${'─'.repeat(60)}╯`
}

process.stdout.write(`READY ${name}\r\n${drawBox(true)}`)
const tickMs = 50
const perTick = (kbps * 1024 * tickMs) / 1000
setInterval(() => {
  step += 1
  let out = drawBox(false)
  if (kbps > 0 && Date.now() - startedAt >= quietMs) {
    let body = ''
    while (body.length < perTick) {
      const roll = rnd()
      body += roll < 0.45 ? paragraph() : roll < 0.8 ? toolBlock() : longLine()
    }
    out = `${ESC}[${BOX}A${ESC}[J${body}${drawBox(true)}`
  }
  process.stdout.write(out)
}, tickMs)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.on('data', () => {
  echoes += 1
  process.stdout.write(`${ESC}[${BOX}A${ESC}[J@@KEY${echoes}@@\r\n${drawBox(true)}`)
})
