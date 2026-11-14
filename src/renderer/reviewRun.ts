import { AGENT_NAMES } from '../shared/agents'
import { BUILTIN_MEMBERS } from '../shared/crewBuiltins'
import { READ_ONLY_NOTE } from '../shared/crewLaunch'
import type { CrewMember } from '../shared/crew'
import { sendable, snippetAt, type NewDraft } from '../shared/reviewDrafts'
import { buildReviewPrompt, clipDiff, findingText, parseFindings, REVIEW_SCOPES, summaryLabel, type Finding, type ReviewScope } from '../shared/reviewFindings'
import type { AgentKind } from '../shared/types'
import { api } from './api'
import { closePane, focusPane } from './actions'
import { toast } from './components/toast'
import { runMember } from './crewActions'
import { crewRunResult } from './crewLive'
import { derivePanes } from './derive'
import { loadSessionData } from './files/sessionTouch'
import { addDrafts, allDrafts, changeDraft, onDraftsChange, sendDrafts, type SendTarget } from './reviewDrafts'
import { panelSource } from './sidePanelSources'
import { folderOfPane, paneById, projectById, store } from './state'

const MAX_FILES = 60
const REVIEW_NOTE = 'Answer exactly in the format the task asks for. Do not ask questions; this review runs in the background.'

export interface ReviewJob {
  folder: string
  authorPaneId: string
  reviewer: AgentKind
  scope: ReviewScope
  scopeLabel: string
  state: 'running' | 'done' | 'failed'
  raw: string
  runId: string
  reviewerPaneId: string
  summary: string
  /** The comments this review made. */
  draftIds: string[]
}

export interface ReviewRequest {
  paneId: string
  reviewer: AgentKind
  scope: ReviewScope
}

const jobs = new Map<string, ReviewJob>()
const listeners = new Set<() => void>()

export const reviewOf = (folder: string): ReviewJob | null => jobs.get(folder) ?? null

export const onReviewChange = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const emit = (): void => {
  for (const listener of listeners) listener()
}

function put(job: ReviewJob): void {
  jobs.set(job.folder, job)
  emit()
}

onDraftsChange(emit)

/** The session a comment goes back to, as a send target. */
export function targetOf(paneId: string): SendTarget | null {
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === paneId)
  return view && view.agent !== 'shell' ? { paneId, title: view.title, agent: AGENT_NAMES[view.agent] } : null
}

export const agentOfPane = (paneId: string): AgentKind | null => {
  const view = derivePanes(store.state).find((candidate) => candidate.pane.id === paneId)
  return view && view.agent !== 'shell' ? view.agent : null
}

async function changedPaths(paneId: string, folder: string, projectId: string, scope: ReviewScope): Promise<string[]> {
  const status = await api.gitStatus(folder).catch(() => null)
  const all = status?.ok ? status.status.files.map((file) => file.path) : []
  if (scope === 'uncommitted') return all
  if (scope === 'reply') {
    const reply = panelSource(paneId)?.card()
    const within = reply ? reply.paths.filter((path) => all.includes(path)) : []
    return within.length > 0 ? within : all
  }
  const data = await loadSessionData(projectId, folder).catch(() => null)
  const touched = all.filter((path) => (data?.touches.get(path) ?? []).some((session) => session.paneId === paneId && session.edits > 0))
  return touched.length > 0 ? touched : all
}

async function diffOf(folder: string, paths: readonly string[]): Promise<string> {
  const parts: string[] = []
  let size = 0
  for (const path of paths.slice(0, MAX_FILES)) {
    const result = await api.gitDiff(folder, path).catch(() => null)
    if (!result?.ok || result.text.trim() === '') continue
    const text = result.text.startsWith('diff ') ? result.text : `diff -- ${path}\n${result.text}`
    parts.push(text)
    size += text.length
    if (size > 40_000) break
  }
  return parts.join('\n')
}

const reviewMember = (reviewer: AgentKind): CrewMember => {
  const base = BUILTIN_MEMBERS.find((member) => member.id === 'sami') ?? BUILTIN_MEMBERS[0]
  return {
    ...base,
    runner: reviewer,
    model: reviewer === 'claude' ? 'sonnet' : '',
    permissions: 'read',
    prompt: '{{target}}',
    instructions: `You are a code reviewer. Read only: never edit, create, delete or move files, never commit or push. ${REVIEW_NOTE} ${reviewer === 'claude' ? '' : READ_ONLY_NOTE}`.trim()
  }
}

async function lineTextOf(folder: string, cache: Map<string, string[] | null>, path: string): Promise<string[] | null> {
  if (!cache.has(path)) {
    const result = await api.projectFile(folder, path).catch(() => null)
    cache.set(path, result?.ok && result.text !== null ? result.text.split('\n') : null)
  }
  return cache.get(path) ?? null
}

async function draftsFromFindings(job: ReviewJob, findings: readonly Finding[], fallbackPath: string): Promise<NewDraft[]> {
  const cache = new Map<string, string[] | null>()
  const inputs: NewDraft[] = []
  for (const finding of findings) {
    const general = finding.file === ''
    const path = general ? fallbackPath : finding.file
    if (path === '') continue
    const lines = await lineTextOf(job.folder, cache, path)
    const line = Math.max(1, finding.line)
    const known = lines !== null && line <= lines.length
    inputs.push({
      folder: job.folder,
      paneId: job.authorPaneId,
      path,
      line,
      lineText: known ? lines[line - 1] : '',
      snippet: known ? snippetAt(lines, line) : [],
      text: general ? `General: ${findingText(finding)}` : findingText(finding),
      author: 'reviewer',
      reviewer: { agent: AGENT_NAMES[job.reviewer], severity: finding.severity, title: finding.title, fix: finding.fix }
    })
  }
  return inputs
}

async function finish(job: ReviewJob, fallbackPath: string): Promise<void> {
  const raw = (await crewRunResult(store.state, job.runId).catch(() => null)) ?? ''
  const parsed = parseFindings(raw)
  if (!parsed.ok) return put({ ...job, state: 'failed', raw })
  const made = addDrafts(await draftsFromFindings(job, parsed.findings, fallbackPath))
  put({ ...job, state: 'done', raw, summary: summaryLabel(parsed.findings), draftIds: made.map((draft) => draft.id) })
}

function watch(job: ReviewJob, fallbackPath: string): void {
  const stop = store.subscribe((state) => {
    const current = jobs.get(job.folder)
    if (!current || current.runId !== job.runId || current.state !== 'running') return stop()
    const run = state.settings.crewRuns.find((entry) => entry.id === job.runId)
    if (!run || run.outcome === 'running') return
    stop()
    if (run.outcome === 'done') void finish(current, fallbackPath)
    else put({ ...current, state: 'failed', raw: '' })
  })
}

/** Starts the reviewer in a background session with the diff and the fixed prompt; its findings come back as comments on the diff lines. */
export async function startReview(request: ReviewRequest): Promise<boolean> {
  const pane = paneById(store.state, request.paneId)
  const folder = pane ? folderOfPane(store.state, pane) : null
  const project = pane ? projectById(store.state, pane.projectId) : undefined
  if (!pane || !folder || !project || agentOfPane(request.paneId) === null) {
    toast('Open an agent session to review.', 'info')
    return false
  }
  const scopeLabel = (REVIEW_SCOPES.find((entry) => entry.id === request.scope)?.label ?? '').toLowerCase()
  const paths = await changedPaths(request.paneId, folder, pane.projectId, request.scope)
  if (paths.length === 0) {
    toast('Nothing to review: no files have changed.', 'info')
    return false
  }
  const clipped = clipDiff(await diffOf(folder, paths))
  const prompt = buildReviewPrompt({ scope: request.scope, diff: clipped.text, truncated: clipped.truncated, command: request.scope === 'uncommitted' ? 'git diff HEAD' : `git diff HEAD -- ${paths.slice(0, 8).join(' ')}` })
  const author = targetOf(request.paneId)
  const started = await runMember({
    member: reviewMember(request.reviewer),
    projectId: pane.projectId,
    choice: 'default',
    fields: { target: prompt },
    background: true,
    title: `Review: ${author?.title ?? project.name}`,
    ...(pane.folder ? { folder: pane.folder } : {})
  })
  if (!started.ok) {
    toast(started.error, 'info')
    return false
  }
  const job: ReviewJob = { folder, authorPaneId: request.paneId, reviewer: request.reviewer, scope: request.scope, scopeLabel, state: 'running', raw: '', runId: started.runId, reviewerPaneId: started.paneId, summary: '', draftIds: [] }
  put(job)
  watch(job, paths[0])
  return true
}

export function cancelReview(folder: string): void {
  const job = jobs.get(folder)
  if (!job) return
  jobs.delete(folder)
  emit()
  void closePane(job.reviewerPaneId)
}

export function showReviewer(folder: string): void {
  const job = jobs.get(folder)
  if (job) focusPane(job.reviewerPaneId)
}

const openOf = (job: ReviewJob) => allDrafts().filter((draft) => job.draftIds.includes(draft.id) && draft.status === 'open')

/** A pane the reviewer runs in; comments never go there. */
export const isReviewerPane = (paneId: string): boolean => [...jobs.values()].some((job) => job.reviewerPaneId === paneId)

export const openFindings = (folder: string): number => {
  const job = jobs.get(folder)
  return job ? openOf(job).length : 0
}

/** Closes the card and dismisses the findings nobody acted on. */
export function dismissReview(folder: string): void {
  const job = jobs.get(folder)
  if (!job) return
  jobs.delete(folder)
  for (const draft of openOf(job)) changeDraft(draft.id, (current) => ({ ...current, status: 'dismissed' }))
  emit()
}

/** Every open finding of the review in one message to the session that did the work. */
export function fixAll(folder: string): boolean {
  const job = jobs.get(folder)
  const target = job ? targetOf(job.authorPaneId) : null
  if (!job || !target) {
    toast('That session is not open any more.', 'info')
    return false
  }
  return sendDrafts(target, sendable(openOf(job)))
}

export function sendOne(id: string): boolean {
  const draft = allDrafts().find((candidate) => candidate.id === id)
  const target = draft?.paneId ? targetOf(draft.paneId) : null
  if (!draft || !target) {
    toast('That session is not open any more.', 'info')
    return false
  }
  return sendDrafts(target, [draft])
}

export function dismissOne(id: string): void {
  changeDraft(id, (draft) => ({ ...draft, status: 'dismissed' }))
}

/** The Review action: asks who reviews and what, then starts it. Offered from the pane menu, the Side panel and a reply's summary. */
export async function reviewSession(paneId: string, scope: ReviewScope = 'uncommitted'): Promise<void> {
  const author = agentOfPane(paneId)
  const target = targetOf(paneId)
  if (!author || !target) {
    toast('Open an agent session to review.', 'info')
    return
  }
  const { reviewDialog } = await import('./components/reviewDialog')
  const choice = await reviewDialog({ author, title: target.title, scope })
  if (choice) await startReview({ paneId, reviewer: choice.reviewer, scope: choice.scope })
}

export async function retryReview(folder: string): Promise<void> {
  const job = jobs.get(folder)
  if (!job) return
  dismissReview(folder)
  await startReview({ paneId: job.authorPaneId, reviewer: job.reviewer, scope: job.scope })
}
