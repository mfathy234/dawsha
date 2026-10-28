import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

function git(folder: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.invalid', ...args], { cwd: folder, stdio: 'pipe' })
}

test('Files detects commands without starting them, then a run stays with its checkout when browsing another', async () => {
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'run-fixture', private: true, scripts: { dev: 'node runner.cjs' } }))
  writeFileSync(join(root, 'runner.cjs'), "require('node:fs').appendFileSync('started.txt', process.cwd()+'\\n'); console.log('RUN_STARTED '+process.cwd()); setInterval(()=>{},1000)\n")
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'fixture')
  const other = join(sandbox.root, 'review-checkout')
  git(root, 'worktree', 'add', '-q', '-b', 'feat/review', other)
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await expect(page.locator('#files-view')).toBeVisible()
    await expect(page.locator('#files-run-toggle')).toBeVisible()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-source')).toContainText('package.json')
    expect(existsSync(join(root, 'started.txt'))).toBe(false)
    const commandId = await page.locator('#run-command').evaluate((node) => [...(node as HTMLSelectElement).options].find(option => /dev/i.test(option.textContent ?? ''))?.value)
    expect(commandId).toBeTruthy()
    await page.locator('#run-command').selectOption(commandId!)
    await page.locator('#run-start').click()
    await expect(page.locator('#run-output')).toContainText('RUN_STARTED', { timeout: 30_000 })
    await expect.poll(() => existsSync(join(root, 'started.txt'))).toBe(true)
    expect(readFileSync(join(root, 'started.txt'), 'utf8').trim().toLowerCase()).toBe(root.toLowerCase())
    await page.locator('#files-location').click()
    await page.getByRole('menuitem', { name: /feat\/review/ }).click()
    await expect(page.locator('#files-status')).toContainText('feat/review')
    await expect(page.locator('#run-output')).toContainText('RUN_STARTED')
    expect(existsSync(join(other, 'started.txt'))).toBe(false)
    await page.locator('#run-stop').click()
    await expect.poll(async () => page.evaluate(async () => (await window.gridApi.runs.list())[0]?.status)).toBe('stopped')
    await expect(page.locator('#run-output')).toContainText('RUN_STARTED')
    await page.screenshot({ path: 'test-results/screens/173-files-run.png' })
  } finally {
    await closeApp(app)
  }
})

for (const [mode, theme] of [['dark', undefined], ['light', 'dawsha-daylight']] as const) {
  test(`solution discovery shows startup projects and profiles without running them (${mode})`, async () => {
    const sandbox = createSandbox()
    const root = sandbox.projectFolder
    const apiFolder = join(root, 'src', 'Api')
    mkdirSync(join(apiFolder, 'Properties'), { recursive: true })
    mkdirSync(join(root, 'src', 'Library'), { recursive: true })
    writeFileSync(join(root, 'Example.sln'), 'Microsoft Visual Studio Solution File, Format Version 12.00\n')
    writeFileSync(join(apiFolder, 'Api.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
    writeFileSync(join(root, 'src', 'Library', 'Library.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>')
    writeFileSync(join(apiFolder, 'Program.cs'), 'var builder = WebApplication.CreateBuilder(args);\nvar app = builder.Build();\napp.Run();\n')
    writeFileSync(join(apiFolder, 'Properties', 'launchSettings.json'), '{ // local development\n"profiles": { "Development": { "commandName": "Project", "environmentVariables": { "LOCAL_TEST_PASSWORD": "not-exposed-by-preview" }, }, }, }')
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'startup fixture')
    if (theme) {
      const file = join(sandbox.userData, 'settings.json')
      const settings = JSON.parse(readFileSync(file, 'utf8'))
      writeFileSync(file, JSON.stringify({ ...settings, theme: { id: theme } }))
    }
    const { app, page } = await launchApp(sandbox)
    try {
      await page.setViewportSize({ width: 1024, height: 728 })
      await page.locator('#files-button').click()
      await page.locator('#files-run-toggle').click()
      await expect(page.locator('#run-command option')).toHaveCount(4)
      await page.locator('#run-command').selectOption({ label: 'Run src/Api/Api.csproj · Development' })
      await expect(page.locator('#run-display')).toContainText('dotnet run --project src/Api/Api.csproj --launch-profile Development')
      await expect(page.locator('#run-command')).not.toContainText('Library.csproj')
      await expect(page.locator('#files-run-panel')).not.toContainText('not-exposed-by-preview')
      await expect.poll(async () => page.evaluate(async () => (await window.gridApi.runs.list()).length)).toBe(0)
      await page.locator('.files-row[data-path="src"]').click()
      await page.locator('.files-row[data-path="src/Api"]').click()
      await page.locator('.files-row[data-path="src/Api/Program.cs"]').click()
      await expect(page.locator('.files-editor:not([hidden])')).toContainText('WebApplication')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `test-results/screens/173-run-dotnet-${mode}.png` })
    } finally {
      await closeApp(app)
    }
  })
}

test('a detected .NET startup command applies its launch profile and retains successful output', async () => {
  let sdks = ''
  try { sdks = execFileSync('dotnet', ['--list-sdks'], { encoding: 'utf8', windowsHide: true }) } catch { /* Optional SDK integration; discovery tests do not require .NET. */ }
  test.skip(!/^8\./m.test(sdks), '.NET 8 SDK is needed for this runtime integration check')
  const sandbox = createSandbox()
  const root = sandbox.projectFolder
  mkdirSync(join(root, 'Properties'))
  writeFileSync(join(root, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><RestoreIgnoreFailedSources>true</RestoreIgnoreFailedSources></PropertyGroup></Project>')
  writeFileSync(join(root, 'Program.cs'), 'System.Console.WriteLine("NET_RUN_OK:" + System.Environment.GetEnvironmentVariable("DAWSHA_FIXTURE_PROFILE"));\n')
  writeFileSync(join(root, 'Properties', 'launchSettings.json'), JSON.stringify({ profiles: { Local: { commandName: 'Project', environmentVariables: { DAWSHA_FIXTURE_PROFILE: 'profile-applied' } } } }))
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-command option')).toHaveCount(2)
    await page.locator('#run-command').selectOption({ label: 'Run App.csproj · Local' })
    await page.locator('#run-start').click()
    await expect(page.locator('#run-output')).toContainText('NET_RUN_OK:profile-applied', { timeout: 60_000 })
    await expect.poll(async () => page.evaluate(async () => (await window.gridApi.runs.list())[0]?.exitCode)).toBe(0)
    await expect(page.locator('#run-status')).toContainText('exited')
  } finally {
    await closeApp(app)
  }
})

test('an undetected project accepts a saved custom command and keeps failed output for correction', async () => {
  const sandbox = createSandbox()
  writeFileSync(join(sandbox.projectFolder, 'failure.cjs'), "console.error('FIXTURE_FAILURE: edit this command'); process.exitCode=7\n")
  const { app, page } = await launchApp(sandbox)
  try {
    await page.locator('#files-button').click()
    await page.locator('#files-run-toggle').click()
    await expect(page.locator('#run-message')).toContainText(/No run commands|No commands/)
    await page.locator('#run-add').click()
    const dialog = page.locator('.run-editor')
    await dialog.getByLabel('Command name', { exact: true }).fill('Fixture failure')
    await dialog.getByLabel('Command', { exact: true }).fill('node failure.cjs')
    await dialog.getByLabel('Working directory', { exact: true }).fill('.')
    await dialog.getByRole('button', { name: /^Save/ }).click()
    await page.locator('#run-start').click()
    await expect(page.locator('#run-output')).toContainText('FIXTURE_FAILURE', { timeout: 20_000 })
    await expect.poll(async () => page.evaluate(async () => (await window.gridApi.runs.list())[0]?.exitCode)).toBe(7)
    await page.locator('#run-edit').click()
    await expect(page.locator('.run-editor').getByLabel('Command', { exact: true })).toHaveValue('node failure.cjs')
    await page.keyboard.press('Escape')
    await expect(page.locator('#run-output')).toContainText('FIXTURE_FAILURE')
    const settings = JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
    expect(settings.runCommands[0].commands[0].shellCommand).toBe('node failure.cjs')
    await expect(page.locator('.pane')).toHaveCount(0)
  } finally {
    await closeApp(app)
  }
})
