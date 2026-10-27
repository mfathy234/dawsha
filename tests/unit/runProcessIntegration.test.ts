import { afterEach, describe, expect, it } from 'vitest'
import { RunProcesses } from '../../src/main/runCommands/processes'
import type { RunCommand, RunSnapshot } from '../../src/shared/runCommands'

const managers: RunProcesses[] = []
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.dispose()))
})
const target = { projectId: 'fixture', folder: process.cwd() }
function fixture(
  script: string,
  onChanged: (runs: RunSnapshot[]) => void = () => {}
): { manager: RunProcesses; command: RunCommand } {
  const manager = new RunProcesses(onChanged, {
    prepare: () => ({ file: process.execPath, args: ['-e', script] })
  })
  managers.push(manager)
  return {
    manager,
    command: {
      id: 'fixture',
      name: 'Harmless fixture',
      cwd: '.',
      source: 'fixture',
      display: 'node fixture'
    }
  }
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 8000
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error('Fixture did not reach expected state')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
describe('real dedicated process ownership', () => {
  it('runs an explicitly saved custom shell command with quoted executable paths', async () => {
    const manager = new RunProcesses(() => {})
    managers.push(manager)
    const shellCommand = `"${process.execPath}" -e "console.log('custom-shell-ok')"`
    manager.start(
      target,
      {
        id: 'custom:shell',
        name: 'Custom shell',
        cwd: '.',
        source: 'Local override',
        display: shellCommand,
        shellCommand
      },
      process.cwd()
    )
    await until(() => manager.list()[0].status !== 'running')
    expect(manager.list()[0]).toMatchObject({ status: 'exited', exitCode: 0 })
    expect(manager.list()[0].output).toContain('custom-shell-ok')
  })
  it('retains real stderr and a nonzero exit status', async () => {
    const { manager, command } = fixture(
      'console.error("fixture-failure");process.exitCode=7'
    )
    manager.start(target, command, process.cwd())
    await until(() => manager.list()[0].status === 'failed')
    expect(manager.list()[0]).toMatchObject({ status: 'failed', exitCode: 7 })
    expect(manager.list()[0].output).toContain('fixture-failure')
  })
  it('kills only one owned tree while the other command remains running', async () => {
    const script =
      'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});console.log("child:"+c.pid);setInterval(()=>{},1000)'
    const { manager, command } = fixture(script)
    const one = manager.start(target, command, process.cwd())
    const two = manager.start(
      target,
      { ...command, id: 'other' },
      process.cwd()
    )
    await until(() =>
      manager.list().every((run) => run.output.includes('child:'))
    )
    const firstChild = Number(/child:(\d+)/.exec(manager.list()[0].output)?.[1])
    await manager.stop(one.id)
    await until(() => manager.list()[0].status === 'stopped')
    expect(manager.list().find((run) => run.id === two.id)?.status).toBe(
      'running'
    )
    await until(() => {
      try {
        process.kill(firstChild, 0)
        return false
      } catch {
        return true
      }
    })
    await manager.dispose()
    await until(
      () =>
        manager.list().find((run) => run.id === two.id)?.status === 'stopped' ||
        manager.list().find((run) => run.id === two.id)?.status === 'failed'
    )
  })
})
