// A stand-in for gh that follows a pull request through its life. DAWSHA_GH_SCRIPT runs it with Electron as Node.
// FAKE_GH_DIR holds a `phase` file (failing, running, green, merged) and a log of every call; FAKE_GH_HEAD is the PR's last commit.
const { appendFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = process.env.FAKE_GH_DIR
const args = process.argv.slice(2)
appendFileSync(join(dir, 'calls.log'), `${JSON.stringify(args)}\n`)
const phaseFile = join(dir, 'phase')
const phase = () => (existsSync(phaseFile) ? readFileSync(phaseFile, 'utf8').trim() : 'failing')
const run = (name, status, conclusion, id) => ({ __typename: 'CheckRun', name, workflowName: 'CI', status, conclusion, detailsUrl: `https://github.com/o/r/actions/runs/${id}/job/1` })

function view() {
  const p = phase()
  const rollup = p === 'failing' ? [run('build', 'COMPLETED', 'FAILURE', 4242), run('lint', 'COMPLETED', 'SUCCESS', 4243)]
    : p === 'running' ? [run('build', 'IN_PROGRESS', '', 4242)]
      : [run('build', 'COMPLETED', 'SUCCESS', 4242), run('lint', 'COMPLETED', 'SUCCESS', 4243)]
  return {
    number: 34, title: 'Add watcher', url: 'https://github.com/o/r/pull/34', state: p === 'merged' ? 'MERGED' : 'OPEN', isDraft: false,
    mergeStateStatus: 'CLEAN', reviewDecision: '', headRefOid: process.env.FAKE_GH_HEAD, headRefName: 'feature/x', baseRefName: 'main', statusCheckRollup: rollup
  }
}

const [a, b] = args
if (a === 'pr' && b === 'view') process.stdout.write(JSON.stringify(view()))
else if (a === 'run' && b === 'view') {
  const lines = ['build\tTest\t2026-01-01T10:00:00.0000000Z npm test', ...Array.from({ length: 80 }, (_, i) => `build\tTest\t2026-01-01T10:00:01.0000000Z noise ${i}`), 'build\tTest\t2026-01-01T10:00:02.0000000Z FAIL tests/watch.test.ts', 'build\tTest\t2026-01-01T10:00:02.0000000Z expected 1 to be 2']
  process.stdout.write(`${lines.join('\n')}\n`)
} else if (a === 'pr' && b === 'merge') {
  writeFileSync(phaseFile, 'merged')
  process.stdout.write('merged\n')
} else {
  process.stderr.write(`unexpected call: ${args.join(' ')}\n`)
  process.exit(2)
}
