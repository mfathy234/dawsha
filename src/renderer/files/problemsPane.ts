import { groupProblems, parseProblems, resolveProblemFile, type Problem, type ProblemSeverity } from '../../shared/problems'
import type { RunSnapshot } from '../../shared/runCommands'
import { h, icon } from '../dom'

export interface ProblemsHooks {
  /** A row was chosen: the file relative to the checkout folder and where in it. */
  open(path: string, line: number, column: number | undefined): void
  /** Send text to an agent's prompt without submitting it; the anchor places the session menu. */
  send(text: string, anchor: HTMLElement): void
}

/** A problem with its place in the checkout; path is null when the file is outside it, so the row is not a link. */
export interface RunProblem extends Problem {
  path: string | null
}

const SEND_ALL_MAX = 50
const RENDER_DELAY_MS = 120

const svg = (body: string): string => `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const SEVERITY_ICON: Record<ProblemSeverity, string> = {
  error: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6 M15 9l-6 6"/>'),
  warning: svg('<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5 M12 17.2v.3"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6 M12 7.5v.5"/>')
}
const SEVERITY_WORD: Record<ProblemSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' }
const SOURCE_NAME: Record<Problem['source'], string> = { typescript: 'TypeScript', eslint: 'ESLint', dotnet: '.NET', test: 'Test', generic: '' }

const baseName = (path: string): string => path.replace(/\\/g, '/').split('/').pop() ?? path
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

/** The tail changes as capped output rolls forward, even when its length stays fixed. */
export function runProblemsCacheKey(run: Pick<RunSnapshot, 'id' | 'output' | 'cwd'>): string {
  let hash = 2166136261
  for (let i = Math.max(0, run.output.length - 4096); i < run.output.length; i++) {
    hash = Math.imul(hash ^ run.output.charCodeAt(i), 16777619)
  }
  return `${run.id}|${run.output.length}|${hash >>> 0}|${run.cwd}`
}

/** The latest run of each command in this checkout: starting it again replaces the earlier run's problems. */
export function latestRuns(runs: readonly RunSnapshot[], folder: string | null): RunSnapshot[] {
  const latest = new Map<string, RunSnapshot>()
  for (const run of runs) if (run.folder === folder) latest.set(run.commandId, run)
  return [...latest.values()]
}

/** Problems for a run's output, with files placed in the checkout and anything outside it left unlinked. */
export function runProblems(run: Pick<RunSnapshot, 'output' | 'cwd' | 'folder'>): RunProblem[] {
  const inside = (file: string): boolean => resolveProblemFile(file, run.cwd, run.folder) !== null
  return parseProblems(run.output, { accepts: inside }).map((problem) => ({ ...problem, path: resolveProblemFile(problem.file, run.cwd, run.folder) }))
}

/** One line a coding agent can act on, with the file as an @mention when it is inside the project. */
export function problemLine(problem: RunProblem): string {
  const place = problem.path ? `@${problem.path}#L${problem.line}` : `${problem.file}:${problem.line}`
  const code = problem.code ? ` ${problem.code}` : ''
  return `${place} ${problem.severity}${code}: ${problem.message}`
}

export function problemsMessage(problems: readonly RunProblem[]): string {
  const shown = problems.slice(0, SEND_ALL_MAX)
  const more = problems.length > shown.length ? `\n(and ${problems.length - shown.length} more)` : ''
  if (shown.length === 1) return `Fix this problem from the run:\n${problemLine(shown[0])} `
  return `Fix these problems from the run:\n${shown.map((problem) => `- ${problemLine(problem)}`).join('\n')}${more} `
}

/** The Problems tab: what the latest runs reported, by file, each row opening the file at its line. */
export class ProblemsPane {
  readonly el = h('div', { class: 'files-problems', id: 'files-problems', role: 'tabpanel', hidden: true })
  private problems: RunProblem[] = []
  private readonly cache = new Map<string, RunProblem[]>()
  private timer: number | undefined
  private signature = ''

  constructor(private readonly hooks: ProblemsHooks, private readonly changed: (count: number) => void) {
    this.render()
  }

  get count(): number {
    return this.problems.length
  }

  /** Re-reads the runs; rendering waits a moment so streaming output does not rebuild the list on every chunk. */
  update(runs: readonly RunSnapshot[], folder: string | null): void {
    const current = latestRuns(runs, folder)
    const used = new Set<string>()
    const next: RunProblem[] = []
    for (const run of current) {
      const key = runProblemsCacheKey(run)
      used.add(key)
      let found = this.cache.get(key)
      if (!found) {
        found = runProblems(run)
        this.cache.set(key, found)
      }
      next.push(...found)
    }
    for (const key of [...this.cache.keys()]) if (!used.has(key)) this.cache.delete(key)
    const signature = JSON.stringify(next.map((problem) => [problem.path ?? problem.file, problem.line, problem.column, problem.message]))
    if (signature === this.signature) return
    this.signature = signature
    this.problems = next
    this.changed(next.length)
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.render(), next.length === 0 ? 0 : RENDER_DELAY_MS)
  }

  private render(): void {
    if (this.problems.length === 0) {
      this.el.replaceChildren(h('p', { class: 'files-side-empty', id: 'files-problems-empty' }, 'No problems. Errors and warnings from builds and tests will list here when a run reports them.'))
      return
    }
    const errors = this.problems.filter((problem) => problem.severity === 'error').length
    const warnings = this.problems.filter((problem) => problem.severity === 'warning').length
    const summary = [errors > 0 ? plural(errors, 'error') : '', warnings > 0 ? plural(warnings, 'warning') : ''].filter(Boolean).join(', ') || plural(this.problems.length, 'note')
    const sendAll = h('button', { class: 'btn small', type: 'button', id: 'files-problems-send-all', onClick: (event: Event) => this.hooks.send(problemsMessage(this.problems), event.currentTarget as HTMLElement) }, 'Send all')
    const groups = groupProblems(this.problems).flatMap((group) => {
      const first = group.items[0] as RunProblem
      return [
        h('div', { class: 'files-problems-file', role: 'presentation', title: first.path ?? first.file },
          h('span', { class: 'files-problems-path' }, first.path ?? first.file), h('span', { class: 'files-problems-count' }, String(group.items.length))),
        ...(group.items as RunProblem[]).map((problem) => this.row(problem))
      ]
    })
    this.el.replaceChildren(
      h('div', { class: 'files-problems-head' }, h('span', { class: 'files-problems-summary', id: 'files-problems-summary' }, summary), sendAll),
      h('div', { class: 'files-problems-list', role: 'list' }, ...groups))
  }

  private row(problem: RunProblem): HTMLElement {
    const where = `${baseName(problem.path ?? problem.file)}:${problem.line}`
    const source = [SOURCE_NAME[problem.source], problem.code].filter(Boolean).join(' ')
    const label = h('span', { class: 'files-problem-label' }, icon(SEVERITY_ICON[problem.severity]), h('span', { class: 'files-problem-word' }, SEVERITY_WORD[problem.severity]))
    const text = [
      h('span', { class: 'files-problem-where' }, where),
      h('span', { class: 'files-problem-message' }, problem.message),
      ...(source ? [h('span', { class: 'files-problem-source' }, source)] : [])
    ]
    const path = problem.path
    const open = path
      ? h('button', { class: 'files-problem-open', type: 'button', title: `Open ${path} at line ${problem.line}`, onClick: () => this.hooks.open(path, problem.line, problem.column) }, label, ...text)
      : h('span', { class: 'files-problem-open plain', title: 'This file is outside the project.' }, label, ...text)
    const send = h('button', { class: 'files-problem-send', type: 'button', title: 'Send to agent', onClick: (event: Event) => this.hooks.send(problemsMessage([problem]), event.currentTarget as HTMLElement) }, 'Send to agent')
    return h('div', { class: `files-problem sev-${problem.severity}`, role: 'listitem', 'data-severity': problem.severity, 'data-path': problem.path ?? '', 'data-line': String(problem.line) }, open, send)
  }
}
