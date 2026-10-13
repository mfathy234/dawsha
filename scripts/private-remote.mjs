import { spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'build' && mode !== 'package' && mode !== 'e2e') {
  console.error('Usage: node scripts/private-remote.mjs <dev|build|package|e2e>')
  process.exit(2)
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const extraArgs = process.argv.slice(3)
const args = mode === 'dev'
  ? ['run', 'dev']
  : mode === 'build'
    ? ['run', 'build']
    : mode === 'package'
    ? ['run', 'package:private-remote:inner']
      : ['run', 'test:e2e', ...(extraArgs.length ? ['--', ...extraArgs] : [])]
const env = { ...process.env, DAWSHA_PRIVATE_REMOTE_BUILD: '1' }
const run = (commandArgs) => spawnSync(npm, commandArgs, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
})
if (mode === 'dev') {
  const prepare = run(['run', 'build'])
  if (prepare.status !== 0) process.exit(prepare.status ?? 1)
}
const result = run(args)
process.exit(result.status ?? 1)
