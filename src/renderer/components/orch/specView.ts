import { selectMenu } from '../selectMenu'
import type { OrchDecisionView, OrchSpecContent, OrchSpecView as SpecViewData } from '../../../shared/orch/api'
import { renderMarkdown } from '../../../shared/markdown'
import { formatSpecComments, type SpecComment } from '../../../shared/orch/specReview'
import { api } from '../../api'
import { h, clear } from '../../dom'
import { answerDecision, showOrch } from '../../orchActions'
import type { AppState } from '../../state'
import { toast } from '../toast'
import './specView.css'

interface Draft { comments: SpecComment[]; text: string; target: string; note: string }
const button = (label: string, click: () => void, primary = false): HTMLButtonElement =>
  h('button', { class: primary ? 'btn primary' : 'btn', type: 'button', onClick: click }, label)
/** Same back link as the run dashboard's "← All runs", so the way back looks the same on every run screen. */
const backLink = (click: () => void): HTMLButtonElement => h('button', { class: 'orch-back', type: 'button', onClick: click }, '‹ Back to run')

/** Saved specs and static, isolated mockups. Draft feedback survives navigation between runs. */
export class OrchSpecView {
  readonly el = h('section', { class: 'orch-section orch-spec', 'aria-label': 'Spec review' })
  private readonly drafts = new Map<string, Draft>()
  private runId = ''
  private title = ''
  private signature = ''
  private decision: OrchDecisionView | null = null
  private view: SpecViewData | null = null
  private selected: OrchSpecContent | null = null
  private mockup = ''
  private width = 1280
  private request = 0
  private submitting = false
  private readonly resize = new ResizeObserver(() => this.scalePreview())

  update(state: AppState): void {
    const runId = state.orchRunId ?? ''
    const decision = state.orch?.decisions.find((d) => d.runId === runId && d.kind === 'spec-approval') ?? null
    this.title = state.orch?.runs.find((r) => r.id === runId)?.title ?? 'Spec review'
    this.decision = decision
    const signature = JSON.stringify([runId, decision?.id ?? null])
    if (signature === this.signature) return
    this.signature = signature
    this.runId = runId
    this.view = null
    this.selected = null
    this.el.replaceChildren(h('p', { class: 'orch-muted', role: 'status' }, 'Loading spec…'))
    void this.load(runId)
  }

  private async load(runId: string): Promise<void> {
    const request = ++this.request
    try {
      const view = await api.orchSpec(runId)
      if (request !== this.request) return
      this.view = view
      this.selected = view?.current ?? null
      if (!view) this.signature = '' // A later snapshot notification retries the empty state.
      this.render()
    } catch {
      if (request !== this.request) return
      toast('The spec could not be loaded. Try again.', 'error')
      this.el.replaceChildren(backLink(() => showOrch('runs', runId)), h('p', { role: 'alert' }, 'The spec could not be loaded.'), button('Retry', () => void this.load(runId)))
    }
  }

  private draft(): Draft {
    let draft = this.drafts.get(this.runId)
    if (!draft) {
      draft = { comments: [], text: '', target: 'spec', note: '' }
      this.drafts.set(this.runId, draft)
    }
    return draft
  }

  private render(): void {
    this.resize.disconnect()
    clear(this.el)
    this.el.append(backLink(() => showOrch('runs', this.runId)), h('h2', {}, `Spec review · ${this.title}`))
    const content = this.selected
    if (!this.view || !content) {
      this.el.append(h('div', { class: 'orch-empty' }, 'The spec writer has not finished yet.'), button('Refresh', () => void this.load(this.runId)))
      return
    }
    const version = this.view.versions.find((v) => v.version === content.version)
    const picker = h('select', { class: 'text-input', 'aria-label': 'Spec version', disabled: this.submitting })
    for (const v of this.view.versions) picker.append(h('option', { value: v.version, selected: v.version === content.version }, `v${v.version}${v.version === this.view.current.version ? ' · current' : ''}`))
    picker.addEventListener('change', () => void this.pickVersion(Number(picker.value)))
    const doc = h('article', { class: 'spec-markdown', 'aria-label': 'Spec Markdown' })
    doc.innerHTML = renderMarkdown(content.spec)
    this.el.append(
      h('div', { class: 'spec-columns' },
        h('section', { class: 'orch-panel spec-document' }, h('div', { class: 'spec-toolbar' }, h('h3', {}, 'spec.md'), h('span', {}, 'Version ', selectMenu(picker))),
          h('p', { class: 'spec-question' }, this.decision?.question ?? 'Saved spec and mockups'), doc,
          version?.answer ? h('p', { class: 'spec-answer' }, `Answer on v${version.version}: ${version.answer}`) : null),
        this.preview(content)),
    )
    if (this.decision) {
      const latest = content.version === this.view.current.version && version?.decisionId === this.decision.id
      if (latest) this.el.append(this.comments(content))
      else this.el.append(h('p', { class: 'orch-muted' }, 'Select the current version to respond.'))
      const approve = button('Approve spec & mockups', () => void this.send(true), true)
      const changes = button('Request changes', () => void this.send(false))
      approve.disabled = changes.disabled = !latest || this.submitting
      this.el.append(h('div', { class: 'spec-actions' }, changes, approve))
    } else this.el.append(h('p', { class: 'orch-muted' }, 'Read-only · no spec approval is waiting.'))
  }

  private async pickVersion(version: number): Promise<void> {
    const request = ++this.request
    try {
      const content = await api.orchSpecVersion(this.runId, version)
      if (request !== this.request) return
      if (!content) throw new Error('missing')
      this.selected = content
      this.render()
    } catch {
      if (request === this.request) { toast('That spec version could not be loaded.', 'error'); this.render() }
    }
  }

  private preview(content: OrchSpecContent): HTMLElement {
    const chips = h('div', { class: 'spec-toolbar', role: 'group', 'aria-label': 'Mockups' })
    if (!content.mockups.some((m) => m.name === this.mockup)) this.mockup = content.mockups[0]?.name ?? ''
    for (const m of content.mockups) {
      const chip = button(m.name, () => { this.mockup = m.name; this.render() })
      chip.setAttribute('aria-pressed', String(m.name === this.mockup))
      chips.append(chip)
    }
    const sizes = h('div', { class: 'spec-toolbar', role: 'group', 'aria-label': 'Preview size' })
    for (const [label, width] of [['Desktop', 1280], ['Phone', 390]] as const) {
      const toggle = button(label, () => { this.width = width; this.render() })
      toggle.setAttribute('aria-pressed', String(this.width === width))
      sizes.append(toggle)
    }
    const mockup = content.mockups.find((m) => m.name === this.mockup)
    const viewport = h('div', { class: 'spec-viewport' })
    if (mockup) {
      const frame = h('iframe', { sandbox: '', title: `Mockup ${mockup.name}`, referrerpolicy: 'no-referrer' })
      // A sandbox removes scripts and same-origin; CSP also prevents subresource requests.
      frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">${mockup.html}`
      frame.style.width = `${this.width}px`
      viewport.append(frame)
      this.resize.observe(viewport)
    } else viewport.append(h('p', { class: 'orch-muted' }, 'No mockups were supplied.'))
    return h('section', { class: 'orch-panel spec-mockups' }, h('h3', {}, 'Mockups'), sizes, chips, viewport)
  }

  private scalePreview(): void {
    const viewport = this.el.querySelector<HTMLElement>('.spec-viewport')
    const frame = viewport?.querySelector('iframe')
    if (!viewport || !frame) return
    const scale = Math.min(1, viewport.clientWidth / this.width)
    frame.style.transform = `scale(${scale})`
    viewport.style.height = `${720 * scale}px`
  }

  private comments(content: OrchSpecContent): HTMLElement {
    const draft = this.draft()
    const target = h('select', { class: 'text-input', 'aria-label': 'Comment target' }, h('option', { value: 'spec' }, 'Spec'), ...content.mockups.map((m) => h('option', { value: m.name }, m.name)))
    target.value = content.mockups.some((m) => m.name === draft.target) ? draft.target : 'spec'
    draft.target = target.value
    target.addEventListener('change', () => { draft.target = target.value })
    const text = h('textarea', { class: 'text-input', rows: 2, 'aria-label': 'Comment text', maxlength: 3500 })
    text.value = draft.text
    text.addEventListener('input', () => { draft.text = text.value })
    const note = h('textarea', { class: 'text-input', rows: 2, 'aria-label': 'Review note', maxlength: 3500 })
    note.value = draft.note
    note.addEventListener('input', () => { draft.note = note.value })
    return h('section', { class: 'orch-panel spec-comments' }, h('h3', {}, 'Your comments'),
      h('div', {}, 'Target ', selectMenu(target)), h('label', {}, 'Comment ', text),
      button('Add comment', () => {
        if (!text.value.trim()) { text.focus(); return }
        draft.comments = [...draft.comments, { target: target.value, text: text.value.trim() }]
        draft.text = ''
        this.render()
      }),
      h('ul', {}, ...draft.comments.map((c, i) => {
        const remove = button('Remove', () => { draft.comments = draft.comments.filter((_, index) => index !== i); this.render() })
        remove.classList.add('small')
        remove.setAttribute('aria-label', `Remove comment ${i + 1}: ${c.text}`)
        return h('li', {}, h('span', {}, `[${c.target}] ${c.text}`), remove)
      })),
      h('label', {}, 'Note (optional) ', note))
  }

  private async send(approve: boolean): Promise<void> {
    const decision = this.decision
    if (!decision || this.submitting) return
    const draft = this.draft()
    const comments = draft.text.trim() ? [...draft.comments, { target: draft.target, text: draft.text }] : draft.comments
    const answer = approve ? 'Approve' : formatSpecComments(comments, draft.note)
    if (!answer) { toast('Add a comment or a note to request changes.', 'info'); return }
    if (answer.length > 4000) { toast('Keep your feedback under 4,000 characters.', 'error'); return }
    this.submitting = true
    this.render()
    try {
      if (await answerDecision(decision.id, answer)) {
        this.drafts.delete(decision.runId)
        this.signature = ''
        showOrch('runs', decision.runId)
      }
    } catch { toast('The answer could not be sent. Try again.', 'error') }
    finally { this.submitting = false; this.render() }
  }
}
