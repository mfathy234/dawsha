import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { backToAgents, closeApp, createSandbox, launchApp, runCli, type Sandbox } from './helpers'

const FAKE = resolve(__dirname, '../support/fakeAgent.cjs')
const SHOTS = process.env.LEAD_SHOTS ?? join(tmpdir(), 'dawsha-176-lead-shots')
const GOAL = 'Fix the flaky login test'

const readSettings = (sandbox: Sandbox): any => JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))

function fakeEnv(sandbox: Sandbox): Record<string, string> {
  const node = process.execPath
  return {
    FAKE_AGENT_LOG: join(sandbox.root, 'agent-log'),
    DAWSHA_CLAUDE_COMMAND: node,
    DAWSHA_CLAUDE_ARGS: JSON.stringify([FAKE, 'claude']),
    DAWSHA_CODEX_COMMAND: node,
    DAWSHA_CODEX_ARGS: JSON.stringify([FAKE, 'codex']),
    DAWSHA_GEMINI_COMMAND: node,
    DAWSHA_GEMINI_ARGS: JSON.stringify([FAKE, 'gemini']),
    DAWSHA_SHARED_HOME: join(sandbox.root, 'shared-home')
  }
}

function agentArgs(sandbox: Sandbox, name = 'claude'): string[] {
  try {
    return JSON.parse(readFileSync(join(sandbox.root, 'agent-log', `${name}.json`), 'utf8')).args
  } catch {
    return []
  }
}

function withSettings(sandbox: Sandbox, extra: Record<string, unknown>): void {
  const file = join(sandbox.userData, 'settings.json')
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...extra }), 'utf8')
}

function writePlan(sandbox: Sandbox, name: string, steps: unknown[], summary = 'Find the cause, fix it, review once'): string {
  const file = join(sandbox.root, name)
  writeFileSync(file, JSON.stringify({ summary, steps }), 'utf8')
  return file
}

const OMAR = { member: 'Omar', job: 'Fix it in a new worktree with a test', fields: { task: 'fix the flaky login test' } }
const SAMI = { member: 'Sami', job: 'Review the whole change once', model: 'haiku', fields: { target: 'the fix branch' } }

async function openAgents(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1024, height: 728 })
  await page.locator('#background-button').click()
  await expect(page.locator('.crew-view')).toBeVisible()
}

async function handOver(page: Page, text = GOAL, planFirst = true): Promise<void> {
  await page.getByLabel('Goal for Maya').fill(text)
  const box = page.locator('#crew-goal-plan-first')
  if ((await box.isChecked()) !== planFirst) await box.setChecked(planFirst)
  await page.locator('#crew-goal-go').click()
}

const goalId = (sandbox: Sandbox): string => readSettings(sandbox).crewGoals[0].id

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, name) })
}

test('a goal launches Maya titled with the goal, with her instructions and the goal in her first message', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await expect(page.locator('.crew-item[data-member="maya"]')).toContainText('Give her a goal')
    await expect(page.locator('.crew-goalbox')).toBeVisible()
    await expect(page.locator('#crew-goal-plan-first')).toBeChecked()
    await expect(page.locator('.crew-goal-model option')).toHaveText(['Lead on Claude · Opus', 'Lead on Claude · Fable', 'Lead on Claude · Sonnet', 'Lead on Codex'])
    await handOver(page)

    await expect(page.locator('.pane')).toHaveCount(1)
    await expect(page.locator('.pane-title')).toContainText(`Maya · ${GOAL}`)
    await expect(page.locator('.crew-view')).toBeVisible()
    await expect.poll(() => agentArgs(sandbox).includes('--append-system-prompt')).toBe(true)
    const args = agentArgs(sandbox)
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus', '--effort', 'high', '--allowedTools', 'Bash(dawsha crew:*)', '--strict-mcp-config']))
    expect(args[args.indexOf('--append-system-prompt') + 1]).toContain('You lead a small crew')
    const first = args.at(-1) ?? ''
    const id = goalId(sandbox)
    expect(first).toContain(`Goal: ${GOAL}`)
    expect(first).toContain('Project: Smoke')
    expect(first).toContain(`Goal id: ${id}`)
    expect(first).toContain('- Omar, Builder (claude Sonnet), fields: task')
    expect(first).toContain('at most 2 members at once')
    expect(first).toContain('budget of $3.00')
    expect(first).toContain(`dawsha crew plan --goal ${id} --file <plan.json>`)
    expect(first).not.toContain('- Maya')
    await expect.poll(() => readSettings(sandbox).crewRuns?.[0]).toMatchObject({ memberName: 'Maya', lead: true, goalId: id, outcome: 'running' })
    await expect.poll(() => readSettings(sandbox).crewGoals?.[0]).toMatchObject({ text: GOAL, projectName: 'Smoke', planFirst: true, approved: false })
    await expect(page.locator('.crew-board h3')).toContainText(`Goal · ${GOAL}`)
    await expect(page.locator('.crew-goal-row-item')).toHaveCount(1)
    await expect(page.locator('.crew-goal-row-item')).toContainText('Running')
    await expect(page.getByLabel('Goal for Maya')).toHaveValue('')
  } finally {
    await closeApp(app)
  }
})

test('a plan shows as a card; Approve unblocks the command, Change sends the note, Cancel stops, a bad plan is refused', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await handOver(page)
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = goalId(sandbox)
    const plan = writePlan(sandbox, 'plan.json', [OMAR, SAMI])

    const early = await runCli(sandbox, ['crew', 'run', 'omar', '--goal', id, '--field', 'task=x'])
    expect(early).toMatchObject({ code: 1 })
    expect(early.err).toContain('plan is not approved')

    const bad = writePlan(sandbox, 'bad.json', [{ member: 'Nobody', job: 'x' }])
    const refused = await runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', bad])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain("Step 1: no crew member named 'Nobody'.")
    await expect(page.locator('.crew-plan')).toHaveCount(0)

    const approve = runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', plan])
    await expect(page.locator('.crew-plan')).toBeVisible()
    await expect(page.locator('.crew-plan h3')).toHaveText("Maya's plan · 2 jobs")
    await expect(page.locator('.crew-step[data-step="1"]')).toContainText('Omar')
    await expect(page.locator('.crew-step[data-step="1"]')).toContainText('Claude · Sonnet · ~$0.35')
    await expect(page.locator('.crew-step[data-step="2"]')).toContainText('Sami')
    await expect(page.locator('.crew-step[data-step="2"]')).toContainText('Claude · Haiku · ~$0.08')
    await expect(page.locator('.crew-plan-total')).toContainText('Estimated ~$0.43 of $3.00')
    await expect(page.locator('.crew-item[data-member="maya"] .crew-av')).toHaveAttribute('data-state', 'needs')
    await page.locator('.crew-plan-foot').scrollIntoViewIfNeeded()
    await shot(page, 'goals-plan-1024.png')
    await page.locator('#crew-plan-approve').click()
    const approved = await approve
    expect(approved).toMatchObject({ code: 0, out: 'approved' })
    await expect(page.locator('[data-plan-status="approved"]')).toHaveText('Approved')
    await expect(page.locator('#crew-plan-approve')).toHaveCount(0)
    await expect.poll(() => readSettings(sandbox).crewGoals[0].approved).toBe(true)

    const change = runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', plan])
    await expect(page.locator('#crew-plan-approve')).toBeVisible()
    await page.locator('#crew-plan-change').click()
    await page.getByLabel('What should change in the plan').fill('Skip the review and use Sonnet for the fix')
    await page.locator('#crew-plan-send').click()
    const changed = await change
    expect(changed.code).toBe(3)
    expect(changed.err).toBe('Skip the review and use Sonnet for the fix')
    await expect(page.locator('[data-plan-status="changed"]')).toContainText('Skip the review')
    await expect.poll(() => readSettings(sandbox).crewGoals[0].approved).toBe(false)

    const cancel = runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', plan])
    await expect(page.locator('#crew-plan-cancel')).toBeVisible()
    await page.locator('#crew-plan-cancel').click()
    const asked = page.getByRole('alertdialog', { name: 'Cancel this plan?' })
    await expect(asked).toContainText(`Maya stops "${GOAL}"`)
    await asked.getByRole('button', { name: 'Keep the plan' }).click()
    await expect(asked).toHaveCount(0)
    await expect(page.locator('#crew-plan-approve')).toBeVisible()
    await page.locator('#crew-plan-cancel').click()
    await page.getByRole('button', { name: `Cancel plan for "${GOAL}"` }).click()
    const cancelled = await cancel
    expect(cancelled.code).toBe(2)
    expect(cancelled.err).toBe('cancelled')
    await expect(page.locator('[data-plan-status="cancelled"]')).toHaveText('Cancelled')
  } finally {
    await closeApp(app)
  }
})

test('runs linked to the goal show as lanes, notes appear, and the limits refuse what they should', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await handOver(page)
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = goalId(sandbox)
    const plan = writePlan(sandbox, 'plan.json', [OMAR, SAMI])
    const approve = runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', plan])
    await page.locator('#crew-plan-approve').click()
    expect((await approve).out).toBe('approved')

    await expect(page.locator('.crew-lane')).toHaveCount(2)
    await expect(page.locator('.crew-lane[data-lane="1"]')).toContainText('Waiting')
    await expect(page.locator('.crew-lane[data-lane="1"]')).toContainText('Starts when Maya runs it · ~$0.35')

    const wrongProject = await runCli(sandbox, ['crew', 'run', 'omar', '--goal', id, '--project', 'Missing', '--field', 'task=x'])
    expect(wrongProject.code).toBe(1)
    expect(wrongProject.err).toContain('is for project Smoke')

    const omar = await runCli(sandbox, ['crew', 'run', 'omar', '--goal', id, '--field', 'task=fix the flaky login test', '--background'])
    expect(omar.code).toBe(0)
    expect(omar.out).toMatch(/^[a-z0-9]{6}$/)
    await expect(page.locator('.pane')).toHaveCount(2)
    await expect(page.locator('.crew-lane[data-lane="1"]')).toContainText('Working')
    await expect(page.locator('.crew-lane[data-lane="1"] .crew-av')).toHaveAttribute('data-state', 'working')
    await expect(page.locator('.crew-lane[data-lane="2"]')).toContainText('Waiting')
    await expect.poll(() => readSettings(sandbox).crewRuns.find((r: any) => r.id === omar.out)).toMatchObject({ goalId: id, memberName: 'Omar' })

    const note = await runCli(sandbox, ['crew', 'note', '--goal', id, 'Omar is on the fix. Sami reviews when he is done.'])
    expect(note).toMatchObject({ code: 0, out: 'noted' })
    await expect(page.locator('.crew-note-line')).toContainText('Maya: Omar is on the fix.')
    expect((await runCli(sandbox, ['crew', 'note', '--goal', 'nope', 'hi'])).err).toContain("No active goal 'nope'")

    const sami = await runCli(sandbox, ['crew', 'run', 'sami', '--goal', id, '--model', 'haiku', '--field', 'target=the fix branch', '--background'])
    expect(sami.code).toBe(0)
    await expect(page.locator('.pane')).toHaveCount(3)
    await expect(page.locator('.crew-lane[data-lane="2"]')).toContainText('Working')

    const third = await runCli(sandbox, ['crew', 'run', 'yara', '--goal', id, '--field', 'topic=login', '--background'])
    expect(third.code).toBe(1)
    expect(third.err).toContain('limit is 2 at once')
    await expect(page.locator('.crew-lane')).toHaveCount(2)
    await shot(page, 'goals-board-1024.png')

    await page.locator('.crew-lane[data-lane="1"]').click()
    await expect(page.locator('.pane.focused .pane-title')).toContainText('Omar')
  } finally {
    await closeApp(app)
  }
})

test('a question shows under Maya\'s notes, her avatar needs you, and the picked option returns to the command', async () => {
  test.setTimeout(120_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await handOver(page, GOAL, false)
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = goalId(sandbox)
    const avatar = page.locator('.crew-lead-head .crew-av')
    await expect(avatar).not.toHaveAttribute('data-state', 'needs')

    const asked = runCli(sandbox, ['crew', 'ask', '--goal', id, "Omar's fix and Sami's review are done. Should I push the branch and open a PR?", '--option', 'Push and open the PR', '--option', 'Keep it local'])
    const card = page.locator('.crew-question')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Should I push the branch and open a PR?')
    await expect(card.getByRole('button', { name: 'Push and open the PR' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Keep it local' })).toBeVisible()
    await expect(avatar).toHaveAttribute('data-state', 'needs')
    await expect(avatar).toHaveAttribute('aria-label', 'Maya, Needs you')
    await expect(page.locator('.crew-item[data-member="maya"] .crew-av')).toHaveAttribute('data-state', 'needs')
    await expect(page.locator('.crew-item[data-member="maya"]')).toContainText('Needs you')
    await expect(page.locator('#crew-strip')).toContainText('1 needs you')

    const second = await runCli(sandbox, ['crew', 'ask', '--goal', id, 'Another?', '--option', 'a', '--option', 'b'])
    expect(second.code).toBe(1)
    expect(second.err).toContain('already waiting')
    await shot(page, 'goals-question-1024.png')

    await card.getByRole('button', { name: 'Keep it local' }).click()
    const answer = await asked
    expect(answer).toMatchObject({ code: 0, out: 'Keep it local' })
    await expect(page.locator('.crew-question')).toHaveCount(0)
    await expect(page.locator('.crew-answered')).toContainText('You answered: Keep it local')
    await expect(avatar).not.toHaveAttribute('data-state', 'needs')

    const again = runCli(sandbox, ['crew', 'ask', '--goal', id, 'Push now?', '--option', 'Yes', '--option', 'No'])
    await page.locator('.crew-question').getByRole('button', { name: 'Yes' }).click()
    expect((await again).out).toBe('Yes')
  } finally {
    await closeApp(app)
  }
})

test('How she leads: rules, at once, budget and members are saved and enforced', async () => {
  test.setTimeout(150_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('.crew-item[data-member="maya"]').click()
    await page.locator('.crew-tab[data-tab="setup"]').click()
    await expect(page.locator('.crew-tab[data-tab="setup"]')).toHaveText('How she leads')
    for (const rule of ['fewBig', 'oneReview', 'planFirst', 'askFirst']) await expect(page.locator(`[data-rule="${rule}"]`)).toBeChecked()
    await expect(page.locator('.crew-radio[data-value="2"]')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.crew-budget')).toHaveValue('$3.00')
    await expect(page.getByLabel('Her instructions')).toHaveJSProperty('readOnly', true)
    await expect(page.getByLabel('Her instructions')).toHaveValue(/You lead a small crew/)
    await expect(page.locator('#crew-lead-duplicate')).toBeVisible()
    await expect(page.locator('[data-lead-commands]')).toContainText('dawsha crew ask --goal <id>')
    await expect(page.locator('[data-member-allowed]')).toHaveCount(7)
    await shot(page, 'how-she-leads-1024.png')

    await page.locator('[data-rule="planFirst"]').uncheck()
    await page.locator('.crew-radio[data-value="1"]').click()
    await page.locator('.crew-budget').fill('$0.50')
    await page.locator('.crew-budget').blur()
    await page.locator('[data-member-allowed="yara"]').uncheck()
    await expect.poll(() => readSettings(sandbox).lead).toEqual({
      rules: { fewBig: true, oneReview: true, planFirst: false, askFirst: true },
      atOnce: 1,
      budgetUsd: 0.5,
      excluded: ['yara']
    })

    await backToAgents(page)
    await expect(page.locator('#crew-goal-plan-first')).not.toBeChecked()
    await handOver(page, GOAL, false)
    await expect(page.locator('.pane')).toHaveCount(1)
    const id = goalId(sandbox)
    await expect.poll(() => agentArgs(sandbox).at(-1) ?? '').toContain('at most 1 member at once')
    expect(agentArgs(sandbox).at(-1)).toContain('budget of $0.50')
    expect(agentArgs(sandbox).at(-1)).not.toContain('- Yara')

    const yara = await runCli(sandbox, ['crew', 'run', 'yara', '--goal', id, '--field', 'topic=login'])
    expect(yara.code).toBe(1)
    expect(yara.err).toContain('Yara is not one of the members')

    const pricey = await runCli(sandbox, ['crew', 'run', 'omar', '--goal', id, '--model', 'opus', '--field', 'task=x'])
    expect(pricey.code).toBe(1)
    expect(pricey.err).toContain('over the $0.50 budget')
    expect(pricey.err).toContain('dawsha crew ask')

    const overPlan = await runCli(sandbox, ['crew', 'plan', '--goal', id, '--file', writePlan(sandbox, 'big.json', [{ ...OMAR, model: 'opus' }])])
    expect(overPlan.code).toBe(1)
    expect(overPlan.err).toContain('over the $0.50 budget')

    const cheap = await runCli(sandbox, ['crew', 'run', 'sami', '--goal', id, '--model', 'haiku', '--field', 'target=x', '--background'])
    expect(cheap.code).toBe(0)
    await expect(page.locator('.pane')).toHaveCount(2)
    const busy = await runCli(sandbox, ['crew', 'run', 'sami', '--goal', id, '--model', 'haiku', '--field', 'target=y', '--background'])
    expect(busy.code).toBe(1)
    expect(busy.err).toContain('limit is 1 at once')
    await expect(page.locator('.pane')).toHaveCount(2)
  } finally {
    await closeApp(app)
  }
})

test('the Agents Setup form is readable at 1024 and 1440 wide', async () => {
  test.setTimeout(90_000)
  const sandbox = createSandbox()
  const { app, page } = await launchApp(sandbox, fakeEnv(sandbox))
  try {
    await openAgents(page)
    await page.locator('.crew-body').evaluate((node) => (node.scrollTop = 200))
    const rosterScroll = await page.locator('.crew-body').evaluate((node) => node.scrollTop)
    await page.locator('.crew-item[data-member="sami"]').click()
    await expect(page.locator('.crew-roster')).toBeHidden()
    await expect(page.locator('.crew-crumb')).toBeVisible()
    const detail = await page.locator('.crew-detail').boundingBox()
    expect(detail!.width).toBeGreaterThan(440)
    await backToAgents(page)
    await expect(page.locator('.crew-detail')).toBeHidden()
    await expect.poll(() => page.locator('.crew-body').evaluate((node, savedScroll) => {
      const body = node as HTMLElement
      return body.scrollTop >= Math.min(savedScroll, body.scrollHeight - body.clientHeight)
    }, rosterScroll)).toBe(true)
    await page.locator('.crew-item[data-member="sami"]').click()
    const stackedLabel = await page.locator('.crew-form .crew-label').first().boundingBox()
    const stackedControl = await page.locator('.crew-form .crew-control').first().boundingBox()
    const stacked = stackedControl!.y >= stackedLabel!.y + stackedLabel!.height - 1 && stackedControl!.x <= stackedLabel!.x + 1
    const beside = stackedControl!.x > stackedLabel!.x + stackedLabel!.width - 1
    expect(stacked || beside).toBe(true)
    const instructions = await page.locator('.crew-form textarea[aria-label="Instructions"]').boundingBox()
    expect(instructions!.height).toBeGreaterThanOrEqual(150)
    const prompt = await page.locator('.crew-form textarea[aria-label="Prompt"]').boundingBox()
    expect(prompt!.height).toBeGreaterThanOrEqual(90)
    const formWidth = (await page.locator('.crew-form').boundingBox())!.width
    for (const box of await page.locator('.crew-form .text-input, .crew-form .crew-area').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().right))) expect(box).toBeLessThanOrEqual(detail!.x + detail!.width + 1)
    expect(formWidth).toBeGreaterThan(300)
    await shot(page, 'setup-1024.png')
    await page.locator('.crew-detail').evaluate((node) => (node.scrollTop = 600))
    await shot(page, 'setup-1024-scrolled.png')

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('.crew-detail').evaluate((node) => (node.scrollTop = 0))
    const label = await page.locator('.crew-form .crew-label').first().boundingBox()
    const control = await page.locator('.crew-form .crew-control').first().boundingBox()
    expect(control!.x).toBeGreaterThan(label!.x + label!.width - 1)
    const wide = await page.locator('.crew-form textarea[aria-label="Instructions"]').boundingBox()
    expect(wide!.height).toBeGreaterThanOrEqual(150)
    await shot(page, 'setup-1440.png')
  } finally {
    await closeApp(app)
  }
})
