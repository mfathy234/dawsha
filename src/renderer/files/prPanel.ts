import { api } from '../api'
import {
  MERGE_LABEL,
  baseProblem,
  bodyProblem,
  failedChecks,
  feedbackMessage,
  mergeCopy,
  titleProblem,
  type MergeMethod,
  type PrCheck,
  type PrComment,
  type PrInfo,
  type PrOverviewResult
} from '../../shared/prFlow'
import { confirmDialog } from '../components/dialogs'
import { toast } from '../components/toast'
import { h } from '../dom'
import type { PanelExtra } from './bottomPanel'
import './filesTools.css'

export interface PrHooks {
  folder(): string | null
  open(path: string, line: number): void
  /** Put text in an agent's prompt without sending it; the anchor places the session menu. */
  send(text: string, anchor: HTMLElement): void
}

type Ready = Extract<PrOverviewResult, { ok: true }>

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`
const humanBranch = (branch: string): string => {
  const words = branch.replace(/^(feature|fix|bugfix|chore|hotfix)\//i, '').replace(/[-_/]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function mergeNote(pr: PrInfo): string | null {
  if (pr.state !== 'OPEN') return `This pull request is ${pr.state.toLowerCase()}.`
  if (pr.isDraft) return 'This is a draft. Mark it ready on GitHub to merge.'
  if (pr.mergeable === 'CONFLICTING') return 'It has conflicts with the base branch.'
  return null
}

function checksSummary(checks: readonly PrCheck[]): string {
  if (checks.length === 0) return 'No checks reported.'
  const failing = failedChecks(checks).length
  const pending = checks.filter((check) => check.bucket === 'pending').length
  return [failing > 0 ? `${failing} failing` : '', pending > 0 ? `${pending} running` : '', `${checks.length - failing - pending} other`].filter(Boolean).join(', ')
}

/** The Pull request tab: open one from the current branch, read its review comments and failing checks, send them to an agent, and merge on purpose. */
export class PrPanel implements PanelExtra {
  readonly id = 'pr'
  readonly label = 'Pull request'
  readonly el = h('div', { class: 'files-pr', id: 'files-pr', role: 'tabpanel', hidden: true })
  private loadedFolder: string | null = null
  private token = 0
  private busy = false
  private method: MergeMethod = 'squash'
  private ready: Ready | null = null

  constructor(private readonly hooks: PrHooks) {
    this.show(h('p', { class: 'files-side-empty' }, 'Reading the pull request...'))
  }

  activate(active: boolean): void {
    if (active && this.hooks.folder() !== this.loadedFolder) void this.load()
  }

  private show(...children: Array<Node | null>): void {
    this.el.replaceChildren(...children.filter((child): child is Node => child !== null))
  }

  async load(): Promise<void> {
    const folder = this.hooks.folder()
    const token = ++this.token
    this.loadedFolder = folder
    if (!folder) {
      this.show(h('p', { class: 'files-side-empty', id: 'files-pr-message' }, 'Open a project to work with its pull request.'))
      return
    }
    this.show(h('p', { class: 'files-side-empty', id: 'files-pr-message' }, 'Reading the pull request...'))
    const result = await api.tools.pullRequest({ folder, action: 'overview' })
    if (token !== this.token) return
    if (!result.ok) {
      this.ready = null
      this.show(this.unavailable(result.message, result.reason))
      return
    }
    this.ready = result
    this.show(result.pr ? this.pullRequest(result, result.pr) : this.createForm(result))
  }

  private unavailable(message: string, reason: string): HTMLElement {
    return h('div', { class: 'files-tool-state', id: 'files-pr-state', 'data-reason': reason },
      h('p', { class: 'files-tool-state-text', id: 'files-pr-message' }, message),
      h('button', { class: 'btn small', type: 'button', id: 'files-pr-retry', onClick: () => void this.load() }, 'Check again'))
  }

  private createForm(ready: Ready): HTMLElement {
    const title = h('input', { class: 'files-tool-input wide', id: 'files-pr-title', type: 'text', maxlength: '256', 'aria-label': 'Title', value: humanBranch(ready.branch) })
    const body = h('textarea', { class: 'files-tool-input wide', id: 'files-pr-body', rows: '3', 'aria-label': 'Description', placeholder: 'What changed and why' })
    const base = h('input', { class: 'files-tool-input', id: 'files-pr-base', type: 'text', 'aria-label': 'Base branch', placeholder: 'Default branch' })
    const draft = h('input', { type: 'checkbox', id: 'files-pr-draft' })
    const problem = h('p', { class: 'files-tool-problem', id: 'files-pr-problem', role: 'status' })
    const submit = h('button', { class: 'btn primary small', type: 'button', id: 'files-pr-create', onClick: () => void this.create(ready, { title, body, base, draft, problem, submit }) }, 'Open pull request')
    return h('div', { class: 'files-pr-create' },
      h('p', { class: 'files-pr-lead' }, `No pull request for ${ready.branch} yet.`),
      title, body,
      h('div', { class: 'files-tool-controls' }, base, h('label', { class: 'files-tool-check' }, draft, 'Draft'), submit),
      problem)
  }

  private async create(ready: Ready, form: { title: HTMLInputElement; body: HTMLTextAreaElement; base: HTMLInputElement; draft: HTMLInputElement; problem: HTMLElement; submit: HTMLButtonElement }): Promise<void> {
    const folder = this.hooks.folder()
    const wrong = titleProblem(form.title.value) ?? bodyProblem(form.body.value) ?? baseProblem(form.base.value.trim())
    form.problem.textContent = wrong ?? ''
    if (wrong || !folder || this.busy) return
    this.busy = true
    form.submit.disabled = true
    form.problem.textContent = `Opening a pull request for ${ready.branch}...`
    const result = await api.tools.pullRequest({ folder, action: 'create', title: form.title.value.trim(), body: form.body.value, base: form.base.value.trim(), draft: form.draft.checked })
    this.busy = false
    form.submit.disabled = false
    if (!result.ok) {
      form.problem.textContent = result.error
      return
    }
    toast(result.message, 'info')
    await this.load()
  }

  private pullRequest(ready: Ready, pr: PrInfo): HTMLElement {
    const failures = failedChecks(ready.checks)
    const feedback = ready.comments.length + failures.length
    const link = h('button', { class: 'files-pr-title', type: 'button', id: 'files-pr-link', title: pr.url, onClick: () => this.openUrl(pr.url) }, `#${pr.number} ${pr.title}`)
    const status = [pr.state === 'OPEN' ? (pr.isDraft ? 'Draft' : 'Open') : pr.state === 'MERGED' ? 'Merged' : 'Closed', `${pr.head} into ${pr.base}`, pr.reviewDecision ? pr.reviewDecision.replace(/_/g, ' ').toLowerCase() : ''].filter(Boolean).join(', ')
    const send = h('button', { class: 'btn small', type: 'button', id: 'files-pr-send', disabled: feedback === 0, onClick: (event: Event) => this.hooks.send(feedbackMessage(pr, ready.comments, failures), event.currentTarget as HTMLElement) }, feedback === 0 ? 'Nothing to send' : 'Send feedback to agent')
    const refresh = h('button', { class: 'btn ghost small', type: 'button', id: 'files-pr-refresh', onClick: () => void this.load() }, 'Refresh')
    return h('div', { class: 'files-pr-open' },
      h('div', { class: 'files-tool-head' }, link, h('div', { class: 'files-tool-controls' }, send, refresh, ...this.mergeControls(pr))),
      h('p', { class: 'files-pr-status', id: 'files-pr-status' }, status),
      h('div', { class: 'files-pr-lists' }, this.checkList(ready.checks), this.commentList(ready.comments)))
  }

  private mergeControls(pr: PrInfo): HTMLElement[] {
    const note = mergeNote(pr)
    const select = h('select', { class: 'files-tool-select', id: 'files-pr-method', 'aria-label': 'Merge method', onChange: () => { this.method = select.value as MergeMethod } },
      ...(Object.keys(MERGE_LABEL) as MergeMethod[]).map((method) => h('option', { value: method }, MERGE_LABEL[method])))
    select.value = this.method
    const merge = h('button', { class: 'btn small', type: 'button', id: 'files-pr-merge', disabled: note !== null, title: note ?? '', onClick: () => void this.merge(pr) }, 'Merge...')
    return [select, merge]
  }

  private async merge(pr: PrInfo): Promise<void> {
    const folder = this.hooks.folder()
    if (!folder || this.busy) return
    const copy = mergeCopy(pr, this.method)
    if (!(await confirmDialog(copy))) return
    this.busy = true
    const result = await api.tools.pullRequest({ folder, action: 'merge', number: pr.number, headSha: pr.headSha, method: this.method })
    this.busy = false
    toast(result.ok ? result.message : result.error, result.ok ? 'info' : 'error')
    await this.load()
  }

  private openUrl(url: string): void {
    if (/^https:\/\//i.test(url)) void api.openExternal(url)
  }

  private checkList(checks: readonly PrCheck[]): HTMLElement {
    const failing = failedChecks(checks)
    const rows = [...failing, ...checks.filter((check) => check.bucket !== 'fail')].map((check) =>
      h('button', { class: `files-pr-row check-${check.bucket}`, type: 'button', title: check.link, onClick: () => this.openUrl(check.link) },
        h('span', { class: 'files-pr-row-state' }, check.bucket === 'fail' ? 'Failed' : check.bucket === 'pass' ? 'Passed' : check.bucket === 'pending' ? 'Running' : 'Skipped'),
        h('span', { class: 'files-pr-row-text' }, check.workflow ? `${check.workflow} / ${check.name}` : check.name)))
    return h('section', { class: 'files-pr-section', id: 'files-pr-checks', 'aria-label': 'Checks' },
      h('h3', { class: 'files-pr-heading' }, 'Checks'), h('p', { class: 'files-pr-count' }, checksSummary(checks)), ...rows)
  }

  private commentList(comments: readonly PrComment[]): HTMLElement {
    const rows = comments.map((comment) => {
      const where = comment.path ? `${comment.path.split('/').pop()}${comment.line ? `:${comment.line}` : ''}` : 'Review'
      const row = h('button', { class: 'files-pr-row', type: 'button', 'data-path': comment.path ?? '', title: comment.path ?? comment.author, onClick: () => comment.path && comment.line && this.hooks.open(comment.path, comment.line) },
        h('span', { class: 'files-pr-row-state' }, where),
        h('span', { class: 'files-pr-row-text' }, `${comment.author}: ${comment.body.replace(/\s+/g, ' ')}`))
      return row
    })
    return h('section', { class: 'files-pr-section', id: 'files-pr-comments', 'aria-label': 'Review comments' },
      h('h3', { class: 'files-pr-heading' }, 'Review comments'),
      h('p', { class: 'files-pr-count' }, comments.length === 0 ? 'No review comments.' : plural(comments.length, 'comment')), ...rows)
  }
}
