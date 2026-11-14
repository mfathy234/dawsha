// Offline substitute for the Java process. Dawsha still performs its real IPC,
// process invocation, queueing, SVG handling, and Files rendering in these tests.
const { readFileSync } = require('node:fs')
const { dirname, resolve } = require('node:path')

const [folder, filePath] = process.argv.slice(2)
if (!folder || !filePath || dirname(resolve(folder, filePath)) !== process.cwd()) {
  process.stderr.write('The renderer must run in the diagram folder.\n')
  process.exit(2)
}

const source = readFileSync(0, 'utf8')
if (source.includes('DAWSHA_TEST_ERROR')) {
  process.stderr.write('Error line 3: Expected a participant or a message\n')
  process.exit(1)
}

const included = [...source.matchAll(/^\s*!include\s+([^\r\n]+)$/gm)]
  .map((match) => readFileSync(resolve(process.cwd(), match[1].trim()), 'utf8'))
  .join('\n')

const escapeXml = (value) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
})[character])

process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720" viewBox="0 0 1200 720"><rect width="1200" height="720" fill="white"/><path d="M80 160H1120" stroke="#368e92" stroke-width="2"/><text x="80" y="120" font-size="24">${escapeXml(filePath)}</text><text x="80" y="210" font-size="16">${escapeXml(source + included)}</text></svg>`)
