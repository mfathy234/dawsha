import { MAX_FILE_CANDIDATES, findFilePaths, type FileMatch, type FileRef } from '../../shared/filePaths'
import { candidatePaths, splitByMatches, wholePath } from '../../shared/chatLinkText'
import { CHAT_TEXT } from '../../shared/chatStrings'
import { h, icon } from '../dom'
import { ICONS } from '../icons'
import { fileLinkHost } from '../terminalExtras'

const SKIP = 'a, button, pre, .chat-file, .chat-toolout'
const TTL_MS = 20_000
const OPEN_MODS = { ctrlKey: true, metaKey: false, shiftKey: false }

const known = new Map<string, { at: number; found: boolean }>()
const keyOf = (scope: string, path: string): string => `${scope}\n${path}`

function recall(scope: string, path: string, now: number): boolean | undefined {
  const hit = known.get(keyOf(scope, path))
  return hit && now - hit.at < TTL_MS ? hit.found : undefined
}

/** Asks which of these names are real files, in chunks the main side accepts, and remembers the answer for a while. */
async function resolve(scope: string, paths: readonly string[]): Promise<void> {
  const host = fileLinkHost(scope)
  const now = Date.now()
  const unknown = paths.filter((path) => recall(scope, path, now) === undefined)
  for (let from = 0; from < unknown.length; from += MAX_FILE_CANDIDATES) {
    const chunk = unknown.slice(from, from + MAX_FILE_CANDIDATES)
    const found = await host.existing(chunk).catch(() => chunk.map(() => null))
    if (known.size > 2000) known.clear()
    chunk.forEach((path, index) => known.set(keyOf(scope, path), { at: now, found: (found[index] ?? null) !== null }))
  }
}

function fileLink(scope: string, ref: FileRef, ...children: Node[]): HTMLElement {
  const host = fileLinkHost(scope)
  const link = h('a', { class: 'chat-file', role: 'link', tabindex: '0', title: ref.line ? `${ref.path}:${ref.line}` : ref.path, dir: 'ltr' }, ...children)
  link.addEventListener('click', (event) => {
    event.preventDefault()
    host.open(ref, OPEN_MODS)
  })
  link.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    host.open(ref, OPEN_MODS)
  })
  link.addEventListener('contextmenu', (event) => {
    event.preventDefault()
    host.menu(ref, event.clientX, event.clientY, () => link.focus())
  })
  return link
}

type Target = { kind: 'text'; node: Text; matches: FileMatch[] } | { kind: 'code'; node: HTMLElement; match: FileMatch }

function collect(root: HTMLElement): Target[] {
  const targets: Target[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    const parent = text.parentElement
    if (!parent || parent.closest(SKIP) !== null) continue
    if (parent.tagName === 'CODE') {
      const match = wholePath(text.data)
      if (match && parent.childNodes.length === 1) targets.push({ kind: 'code', node: parent, match })
      continue
    }
    const matches = findFilePaths(text.data)
    if (matches.length > 0) targets.push({ kind: 'text', node: text, matches })
  }
  return targets
}

function apply(target: Target, scope: string): void {
  if (!target.node.isConnected) return
  const now = Date.now()
  if (target.kind === 'code') {
    if (recall(scope, target.match.path, now) !== true) return
    const ref: FileRef = { path: target.match.path, ...(target.match.line ? { line: target.match.line } : {}) }
    target.node.replaceWith(fileLink(scope, ref, target.node.cloneNode(true)))
    return
  }
  const segments = splitByMatches(target.node.data, target.matches, (match) => recall(scope, match.path, now) === true)
  if (!segments.some((segment) => segment.kind === 'file')) return
  target.node.replaceWith(...segments.map((segment) => (segment.kind === 'text' ? document.createTextNode(segment.text) : fileLink(scope, segment.ref, document.createTextNode(segment.text)))))
}

/** Turns the file names in a drawn reply into links, for the names that really are files. Text is only ever read, never parsed as markup. */
export function linkifyChat(root: HTMLElement, scope: string): void {
  const targets = collect(root)
  if (targets.length === 0) return
  targets.forEach((target) => apply(target, scope))
  const wanted = targets.flatMap((target) => (target.kind === 'code' ? [target.match.path] : candidatePaths(target.matches)))
  const now = Date.now()
  const missing = [...new Set(wanted)].filter((path) => recall(scope, path, now) === undefined)
  if (missing.length === 0) return
  void resolve(scope, missing).then(() => targets.forEach((target) => apply(target, scope)))
}

/** The small button beside a tool row that opens the file the tool touched. */
export function openFileButton(scope: string, ref: FileRef): HTMLElement {
  const host = fileLinkHost(scope)
  return h(
    'button',
    {
      class: 'chat-tool-open',
      type: 'button',
      title: `${CHAT_TEXT.openFile}: ${ref.path}`,
      'aria-label': `${CHAT_TEXT.openFile}: ${ref.path}`,
      onClick: () => host.open(ref, OPEN_MODS),
      onContextmenu: (event: Event) => {
        const pointer = event as MouseEvent
        event.preventDefault()
        host.menu(ref, pointer.clientX, pointer.clientY, () => undefined)
      }
    },
    icon(ICONS.toolRead)
  )
}
