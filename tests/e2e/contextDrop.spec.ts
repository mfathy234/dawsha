import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeApp, createSandbox, launchApp, lastInput, QUIT_BUDGET_MS, type Sandbox } from './helpers'

const SESSION = 'sess-ctx-1'

function writeSession(sandbox: Sandbox): void {
  const now = Date.now()
  writeFileSync(
    join(sandbox.sessionsDir, `${SESSION}.json`),
    JSON.stringify({
      pid: process.pid,
      sessionId: SESSION,
      cwd: sandbox.projectFolder,
      name: 'Context session',
      nameSource: 'user',
      status: 'idle',
      startedAt: now + 1000,
      updatedAt: now + 1000
    }),
    'utf8'
  )
}

function writeContext(sandbox: Sandbox, percent: number): void {
  mkdirSync(sandbox.opsDir, { recursive: true })
  const snapshot = {
    v: 1,
    sessionId: SESSION,
    cwd: sandbox.projectFolder,
    updatedAt: Date.now(),
    ended: false,
    model: 'claude-opus-5-5',
    agents: [],
    context: { percent, tokens: percent * 1000, window: 100_000, stage: 'fine' }
  }
  writeFileSync(join(sandbox.opsDir, `${SESSION}.json`), JSON.stringify(snapshot), 'utf8')
}

async function dropOn(page: Page, selector: string, names: string[], uris: string[]): Promise<void> {
  await page.evaluate(
    ([target, fileNames, uriList]) => {
      const transfer = new DataTransfer()
      for (const name of fileNames) transfer.items.add(new File(['x'], name))
      transfer.setData('text/uri-list', uriList.join('\r\n'))
      document.querySelector(target)!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
    },
    [selector, names, uris] as const
  )
}

test('context warning: amber at 85, hint with Compact and Dismiss at 92, back at 96', async () => {
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox)
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    writeSession(sandbox)
    const gauge = page.locator('.pane-info .info-gauge')
    const hint = page.locator('.pane-hint')

    writeContext(sandbox, 41)
    await expect(gauge).toHaveText('41%', { timeout: 15_000 })
    await expect(gauge.locator('.charge')).toHaveAttribute('data-filled', '4')
    await expect(gauge).not.toHaveClass(/ctx-amber|ctx-red/)
    await expect(hint).toBeHidden()

    writeContext(sandbox, 85)
    await expect(gauge).toHaveClass(/ctx-amber/, { timeout: 15_000 })
    await expect(hint).toBeHidden()

    writeContext(sandbox, 92)
    await expect(gauge).toHaveClass(/ctx-red/, { timeout: 15_000 })
    await expect(hint).toBeVisible()
    await expect(hint).toContainText('Context is 92% full — /compact or start a fresh session')

    await hint.getByRole('button', { name: 'Compact' }).click()
    await expect.poll(() => lastInput(page, id)).toBe('/compact')

    await hint.getByRole('button', { name: 'Dismiss' }).click()
    await expect(hint).toBeHidden()
    writeContext(sandbox, 93)
    await expect(gauge).toContainText('93%', { timeout: 15_000 })
    await expect(hint).toBeHidden()

    writeContext(sandbox, 96)
    await expect(hint).toBeVisible({ timeout: 15_000 })
    await expect(hint).toContainText('96% full')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('dropping files types their paths into the terminal under the drop', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'New terminal in SMOKE' }).click()
    await page.getByRole('menuitem', { name: 'Shell' }).click()
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    const host = `.term-host[data-term-id="${id}"]`

    await page.evaluate((selector) => {
      const text = new DataTransfer()
      text.setData('text/plain', 'hello')
      document.querySelector(selector)!.dispatchEvent(new DragEvent('dragover', { dataTransfer: text, bubbles: true, cancelable: true }))
    }, host)
    await expect(page.locator('.pane.file-drop')).toHaveCount(0)

    await page.evaluate((selector) => {
      const files = new DataTransfer()
      files.items.add(new File(['x'], 'a.txt'))
      document.querySelector(selector)!.dispatchEvent(new DragEvent('dragover', { dataTransfer: files, bubbles: true, cancelable: true }))
    }, host)
    await expect(page.locator('.pane.file-drop')).toHaveCount(1)

    await dropOn(page, host, ['one.txt', 'two docs.txt'], ['file:///C:/acme-web/one.txt', 'file:///C:/acme%20web/two%20docs.txt'])
    await expect(page.locator('.pane.file-drop')).toHaveCount(0)
    await expect.poll(() => lastInput(page, id)).toBe('C:\\acme-web\\one.txt "C:\\acme web\\two docs.txt" ')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})

test('dropping files on a Gemini pane types @ references', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
    await page.getByRole('button', { name: 'New terminal in SMOKE' }).click()
    await page.getByRole('menuitem', { name: 'Gemini session' }).click()
    await expect(page.locator('.tabs .tab')).toHaveCount(2, { timeout: 20_000 })
    await expect(page.locator('.tabs .tab.active')).toContainText(/gemini/i, { timeout: 20_000 })
    const id = (await page.locator('.term-host.active').getAttribute('data-term-id'))!
    await dropOn(page, `.term-host[data-term-id="${id}"]`, ['b.txt'], ['file:///C:/acme-web/docs'])
    await expect.poll(() => lastInput(page, id)).toBe('@C:\\acme-web\\docs ')
  } finally {
    expect(await closeApp(app)).toBeLessThan(QUIT_BUDGET_MS)
  }
})
