import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { bufferText, closeApp, createSandbox, launchApp } from './helpers'

const PROMPT = [...Array.from({ length: 40 }, (_, index) => `Output ${index}`), '● Bash(npm test --token=private-value)', 'Do you want to proceed?', '1. Yes', '3. No, and tell Claude what to do differently', ''].join('\r\n')
type Note = { paneId: string; body: string; actions?: { content: string; arguments: string }[] }

for (const choice of ['Allow', 'Deny', 'Changed', 'Reappeared'] as const) {
  test(`Windows permission notification: ${choice} uses the host permission path`, async () => {
    test.skip(process.platform !== 'win32', 'Windows protocol toast buttons')
    const sandbox = createSandbox()
    const fixture = join(sandbox.root, 'permission-agent.cjs')
    writeFileSync(fixture, `
const prompt = ${JSON.stringify(PROMPT)};
process.stdin.setRawMode(true);
process.stdout.write('Ready>');
process.stdin.on('data', data => {
  const text = data.toString();
  if (text === 'p') process.stdout.write(prompt);
  else if (text === 'c') process.stdout.write('\\x1b[2J\\x1b[H' + prompt.replace('npm test', 'npm publish'));
  else if (text === 'd') process.stdout.write('\\x1b[2J\\x1b[HCompleted>');
  else if (text === '\\r' || text === '\\x1b') process.stdout.write('\\x1b[2J\\x1b[HAnswered');
});
`)
    const { app, page } = await launchApp(sandbox, { DAWSHA_CLAUDE_COMMAND: process.execPath, DAWSHA_CLAUDE_ARGS: JSON.stringify([fixture]) }, ['--new-session=smoke'])
    const notes = (): Note[] => existsSync(sandbox.notifyLog) ? readFileSync(sandbox.notifyLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
    try {
      await expect(page.locator('.pane')).toHaveCount(1)
      const first = page.locator('.pane').first()
      const paneId = await first.getAttribute('data-pane-id')
      const id = (await first.locator('.term-host').first().getAttribute('data-term-id'))!
      await first.getByRole('button', { name: 'Maximize pane', exact: true }).click()
      await page.evaluate(() => {
        document.hasFocus = () => false
        window.dispatchEvent(new Event('blur'))
      })
      await expect.poll(() => bufferText(page, id)).toContain('Ready>')
      await page.evaluate(id => window.gridApi.write(id, 'p'), id)
      await expect.poll(() => notes().some(note => note.paneId === paneId && note.actions?.length === 2), { timeout: 15_000 }).toBe(true)
      const note = notes().findLast(note => note.paneId === paneId && note.actions?.length === 2)!
      expect(note.actions!.map(action => action.content)).toEqual(['Allow', 'Deny'])
      expect(note.body).not.toContain('private-value')
      expect(note.body.length).toBeLessThanOrEqual(120)
      expect(JSON.stringify(note.actions)).not.toContain('npm test')
      expect(readFileSync(sandbox.notifyLog, 'utf8')).not.toContain('private-value')
      await app.evaluate(({ ipcMain }) => {
        const scope = globalThis as unknown as { notificationWrites: { id: string; text: string }[] }
        scope.notificationWrites = []
        ipcMain.on('pty:write', (_event, id, text) => { if (text && text !== '\x1b[I' && text !== '\x1b[O') scope.notificationWrites.push({ id, text }) })
      })
      if (choice === 'Changed') {
        await page.evaluate(id => window.gridApi.write(id, 'c'), id)
        await expect.poll(() => bufferText(page, id)).toContain('npm publish')
        await app.evaluate(() => { (globalThis as unknown as { notificationWrites: unknown[] }).notificationWrites = [] })
      } else if (choice === 'Reappeared') {
        await page.evaluate(id => window.gridApi.write(id, 'd'), id)
        await expect.poll(async () => (await bufferText(page, id)).trim()).toMatch(/Completed>$/)
        await page.evaluate(id => window.gridApi.write(id, 'p'), id)
        await expect.poll(() => bufferText(page, id)).toContain('1. Yes')
        await app.evaluate(() => { (globalThis as unknown as { notificationWrites: unknown[] }).notificationWrites = [] })
      }
      const action = note.actions!.find(action => action.content === (choice === 'Deny' ? 'Deny' : 'Allow'))!.arguments
      await app.evaluate(({ app }, argument) => { app.emit('second-instance', {}, ['Dawsha.exe', argument], process.cwd()) }, action)
      await expect(first).toHaveClass(/focused/)
      const writes = () => app.evaluate(() => (globalThis as unknown as { notificationWrites: { id: string; text: string }[] }).notificationWrites)
      if (choice === 'Changed' || choice === 'Reappeared') {
        await expect(page.locator('.toasts')).toContainText('That request changed')
        expect(await writes()).toEqual([])
      } else {
        await expect.poll(writes).toEqual([{ id, text: choice === 'Allow' ? '\r' : '\x1b' }])
        // Replaying the same external link opens the pane without writing again.
        await app.evaluate(({ app }, argument) => { app.emit('second-instance', {}, ['Dawsha.exe', argument], process.cwd()) }, action)
        await expect.poll(writes).toHaveLength(1)
      }
    } finally { await closeApp(app) }
  })
}

test('a notification left over from an earlier app run only opens Dawsha', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, {}, ['dawsha-action:allow?pane=closed-pane&request=' + 'a'.repeat(32)])
  try {
    await expect(page.locator('.toasts')).toContainText('That session is no longer open.')
    await expect(page.locator('.pane')).toHaveCount(0)
  } finally { await closeApp(app) }
})
