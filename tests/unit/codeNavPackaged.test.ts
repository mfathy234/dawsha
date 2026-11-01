import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createPackageWithOptions } from '@electron/asar'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const harness = `
import { app, utilityProcess } from 'electron'
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { startTsServer, tsserverModulePath } from './src/main/codeNav/utility'
import { NavigationProcesses } from './src/main/codeNav/processes'
const project = process.argv[2], output = process.argv[3]
for (const event of ['uncaughtException', 'unhandledRejection']) process.on(event, error => { writeFileSync(output, JSON.stringify({ error: String(error && error.stack || error) })); app.exit(1) })
const processes = new NavigationProcesses()
const fork = utilityProcess.fork
utilityProcess.fork = (script, args, options) => {
  const child = fork(script, args, { ...options, stdio: 'pipe' })
  child.stderr.on('data', chunk => appendFileSync(output + '.stderr', chunk))
  return child
}
app.whenReady().then(async () => {
  try {
    const client = startTsServer(project, processes)
    await client.ready
    const file = join(project, 'a.ts'), text = readFileSync(file, 'utf8')
    const definition = await client.query(file, text, { kind: 'definition', line: 3, column: 9 })
    const implementation = await client.query(file, text, { kind: 'implementation', line: 1, column: 12 })
    writeFileSync(output, JSON.stringify({ definition, implementation, module: tsserverModulePath() }))
    processes.stop()
    app.quit()
  } catch (error) {
    writeFileSync(output, JSON.stringify({ error: error.message }))
    processes.stop()
    app.exit(1)
  }
})
`

async function archive(directory: string): Promise<string> {
  const source = join(directory, 'source')
  mkdirSync(join(source, 'node_modules'), { recursive: true })
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'dawsha-navigation-test', version: '1.0.0', main: 'main.cjs' }))
  cpSync(dirname(require.resolve('typescript/package.json')), join(source, 'node_modules/typescript'), { recursive: true })
  await build({ stdin: { contents: harness, resolveDir: process.cwd(), sourcefile: 'packaged-navigation.ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: join(source, 'main.cjs'), external: ['electron', 'typescript/*'], logLevel: 'silent' })
  const config = require('js-yaml').load(readFileSync('electron-builder.yml', 'utf8')) as { asarUnpack: string[] }
  const path = join(directory, 'app.asar')
  const patterns = config.asarUnpack.map(pattern => `**/${pattern}`)
  await createPackageWithOptions(source, path, { unpack: `{${patterns.join(',')}}` })
  return path
}

let lastLog = ''

async function runElectron(app: string, project: string, output: string): Promise<number | null> {
  const { ELECTRON_RUN_AS_NODE: _nodeMode, ...inherited } = process.env
  const env = { ...inherited, ELECTRON_ENABLE_LOGGING: '1' }
  return new Promise((resolve, reject) => {
    const child = spawn(require('electron') as string, [...(process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] : []), app, project, output], { windowsHide: true, shell: false, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    lastLog = ''
    child.stdout?.on('data', chunk => { log += chunk })
    child.stderr?.on('data', chunk => { log += chunk })
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Packaged utility test timed out.
${log.slice(-3000)}`)) }, 20_000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); lastLog = log; resolve(code) })
  })
}

it('runs real tsserver definition and implementation from an ASAR app in an Electron utility process', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dawsha-asar-'))
  try {
    const project = join(directory, 'project')
    mkdirSync(project)
    writeFileSync(join(project, 'a.ts'), 'interface Shape {}\nclass Circle implements Shape {}\nlet s: Shape = new Circle();\n')
    const output = join(directory, 'result.json')
    const code = await runElectron(await archive(directory), project, output)
    expect(existsSync(output), `Electron exited with ${code} before writing a result.
${lastLog.slice(-3000)}`).toBe(true)
    const result = JSON.parse(readFileSync(output, 'utf8'))
    const diagnostics = require('node:fs').existsSync(output + '.stderr') ? readFileSync(output + '.stderr', 'utf8') : ''
    expect(result.error, diagnostics).toBeUndefined()
    expect(code).toBe(0)
    expect(result.module).toContain('app.asar.unpacked')
    expect(result.definition).toEqual([expect.objectContaining({ line: 1, column: 11 })])
    expect(result.implementation).toEqual([expect.objectContaining({ line: 2, column: 7 })])
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
