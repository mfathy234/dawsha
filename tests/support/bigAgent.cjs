const ESC = '\x1b'
const ROWS = Number(process.env.BIG_ROWS ?? 10000)
const WORDS = 'alpha beta gamma delta epsilon zeta parser store render sidebar session worktree branch commit review pane terminal buffer stream error failed warning TODO passed'.split(' ')
let seed = 7
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
const sentence = (count) => Array.from({ length: count }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ')
let out = ''
let rows = 0
while (rows < ROWS) {
  const roll = rnd()
  if (roll < 0.4) { out += `${sentence(30 + Math.floor(rnd() * 30))}.\r\n`; rows += 2 }
  else if (roll < 0.8) {
    out += `${ESC}[1;32m●${ESC}[0m ${ESC}[1mBash${ESC}[0m(npm test -- ${sentence(2).replace(' ', '-')})\r\n`
    for (let i = 0; i < 4; i += 1) out += `  ${ESC}[2m⎿${ESC}[0m  ${ESC}[36m${sentence(12)}${ESC}[0m ${ESC}[90m${sentence(3)}${ESC}[0m\r\n`
    out += `  ${ESC}[32m+${ESC}[0m ${sentence(8)}\r\n  ${ESC}[31m-${ESC}[0m ${sentence(9)}\r\n`
    rows += 7
  } else { out += `${sentence(70)}\r\n`; rows += 3 }
}
process.stdout.write(`READY\r\n${out}`)
process.stdout.write(`╭${'─'.repeat(60)}╮\r\n│ > ${ESC}[2mTry "fix the failing test"${ESC}[0m${' '.repeat(30)}│\r\n╰${'─'.repeat(60)}╯`)
if (process.env.BIG_STREAM === '1') {
  process.argv[2] = process.argv[2] || 'big'
  require('./streamAgent.cjs')
} else {
  setInterval(() => {}, 1000)
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  process.stdin.on('data', () => {})
}
