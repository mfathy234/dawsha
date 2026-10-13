'use strict'

const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const START_WAIT_MS = 30000
const RETRY_MS = 250

function pipePath() {
  if (process.env.DAWSHA_PIPE) return process.env.DAWSHA_PIPE
  const user = (process.env.USERNAME || process.env.USER || os.userInfo().username || 'user').replace(/[^A-Za-z0-9_.-]/g, '_')
  if (process.platform === 'win32') return '\\\\.\\pipe\\dawsha-' + user
  return path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), 'dawsha-' + user + '.sock')
}

function send(request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipePath())
    let buffer = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
    socket.on('data', (chunk) => {
      buffer += chunk
    })
    socket.on('end', () => {
      try {
        resolve(JSON.parse(buffer))
      } catch {
        reject(new Error('Dawsha sent an unreadable answer.'))
      }
    })
    socket.on('error', reject)
  })
}

function startApp() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const extra = process.env.DAWSHA_APP_ARGS ? JSON.parse(process.env.DAWSHA_APP_ARGS) : []
  const child = spawn(process.env.DAWSHA_EXE || process.execPath, extra, {
    detached: true,
    stdio: 'ignore',
    env
  })
  child.unref()
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function answer(request) {
  try {
    return await send(request)
  } catch {
    startApp()
  }
  const deadline = Date.now() + START_WAIT_MS
  while (Date.now() < deadline) {
    await wait(RETRY_MS)
    try {
      return await send(request)
    } catch {
      continue
    }
  }
  return { ok: false, exit: 1, out: 'dawsha: Dawsha did not start in time.' }
}

answer({ args: process.argv.slice(2), cwd: process.cwd() }).then((reply) => {
  const stream = reply.ok ? process.stdout : process.stderr
  if (reply.out) stream.write(reply.out + '\n')
  process.exitCode = reply.exit
})
