import { api } from '../api'
import type {
  RunApi,
  RunCommand,
  RunCustomCommand,
  RunDiscovery,
  RunManager,
  RunSnapshot,
  RunTarget
} from '../../shared/runCommands'
import { selectMenu, syncSelectMenu } from './selectMenu'
import './runCommandsPanel.css'

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  el.className = className
  el.textContent = text
  return el
}
function button(
  id: string,
  text: string,
  action: () => void
): HTMLButtonElement {
  const el = element('button', 'run-button', text)
  el.id = id
  el.type = 'button'
  el.addEventListener('click', action)
  return el
}
function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = element('label', 'run-field')
  label.append(element('span', 'run-label', text), control)
  return label
}

export class RunCommandsPanel {
  readonly el = element('section', 'run-panel')
  private target: RunTarget | null = null
  private discovery: RunDiscovery | null = null
  private config: string | undefined
  private epoch = 0
  private runs: RunSnapshot[] = []
  private runsRevision = 0
  private selectedRun = ''
  private busy = false
  private readonly commands = element('select')
  private readonly manager = element('select')
  private readonly display = element('code', 'run-display')
  private readonly cwd = element('div', 'run-context')
  private readonly source = element('div', 'run-context')
  private readonly message = element('div', 'run-message')
  private readonly status = element('div', 'run-status')
  private readonly output = element('pre', 'run-output')
  private readonly editor = element('form', 'run-editor')
  private readonly nameInput = element('input')
  private readonly commandInput = element('textarea')
  private readonly cwdInput = element('input')
  private editingId = ''
  private readonly startButton: HTMLButtonElement
  private readonly restartButton: HTMLButtonElement
  private readonly stopButton: HTMLButtonElement
  private readonly editButton: HTMLButtonElement
  private readonly unsubscribe: () => void
  private readonly listeners = new Set<(runs: RunSnapshot[], selected: string) => void>()
  /** Esc or Ctrl+W inside the panel: the host minimises it. */
  dismiss: (() => void) | null = null
  constructor(private readonly runsApi: RunApi = api.runs) {
    this.el.hidden = true
    this.el.setAttribute('aria-label', 'Run commands')
    this.commands.id = 'run-command'
    this.commands.setAttribute('aria-label', 'Run command')
    this.commands.addEventListener('change', () => this.renderCommand())
    this.manager.id = 'run-manager'
    this.manager.setAttribute('aria-label', 'Package manager')
    for (const [value, text] of [
      ['', 'Detect package manager'],
      ['npm', 'npm'],
      ['pnpm', 'pnpm'],
      ['yarn', 'yarn'],
      ['bun', 'bun']
    ]) {
      const option = element('option', '', text)
      option.value = value
      this.manager.append(option)
    }
    this.manager.addEventListener('change', () => {
      void this.refresh()
    })
    const toolbar = element('div', 'run-toolbar')
    this.startButton = button('run-start', 'Run', () => {
      void this.start()
    })
    this.restartButton = button('run-restart', 'Restart', () => {
      void this.restart()
    })
    this.stopButton = button('run-stop', 'Stop', () => {
      void this.stop()
    })
    this.editButton = button('run-edit', 'Edit command', () =>
      this.edit(this.currentCommand())
    )
    toolbar.append(
      selectMenu(this.commands),
      this.startButton,
      this.restartButton,
      this.stopButton,
      this.editButton,
      button('run-add', 'Add command', () => this.edit()),
      button('run-choose-config', 'Choose solution/project', () => {
        void this.choose()
      }),
      button('run-refresh', 'Refresh', () => {
        void this.refresh()
      }),
      selectMenu(this.manager)
    )
    this.display.id = 'run-display'
    this.cwd.id = 'run-cwd'
    this.source.id = 'run-source'
    this.message.setAttribute('role', 'status')
    this.message.id = 'run-message'
    this.status.id = 'run-status'
    this.status.setAttribute('aria-live', 'polite')
    const runHeader = element('div', 'run-result-header')
    runHeader.append(this.status)
    this.output.id = 'run-output'
    this.output.tabIndex = 0
    this.output.setAttribute('aria-label', 'Run output')
    this.editor.hidden = true
    this.nameInput.required = true
    this.nameInput.maxLength = 200
    this.cwdInput.required = true
    this.nameInput.id = 'run-edit-name'
    this.commandInput.id = 'run-edit-command'
    this.cwdInput.id = 'run-edit-cwd'
    this.commandInput.required = true
    this.commandInput.maxLength = 8192
    this.commandInput.rows = 2
    const save = element('button', 'run-button', 'Save')
    save.type = 'submit'
    save.id = 'run-save'
    this.editor.append(
      labelled('Command name', this.nameInput),
      labelled('Command', this.commandInput),
      labelled('Working directory', this.cwdInput),
      element(
        'p',
        'run-context',
        'Saved edits run as your shell command. Use a working directory relative to this checkout.'
      ),
      save,
      button('run-edit-cancel', 'Cancel', () => {
        this.editor.hidden = true
      }),
      button('run-remove-override', 'Remove local override', () => {
        void this.removeOverride()
      })
    )
    this.editor.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.save()
    })
    this.el.append(
      toolbar,
      this.display,
      this.cwd,
      this.source,
      this.message,
      this.editor,
      runHeader,
      this.output
    )
    this.el.addEventListener('keydown', (event) => {
      // Run controls must not trigger the surrounding file editor's shortcuts.
      event.stopPropagation()
      if (event.isComposing) return
      const primary = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
      if (primary && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!this.editor.hidden) this.editor.requestSubmit()
        return
      }
      if (primary && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        this.dismiss?.()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!this.editor.hidden) this.editor.hidden = true
        else this.dismiss?.()
      }
    })
    this.unsubscribe = this.runsApi.onChanged((runs) => {
      this.runsRevision++
      this.runs = runs
      this.renderRuns()
    })
    void this.runsApi
      .list()
      .then((runs) => {
        if (this.runsRevision !== 0) return
        this.runs = runs
        this.renderRuns()
      })
      .catch((error) => this.error(error))
    this.renderCommand()
    this.renderRuns()
  }
  setTarget(target: RunTarget | null): void {
    if (
      this.target?.projectId === target?.projectId &&
      this.target?.folder === target?.folder
    )
      return
    this.target = target ? { ...target } : null
    this.config = undefined
    this.manager.value = ''
    syncSelectMenu(this.manager)
    this.discovery = null
    this.editor.hidden = true
    this.epoch++
    this.commands.replaceChildren()
    this.renderCommand()
    if (target) void this.refresh()
    else
      this.message.textContent =
        'Select a project and checkout to find run commands.'
  }
  show(): void {
    this.el.hidden = false
    if (this.target && !this.discovery) void this.refresh()
  }
  hide(): void {
    this.el.hidden = true
  }
  focusPicker(): void {
    this.commands.focus()
  }
  get runList(): readonly RunSnapshot[] {
    return this.runs
  }
  get selectedRunId(): string {
    return this.selectedRun
  }
  get targetFolder(): string | null {
    return this.target?.folder ?? null
  }
  selectRun(id: string): void {
    if (!this.runs.some((run) => run.id === id)) return
    this.selectedRun = id
    this.renderRuns()
  }
  onRuns(listener: (runs: RunSnapshot[], selected: string) => void): () => void {
    this.listeners.add(listener)
    listener(this.runs, this.selectedRun)
    return () => this.listeners.delete(listener)
  }
  dispose(): void {
    this.epoch++
    this.unsubscribe()
    this.el.remove()
  }
  private error(error: unknown): void {
    this.message.textContent =
      error instanceof Error
        ? error.message
        : 'Run command failed. Edit the command and try again.'
  }
  private currentCommand(): RunCommand | undefined {
    return this.discovery?.commands.find((c) => c.id === this.commands.value)
  }
  private async refresh(): Promise<void> {
    const target = this.target
    if (!target) return
    const epoch = ++this.epoch,
      previous = this.commands.value
    this.busy = true
    this.message.textContent = 'Finding run commands…'
    this.renderCommand()
    try {
      const result = await this.runsApi.discover({
        ...target,
        config: this.config,
        manager: this.manager.value
          ? (this.manager.value as RunManager)
          : undefined
      })
      if (epoch !== this.epoch) return
      this.discovery = result
      this.commands.replaceChildren()
      for (const command of result.commands) {
        const option = element('option', '', command.name)
        option.value = command.id
        this.commands.append(option)
      }
      if (result.commands.some((c) => c.id === previous))
        this.commands.value = previous
      syncSelectMenu(this.commands)
      this.message.textContent = [
        result.commands.length
          ? ''
          : 'No run commands found. Add command or choose solution/project.',
        ...result.warnings
      ]
        .filter(Boolean)
        .join('\n')
    } catch (error) {
      if (epoch === this.epoch) {
        this.discovery = null
        this.commands.replaceChildren()
        this.error(error)
      }
    } finally {
      if (epoch === this.epoch) {
        this.busy = false
        this.renderCommand()
      }
    }
  }
  private renderCommand(): void {
    const command = this.currentCommand()
    this.display.textContent = command?.display ?? ''
    this.cwd.textContent = this.target
      ? `Working directory: ${this.target.folder}${command && command.cwd !== '.' ? ` / ${command.cwd}` : ''}`
      : ''
    this.source.textContent = command
      ? `${command.source === 'Local override' ? 'Saved locally' : 'Detected from'} ${command.source === 'Local override' ? 'for this checkout' : command.source}`
      : ''
    this.startButton.disabled = !command || this.busy
    this.editButton.disabled = !command || this.busy
    this.commands.disabled = this.busy || !command
  }
  private renderRuns(): void {
    if (!this.runs.some((run) => run.id === this.selectedRun)) {
      const here = [...this.runs].reverse().find((run) => run.folder === this.target?.folder)
      this.selectedRun = here?.id ?? this.runs[this.runs.length - 1]?.id ?? ''
    }
    const run = this.runs.find((r) => r.id === this.selectedRun)
    const stick =
      this.output.scrollHeight -
        this.output.scrollTop -
        this.output.clientHeight <
      35
    this.output.textContent = run?.output ?? ''
    if (stick) this.output.scrollTop = this.output.scrollHeight
    this.status.textContent = run
      ? `${run.status}${run.exitCode === null ? '' : ` · exit ${run.exitCode}`} · ${run.cwd}`
      : 'No runs yet'
    this.status.dataset.state = run?.status ?? ''
    this.stopButton.disabled =
      !run || !['running', 'stopping'].includes(run.status)
    this.restartButton.disabled = !run || this.busy
    this.output.title = run ? `${run.display}
${run.cwd}` : ''
    for (const listener of this.listeners) listener(this.runs, this.selectedRun)
  }
  private async choose(): Promise<void> {
    const target = this.target,
      epoch = this.epoch
    if (!target) return
    try {
      const config = await this.runsApi.chooseConfig(target)
      if (config && epoch === this.epoch) {
        this.config = config
        await this.refresh()
      }
    } catch (error) {
      if (epoch === this.epoch) this.error(error)
    }
  }
  private edit(command?: RunCommand): void {
    if (!this.target) return
    this.editingId = command?.id ?? `custom:${crypto.randomUUID()}`
    this.nameInput.value = command?.name ?? ''
    this.commandInput.value = command?.display ?? ''
    this.cwdInput.value = command?.cwd ?? '.'
    this.editor.hidden = false
    this.nameInput.focus()
  }
  private async save(): Promise<void> {
    const target = this.target,
      epoch = this.epoch
    if (!target || !this.discovery) return
    const command: RunCustomCommand = {
      id: this.editingId,
      name: this.nameInput.value.trim(),
      cwd: this.cwdInput.value.trim(),
      shellCommand: this.commandInput.value.trim()
    }
    const overrides = [
      ...this.discovery.overrides.filter((c) => c.id !== command.id),
      command
    ]
    try {
      await this.runsApi.save(target, overrides)
      if (epoch === this.epoch) {
        this.editor.hidden = true
        await this.refresh()
        if (this.target !== target) return
        this.commands.value = command.id
        this.renderCommand()
      }
    } catch (error) {
      if (epoch === this.epoch) this.error(error)
    }
  }
  private async removeOverride(): Promise<void> {
    const target = this.target,
      epoch = this.epoch
    if (!target || !this.discovery) return
    try {
      await this.runsApi.save(
        target,
        this.discovery.overrides.filter((c) => c.id !== this.editingId)
      )
      if (epoch === this.epoch) {
        this.editor.hidden = true
        await this.refresh()
      }
    } catch (error) {
      if (epoch === this.epoch) this.error(error)
    }
  }
  private async start(): Promise<void> {
    if (!this.discovery || !this.currentCommand() || this.busy) return
    const target = this.target
    const existing = this.runs.find(
      (run) =>
        run.folder === target?.folder &&
        run.commandId === this.commands.value &&
        (run.status === 'running' || run.status === 'stopping')
    )
    if (existing) {
      this.selectedRun = existing.id
      this.renderRuns()
      this.message.textContent =
        'This command is already running. Stop it before running again.'
      return
    }
    this.busy = true
    this.renderCommand()
    try {
      const run = await this.runsApi.start({
        selectionId: this.discovery.selectionId,
        commandId: this.commands.value
      })
      this.selectedRun = run.id
      this.runs = [...this.runs.filter((old) => old.id !== run.id), run]
      this.renderRuns()
    } catch (error) {
      if (this.target === target) this.error(error)
    } finally {
      if (this.target === target) this.busy = false
      this.renderCommand()
    }
  }
  private async restart(): Promise<void> {
    const run = this.runs.find((r) => r.id === this.selectedRun)
    if (!run || this.busy) return
    if (run.folder !== this.target?.folder || !this.discovery?.commands.some((c) => c.id === run.commandId)) {
      this.message.textContent = 'Restart works from the checkout the command was started in.'
      return
    }
    this.commands.value = run.commandId
    this.renderCommand()
    if (['running', 'stopping'].includes(run.status)) {
      try {
        await this.runsApi.stop(run.id)
      } catch (error) {
        this.error(error)
        return
      }
      for (let waited = 0; waited < 50; waited += 1) {
        const now = this.runs.find((r) => r.id === run.id)
        if (!now || !['running', 'stopping'].includes(now.status)) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
    await this.start()
  }
  private async stop(): Promise<void> {
    if (!this.selectedRun) return
    try {
      await this.runsApi.stop(this.selectedRun)
    } catch (error) {
      this.error(error)
    }
  }
}
