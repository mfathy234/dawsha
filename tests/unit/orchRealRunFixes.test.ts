import { describe, expect, it } from 'vitest'
import { OrchPaneBridge } from '../../src/main/orch/paneBridge'
import { OrchService } from '../../src/main/orch/service'
import { OrchStore } from '../../src/main/orch/store'
import type { SpawnRequest } from '../../src/shared/types'

// Bugs found in the user's first real runs (2026-10-16).

const STORY = 'On a branch based on develop in admin.client and adminportal.apis, hide the server dropdown from add online invoice and offline invoice, and create the database ourselves as MicrotecApps.{subdomain} during provisioning.'

function setup() {
  let t = 0
  const svc = new OrchService(new OrchStore(':memory:'), () => (t += 1))
  const run = svc.startRun({ projectPath: 'C:/work/platforms', title: 'Hide the server dropdown…', story: STORY, plan: 'default' })
  const lead = svc.registerAgent({ runId: run.id, role: 'lead', runner: 'claude', model: 'opus' })
  return { svc, run, lead }
}

describe('orchestrator fixes from the first real runs', () => {
  it('gives the lead the full story, not only the shortened title', () => {
    const { svc, lead } = setup()
    expect(svc.call(lead, 'whoami', {})).toMatchObject({ run_title: 'Hide the server dropdown…', story: STORY, project_path: 'C:/work/platforms' })
  })

  it('delivers the human answer to a lead that asked while planning, with no task of its own', () => {
    const { svc, lead } = setup()
    svc.call(lead, 'ask_human', { question: 'Which server key should provisioning use?' })
    svc.answerDecision(svc.openDecisions()[0].id, 'A new config key, defaulting to "main"')
    expect(svc.unreadCount(lead.id)).toBe(1)
    expect(svc.call(lead, 'fetch_inbox', {})).toEqual([
      expect.objectContaining({ from: 'human', body: expect.stringContaining('A new config key, defaulting to "main"') })
    ])
  })

  it('closes the open questions of a cancelled run, so the inbox and badges stop counting them', () => {
    const { svc, run, lead } = setup()
    svc.call(lead, 'ask_human', { question: 'Which repository?' })
    expect(svc.openDecisions()).toHaveLength(1)
    svc.finishRun(run.id, 'cancelled')
    expect(svc.openDecisions()).toEqual([])
    expect(svc.decisions(run.id)[0]).toMatchObject({ answer: 'Run cancelled' })
  })

  it('does not count questions left open on runs that already finished (older data)', () => {
    const { svc, run, lead } = setup()
    svc.call(lead, 'ask_human', { question: 'Which repository?' })
    // Older builds finished runs without closing their questions.
    svc.setStage(run.id, 'cancelled')
    expect(svc.openDecisions()).toEqual([])
  })

  it('starts a restored pane fresh when its agent never connected, since there is no session to resume', () => {
    const { svc, lead } = setup()
    svc.setLaunch(lead.id, { agent: 'claude', args: ['--model', 'opus', '--session-id', 's-1'], env: {}, files: [] })
    const bridge = new OrchPaneBridge({ service: () => svc, write: () => undefined, stallOptions: () => [], quietMinutes: () => 10, autoTrust: () => true })
    const request = { id: 'tab-1', agent: 'claude', cwd: 'C:/wt', resume: true, cols: 80, rows: 24, orchAgentId: lead.id } as SpawnRequest
    expect(bridge.prepare(request)).toMatchObject({ resume: false, args: ['--model', 'opus', '--session-id', 's-1'] })
    svc.call(lead, 'whoami', {})
    expect(bridge.prepare({ ...request, id: 'tab-2' })).toMatchObject({ resume: true, args: ['--model', 'opus'] })
  })
})
