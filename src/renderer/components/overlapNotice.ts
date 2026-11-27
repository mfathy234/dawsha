import { AGENT_NAMES } from '../../shared/agents'
import { overlapLine, overlapTell } from '../../shared/fileOverlap'
import { derivePanes, type PaneView } from '../derive'
import { h } from '../dom'
import { openReviewFileInFiles } from '../files/filesActions'
import { dismissOverlap, overlapWarningsFor } from '../overlap'
import { sendToSession } from '../sendToSession'
import { folderOfPane, paneById, store } from '../state'
import { toast } from './toast'
import './overlap.css'

/** A line over the bottom of a pane's terminal when another session in the same checkout changed a file this one also edits. */
export class OverlapNotice {
  readonly el = h('div', { class: 'overlap-notice', role: 'status', hidden: true })
  private signature = ''

  constructor(private readonly paneId: string) {}

  update(view: PaneView): void {
    const warning = overlapWarningsFor(this.paneId)[0]
    const other = warning ? derivePanes(store.state).find((candidate) => candidate.pane.id === warning.otherPaneId) : undefined
    if (!warning || !other) {
      this.el.hidden = true
      this.signature = ''
      return
    }
    const minutes = Math.floor((Date.now() - warning.at) / 60_000)
    const signature = `${warning.file}|${other.title}|${minutes}|${view.agent}`
    this.el.hidden = false
    if (signature === this.signature) return
    this.signature = signature
    const { file } = warning
    this.el.replaceChildren(
      h('span', { class: 'overlap-label' }, 'Also being edited'),
      h('span', { class: 'overlap-line', dir: 'auto', title: file }, overlapLine(file, warning.at, other.title, Date.now())),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => this.compare(file) }, 'Compare'),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => this.tell(file) }, `Tell ${AGENT_NAMES[view.agent === 'shell' ? 'claude' : view.agent]}`),
      h('button', { class: 'btn small ghost', type: 'button', 'aria-label': `Dismiss the warning about ${file}`, onClick: () => dismissOverlap(this.paneId, file) }, 'Dismiss')
    )
  }

  private compare(file: string): void {
    const pane = paneById(store.state, this.paneId)
    const folder = pane ? folderOfPane(store.state, pane) : null
    if (pane && folder) openReviewFileInFiles({ projectId: pane.projectId, folder }, file)
  }

  private tell(file: string): void {
    const refusal = sendToSession(this.paneId, overlapTell(file))
    if (refusal) toast(refusal)
    else dismissOverlap(this.paneId, file)
  }
}
