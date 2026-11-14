import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { IPC } from '../../src/shared/ipc'
import { closeApp, createSandbox, launchApp, openSettings, type Sandbox } from './helpers'

const FIXTURES = resolve(__dirname, '../fixtures/diagrams')
const FAKE_RENDERER = join(FIXTURES, 'fake-renderer.cjs')
const SIMPLE = '@startuml\nAlice -> Bob: Local diagram\n@enduml\n'
const MERMAID = 'flowchart LR\n  Browser[Browser] --> API[API]\n  API --> Database[(Database)]\n'
const editor = (page: Page): Locator => page.locator('.files-editor:not([hidden]) .cm-content')
const row = (page: Page, path: string): Locator => page.locator(`.files-row[data-path="${path}"]`)

function seedDiagrams(sandbox: Sandbox): void {
  for (const name of ['TokenFlow.puml', 'HealthProbing.puml', 'PublishAfterCommit.puml', 'HrOverview.puml']) {
    copyFileSync(join(FIXTURES, name), join(sandbox.projectFolder, name))
  }
  writeFileSync(join(sandbox.projectFolder, 'flow.puml'), SIMPLE)
  writeFileSync(join(sandbox.projectFolder, 'broken.puml'), '@startuml\nAlice -> Bob: Before the error\nDAWSHA_TEST_ERROR\n@enduml\n')
  writeFileSync(join(sandbox.projectFolder, 'flow.mmd'), MERMAID)
  writeFileSync(join(sandbox.projectFolder, 'broken.mmd'), 'flowchart LR\n  A[Unclosed\n')
  writeFileSync(join(sandbox.projectFolder, 'flow.md'), `# Architecture\n\n\`\`\`mermaid\n${MERMAID}\`\`\`\n`)
  writeFileSync(join(sandbox.projectFolder, 'azure.md'), `# Architecture wiki\n\n::: mermaid\n${MERMAID}:::\n`)
  writeFileSync(join(sandbox.projectFolder, 'plantuml.md'), `# Local sequence\n\n\`\`\`plantuml\n${SIMPLE}\`\`\`\n`)
  writeFileSync(join(sandbox.projectFolder, 'broken.md'), '# Broken local sequence\n\n```plantuml\n@startuml\nAlice -> Bob: Before the error\nDAWSHA_TEST_ERROR\n@enduml\n```\n')
  writeFileSync(join(sandbox.projectFolder, 'unsafe.mmd'), 'flowchart LR\n  A@{ img: "https://example.invalid/internal-diagram.svg" }\n')
  writeFileSync(join(sandbox.projectFolder, 'unsafe-quoted.mmd'), 'flowchart LR\n  A@{ "img": "https://example.invalid/internal-diagram.svg" }\n')
  writeFileSync(join(sandbox.projectFolder, 'unsafe-icon.mmd'), 'flowchart LR\n  A@{ "icon": "https://example.invalid/internal-diagram.svg" }\n')
}

async function openFiles(page: Page, path: string): Promise<void> {
  await page.locator('#files-button').click()
  await expect(page.locator('#files-view')).toBeVisible()
  await row(page, path).click()
}

async function loadedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
}

async function imageSvg(image: Locator): Promise<string> {
  const source = await image.getAttribute('src') ?? ''
  const comma = source.indexOf(',')
  if (!source.startsWith('data:image/svg+xml') || comma < 0) return ''
  const content = source.slice(comma + 1)
  return source.slice(0, comma).includes(';base64') ? Buffer.from(content, 'base64').toString('utf8') : decodeURIComponent(content)
}

test('PlantUML opens locally, zooms with buttons and shortcuts, pans, and switches to Source', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'flow.puml')
    const image = page.locator('#diagram-image')
    const zoom = page.locator('.diagram-zoom-value')
    const stage = page.locator('.diagram-stage')
    await loadedImage(image)
    await expect.poll(() => imageSvg(image)).toContain('Local diagram')
    await expect(page.locator('#files-view-preview')).toHaveText('Diagram')
    await expect(page.locator('#files-view-preview')).toHaveAttribute('aria-pressed', 'true')

    const initialZoom = await zoom.textContent()
    await page.locator('#diagram-zoom-in').click()
    await expect(zoom).not.toHaveText(initialZoom!)
    await page.locator('#diagram-fit').click()
    await expect(zoom).toHaveText(initialZoom!)
    await page.locator('#diagram-zoom-out').focus()
    await page.keyboard.press('Enter')
    await expect(zoom).not.toHaveText(initialZoom!)
    await stage.focus()
    await page.keyboard.press('Control+0')
    await expect(zoom).toHaveText(initialZoom!)

    await stage.hover()
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -500)
    await page.keyboard.up('Control')
    await expect(zoom).not.toHaveText(initialZoom!)
    for (let step = 0; step < 4; step += 1) await page.locator('#diagram-zoom-in').click()
    const before = await image.boundingBox()
    const bounds = await stage.boundingBox()
    expect(before).not.toBeNull()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + bounds!.width / 2 - 80, bounds!.y + bounds!.height / 2 - 30, { steps: 5 })
    await page.mouse.up()
    await expect.poll(async () => (await image.boundingBox())?.x).not.toBe(before!.x)

    await page.locator('#files-view-source').click()
    await expect(editor(page)).toContainText('Alice -> Bob: Local diagram')
    await expect(page.locator('#files-preview')).toBeHidden()
    await page.locator('#files-view-preview').click()
    await loadedImage(image)
  } finally {
    await closeApp(app)
  }
})

test('all PlantUML extensions and Architecture sequence and component samples preview offline', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  for (const extension of ['plantuml', 'pu', 'iuml']) writeFileSync(join(sandbox.projectFolder, `flow.${extension}`), SIMPLE.replace('Local diagram', `Local diagram ${extension}`))
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'TokenFlow.puml')
    for (const name of ['TokenFlow.puml', 'HealthProbing.puml', 'PublishAfterCommit.puml', 'HrOverview.puml', 'flow.plantuml', 'flow.pu', 'flow.iuml']) {
      await row(page, name).click()
      await loadedImage(page.locator('#diagram-image'))
      await expect.poll(() => imageSvg(page.locator('#diagram-image'))).toContain(name)
      await expect(page.locator('#files-view-preview')).toHaveAttribute('aria-pressed', 'true')
    }
  } finally {
    await closeApp(app)
  }
})

test('a PlantUML render error names its line and jumps to that line in Source', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'broken.puml')
    await expect(page.locator('.diagram-error')).toContainText('Expected a participant or a message')
    await expect(page.locator('.diagram-error-line')).toContainText('3')
    await page.locator('.diagram-error-line').click()
    await expect(editor(page)).toBeVisible()
    await expect(page.locator('#files-status-pos')).toContainText('Ln 3,')
    await expect(editor(page)).toBeFocused()
  } finally {
    await closeApp(app)
  }
})

test('saved source edits and external file changes re-render the diagram', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const path = join(sandbox.projectFolder, 'flow.puml')
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'flow.puml')
    const image = page.locator('#diagram-image')
    await loadedImage(image)
    await expect.poll(() => imageSvg(image)).toContain('Local diagram')
    const original = await image.getAttribute('src')
    writeFileSync(path, SIMPLE.replace('Local diagram', 'Changed on disk'))
    await expect(image).not.toHaveAttribute('src', original!, { timeout: 15_000 })
    await loadedImage(image)
    await expect.poll(() => imageSvg(image)).toContain('Changed on disk')

    await page.locator('#files-view-source').click()
    await expect(editor(page)).toContainText('Changed on disk')
    await editor(page).click()
    await page.keyboard.press('e')
    await expect(page.locator('#files-status')).toContainText('Editing')
    await page.keyboard.press('Control+a')
    await page.keyboard.insertText(SIMPLE.replace('Local diagram', 'Saved from Source'))
    await page.keyboard.press('Control+s')
    await expect.poll(() => readFileSync(path, 'utf8')).toContain('Saved from Source')
    await page.locator('#files-view-preview').click()
    await loadedImage(image)
    await expect.poll(() => imageSvg(image)).toContain('Saved from Source')
    const saved = await image.getAttribute('src')
    expect(saved).not.toBe(original)
    await expect(page.locator('.files-tab.active')).not.toHaveClass(/dirty/)
  } finally {
    await closeApp(app)
  }
})

test('Markdown Mermaid, standalone Mermaid, and Markdown PlantUML render without network requests', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  const diagramRequests: string[] = []
  await page.route(/^https?:\/\//, async (route) => {
    diagramRequests.push(route.request().url())
    await route.abort()
  })
  try {
    await openFiles(page, 'flow.md')
    await expect(page.locator('#files-md h1')).toHaveText('Architecture')
    await loadedImage(page.locator('#files-md .diagram-image'))
    await expect(page.locator('#files-md pre:visible')).toHaveCount(0)
    await row(page, 'flow.mmd').click()
    await loadedImage(page.locator('#diagram-image'))
    await row(page, 'plantuml.md').click()
    await expect(page.locator('#files-md h1')).toHaveText('Local sequence')
    await loadedImage(page.locator('#files-md .diagram-image'))
    await row(page, 'azure.md').click()
    await expect(page.locator('#files-md h1')).toHaveText('Architecture wiki')
    await loadedImage(page.locator('#files-md .diagram-image'))
    expect(diagramRequests).toEqual([])
  } finally {
    await closeApp(app)
  }
})

test('invalid Mermaid reports an inline error and a valid file still renders afterwards', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'broken.mmd')
    await expect(page.locator('.diagram-error')).toBeVisible()
    await expect(page.locator('.diagram-error')).toContainText(/parse|syntax|expect/i)
    await row(page, 'flow.mmd').click()
    await loadedImage(page.locator('#diagram-image'))
  } finally {
    await closeApp(app)
  }
})

test('the file context menu and command palette copy the current diagram as SVG', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'flow.puml')
    await loadedImage(page.locator('#diagram-image'))
    // Some local Windows desktops deny clipboard reads. Capture the real IPC
    // output at the OS boundary as well, while still writing the system clipboard.
    await app.evaluate(({ clipboard }) => {
      const captured = globalThis as unknown as { diagramClipboard?: string }
      const write = clipboard.writeText.bind(clipboard)
      clipboard.writeText = async (text) => { captured.diagramClipboard = text; await write(text) }
      clipboard.writeText('before diagram')
    })
    await row(page, 'flow.puml').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Save diagram as…', exact: true })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Copy diagram as SVG', exact: true }).click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { diagramClipboard?: string }).diagramClipboard)).toContain('<svg')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { diagramClipboard?: string }).diagramClipboard)).toContain('Local diagram')
    if (process.env.CI) await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toContain('<svg')

    await app.evaluate(({ clipboard }) => clipboard.writeText('before palette'))
    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Copy diagram as SVG')
    await expect(page.locator('.palette-row')).toContainText('Copy diagram as SVG')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { diagramClipboard?: string }).diagramClipboard)).toContain('<svg')
  } finally {
    await closeApp(app)
  }
})

test('Save diagram as exports SVG and PNG through the native save dialog', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const svgPath = join(sandbox.root, 'exported.svg')
  const pngPath = join(sandbox.root, 'exported.png')
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await app.evaluate(({ dialog }, paths) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.shift()! })
    }, [svgPath, pngPath])
    await openFiles(page, 'flow.puml')
    await loadedImage(page.locator('#diagram-image'))
    await row(page, 'flow.puml').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Save diagram as…', exact: true }).click()
    await expect.poll(() => existsSync(svgPath)).toBe(true)
    expect(readFileSync(svgPath, 'utf8')).toContain('<svg')
    expect(readFileSync(svgPath, 'utf8')).toContain('Local diagram')

    await page.keyboard.press('Control+k')
    await page.locator('#palette-input').fill('Save diagram as')
    await expect(page.locator('.palette-row')).toContainText('Save diagram as…')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(pngPath)).toBe(true)
    expect([...readFileSync(pngPath).subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  } finally {
    await closeApp(app)
  }
})

test('a custom PlantUML jar path survives a quick quit and restart', async () => {
  const sandbox = createSandbox()
  const jarPath = join(sandbox.root, 'existing plantuml.jar')
  writeFileSync(jarPath, 'offline settings fixture')
  const first = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openSettings(first.page, 'general')
    await first.page.getByRole('textbox', { name: 'PlantUML jar path', exact: true }).fill(jarPath)
    await first.page.keyboard.press('Tab')
  } finally {
    await closeApp(first.app)
  }
  await expect.poll(() => (JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8')) as { plantumlJarPath?: string })?.plantumlJarPath).toBe(jarPath)
  const second = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openSettings(second.page, 'general')
    await expect(second.page.getByRole('textbox', { name: 'PlantUML jar path', exact: true })).toHaveValue(jarPath)
  } finally {
    await closeApp(second.app)
  }
})

test('without Java, PlantUML keeps the source readable and offers the OpenJDK page', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ java: false, jar: false, downloadMegabytes: 12, version: 'offline' }))
    }, IPC.diagramStatus)
    await openFiles(page, 'flow.puml')
    await expect(page.locator('.diagram-setup')).toContainText('Install Java to see this diagram')
    await expect(page.locator('.diagram-source')).toContainText('Alice -> Bob: Local diagram')
    await expect(page.getByRole('link', { name: 'Get Microsoft OpenJDK', exact: true })).toBeVisible()
    await expect(page.locator('#diagram-download')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a missing PlantUML jar requires Download before drawing the local diagram', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await app.evaluate(({ ipcMain }, channels) => {
      let downloaded = false
      ipcMain.removeHandler(channels.status)
      ipcMain.handle(channels.status, () => ({ java: true, jar: downloaded, downloadMegabytes: 12, version: 'offline' }))
      ipcMain.removeHandler(channels.download)
      ipcMain.handle(channels.download, () => { downloaded = true; return { ok: true } })
    }, { status: IPC.diagramStatus, download: IPC.diagramDownload })
    await openFiles(page, 'flow.puml')
    await expect(page.locator('.diagram-setup')).toContainText('Dawsha downloads PlantUML (MIT, about 12 MB) once to draw diagrams on this computer.')
    await expect(page.locator('.diagram-source')).toContainText('Alice -> Bob: Local diagram')
    await expect(page.locator('#diagram-image')).toHaveCount(0)
    await page.locator('#diagram-download').click()
    await loadedImage(page.locator('#diagram-image'))
    await expect(page.locator('.diagram-setup')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('a Markdown PlantUML error jumps to the corresponding document line', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'broken.md')
    await expect(page.locator('.diagram-error-line')).toHaveText('Line 6')
    await page.locator('.diagram-error-line').click()
    await expect(editor(page)).toBeFocused()
    await expect(page.locator('#files-status-pos')).toContainText('Ln 6,')
  } finally {
    await closeApp(app)
  }
})

test('Mermaid image syntax cannot request a remote image', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  const requests: string[] = []
  await page.route('https://example.invalid/**', async (route) => { requests.push(route.request().url()); await route.abort() })
  try {
    await openFiles(page, 'unsafe.mmd')
    for (const [name, syntax] of [['unsafe.mmd', 'img:'], ['unsafe-quoted.mmd', '"img":'], ['unsafe-icon.mmd', '"icon":']]) {
      await row(page, name).click()
      await expect(page.locator('.diagram-source')).toContainText(syntax)
      await expect(page.locator('.diagram-error')).toContainText(/local|external|image|icon/i)
      await expect(page.locator('#diagram-image')).toHaveCount(0)
    }
    expect(requests).toEqual([])
  } finally {
    await closeApp(app)
  }
})

test('every PlantUML block in a Markdown document renders its own diagram', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const document = ['First block', 'Second block', 'Third block'].map((message) => `\`\`\`plantuml\n@startuml\nAlice -> Bob: ${message}\n@enduml\n\`\`\``).join('\n\n')
  writeFileSync(join(sandbox.projectFolder, 'multiple.md'), `# Multiple diagrams\n\n${document}\n`)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'multiple.md')
    const images = page.locator('#files-md .diagram-image')
    await expect(images).toHaveCount(3)
    for (const [index, message] of ['First block', 'Second block', 'Third block'].entries()) {
      await loadedImage(images.nth(index))
      await expect.poll(() => imageSvg(images.nth(index))).toContain(message)
    }
    await expect(page.locator('#files-md .diagram-error')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})

test('editing a relative PlantUML include refreshes the open diagram', async () => {
  const sandbox = createSandbox()
  const includedPath = join(sandbox.projectFolder, 'common.iuml')
  writeFileSync(join(sandbox.projectFolder, 'include.puml'), '@startuml\n!include common.iuml\n@enduml\n')
  writeFileSync(includedPath, 'Alice -> Bob: First included message\n')
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await openFiles(page, 'include.puml')
    const image = page.locator('#diagram-image')
    await loadedImage(image)
    await expect.poll(() => imageSvg(image)).toContain('First included message')
    writeFileSync(includedPath, 'Alice -> Bob: Updated included message\n')
    await expect.poll(() => imageSvg(image), { timeout: 15_000 }).toContain('Updated included message')
    await expect(page.locator('.files-tab.active')).toContainText('include.puml')
  } finally {
    await closeApp(app)
  }
})

test('an invalid custom PlantUML jar path explains the setting to fix', async () => {
  const sandbox = createSandbox()
  seedDiagrams(sandbox)
  const { app, page } = await launchApp(sandbox, { DAWSHA_PLANTUML_FAKE_RENDERER: FAKE_RENDERER })
  try {
    await app.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, () => ({ java: true, jar: false, jarOverride: true, downloadMegabytes: 12, version: 'offline' }))
    }, IPC.diagramStatus)
    await openFiles(page, 'flow.puml')
    await expect(page.locator('.diagram-setup')).toContainText('Check its path in Settings.')
    await expect(page.locator('.diagram-source')).toContainText('Alice -> Bob: Local diagram')
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
