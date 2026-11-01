// A stand-in for the GitHub CLI. DAWSHA_GH_SCRIPT runs it with Electron as Node; FAKE_GH_DIR holds its state and a log of every call.
const { appendFileSync, existsSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const dir = process.env.FAKE_GH_DIR
const args = process.argv.slice(2)
appendFileSync(join(dir, 'calls.log'), `${JSON.stringify(args)}\n`)
const created = join(dir, 'created')
const merged = join(dir, 'merged')
const SHA = 'b'.repeat(40)

const pr = () => ({
  number: 7, title: 'Add config tab', url: 'https://github.com/o/r/pull/7', state: existsSync(merged) ? 'MERGED' : 'OPEN', isDraft: false,
  baseRefName: 'main', headRefName: 'feature/config', headRefOid: SHA, mergeable: 'MERGEABLE', reviewDecision: 'CHANGES_REQUESTED',
  reviews: [{ author: { login: 'dee' }, state: 'CHANGES_REQUESTED', body: 'Please add tests' }]
})

const [a, b] = args
if (a === 'auth') process.exit(0)
if (a === 'pr' && b === 'view') {
  if (!existsSync(created)) {
    process.stderr.write('no pull requests found for branch "feature/config"\n')
    process.exit(1)
  }
  process.stdout.write(JSON.stringify(pr()))
} else if (a === 'pr' && b === 'create') {
  writeFileSync(created, '1')
  process.stdout.write('https://github.com/o/r/pull/7\n')
} else if (a === 'pr' && b === 'checks') {
  process.stdout.write(JSON.stringify([{ name: 'build', workflow: 'CI', bucket: 'fail', link: 'https://github.com/o/r/actions/runs/1' }, { name: 'lint', workflow: 'CI', bucket: 'pass', link: '' }]))
  process.exit(1)
} else if (a === 'api') {
  process.stdout.write(JSON.stringify([{ id: 11, user: { login: 'ann' }, body: 'Rename this setting', path: 'app/settings.txt', line: 1, html_url: 'https://github.com/o/r/pull/7#r11' }]))
} else if (a === 'pr' && b === 'merge') {
  writeFileSync(merged, '1')
  process.stdout.write('merged\n')
} else {
  process.stderr.write(`unexpected call: ${args.join(' ')}\n`)
  process.exit(2)
}
