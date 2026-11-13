import { expect, it } from 'vitest'
import { derivePanes } from '../../src/renderer/derive'
import { initialState } from '../../src/renderer/state'

it('shares short titles across pane views and terminal tabs while keeping manual names and full prompts', () => {
  const base = initialState()
  const prompt = 'Please fix the failing invoice export and add regression coverage today'
  const state = {
    ...base,
    settings: { ...base.settings, projects: [{ id: 'p', name: 'P', folder: 'C:\\work', defaultAgent: 'claude' as const }] },
    panes: [1, 2, 3].map(i => ({ id: `p${i}`, projectId: 'p', activeTabId: `t${i}`, fontSize: 15,
      tabs: [{ id: `t${i}`, agent: 'claude' as const, label: 'Claude', startedAt: 1, status: 'running' as const, pid: i, ...(i === 3 ? { name: 'My manual title!' } : {}) }] })),
    sessions: [1, 2, 3].map(i => ({ pid: i, sessionId: `s${i}`, cwd: 'C:\\work', startedAt: 1, name: prompt, nameSource: 'transcript', firstPrompt: prompt }))
  }
  const views = derivePanes(state)
  expect(views.map(view => view.title)).toEqual(['Fix the failing invoice export', 'Fix the failing invoice export 2', 'My manual title!'])
  expect(views[0].tabs[0].label).toBe(views[0].title)
  expect(views[2].tabs[0].label).toBe('My manual title!')
  expect(views[0]).toHaveProperty('fullTitle', prompt)
})

it('uses the original prompt for Codex and Gemini too', () => {
  const base = initialState()
  const prompt = 'Please fix login and add regression coverage for every case'
  const agents = ['codex', 'gemini'] as const
  const views = derivePanes({ ...base,
    settings: { ...base.settings, projects: [{ id: 'p', name: 'P', folder: 'C:\\work', defaultAgent: 'claude' }] },
    panes: agents.map(agent => ({ id: agent, projectId: 'p', activeTabId: agent, fontSize: 15,
      tabs: [{ id: agent, agent, label: agent, sessionId: agent, startedAt: 1, status: 'running' }] })),
    codexSessions: [{ sessionId: 'codex', cwd: 'C:\\work', startedAt: 1, updatedAt: 2, status: 'idle', firstPrompt: prompt }],
    geminiSessions: [{ sessionId: 'gemini', startedAt: 1, updatedAt: 2, firstPrompt: prompt, name: 'Please fix login', nameSource: 'prompt' }]
  })
  expect(views.map(view => view.fullTitle)).toEqual([prompt, prompt])
  expect(views.map(view => view.title)).toEqual(['Fix login and add regression coverage', 'Fix login and add regression 2'])
})
