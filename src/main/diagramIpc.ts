import { clipboard, dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { IPC } from '../shared/ipc'
import { DIAGRAM_EXPORT_MAX, diagramFileName, validDiagramPng } from '../shared/diagramExport'
import { sanitizeDiagramSvg } from '../shared/diagrams'
import { DiagramService } from './diagrams'
import { resolveProjectFile } from './gitWorkspace'

type Result = { ok: true } | { ok: false; error: string }
const failed = (error: string): Result => ({ ok: false, error })

/** Diagram text crosses only the local process boundary. No render request makes an HTTP call. */
export function registerDiagramIpc(options: {
  userData: string
  jarPath(): string
  known(folder: unknown): Promise<string | null>
  window(): BrowserWindow | null
}): void {
  const service = new DiagramService(options.userData, options.jarPath)
  ipcMain.handle(IPC.diagramStatus, () => service.status())
  ipcMain.handle(IPC.diagramDownload, () => service.download())
  ipcMain.handle(IPC.diagramRender, async (_event, folder: unknown, path: unknown, text: unknown, sourceLine: unknown) => {
    const root = await options.known(folder)
    if (!root || typeof text !== 'string') return failed('Choose a file in a known project.')
    const target = await resolveProjectFile(root, path)
    if (!target.ok) return failed(target.error)
    const block = typeof sourceLine === 'number' && Number.isInteger(sourceLine) && sourceLine > 0 && sourceLine <= 1_000_000 ? sourceLine : undefined
    return service.render(target.root, target.rel, text, block)
  })
  const svgOf = (value: unknown): string | null => {
    if (typeof value !== 'string' || Buffer.byteLength(value) > DIAGRAM_EXPORT_MAX) return null
    const svg = sanitizeDiagramSvg(value)
    return /<svg[\s>]/i.test(svg) ? svg : null
  }
  ipcMain.handle(IPC.diagramCopy, async (_event, value: unknown): Promise<Result> => {
    const svg = svgOf(value)
    if (!svg) return failed('This diagram could not be copied.')
    try {
      await clipboard.writeText(svg)
      return { ok: true }
    } catch {
      return failed('This diagram could not be copied to the clipboard.')
    }
  })
  ipcMain.handle(IPC.diagramSave, async (_event, name: unknown, value: unknown, png: unknown): Promise<Result> => {
    const svg = svgOf(value)
    if (!svg) return failed('This diagram could not be saved.')
    const config = {
      title: 'Save diagram as…',
      defaultPath: diagramFileName(typeof name === 'string' ? name : ''),
      filters: [
        { name: 'SVG image', extensions: ['svg'] },
        ...(validDiagramPng(png) ? [{ name: 'PNG image', extensions: ['png'] }] : [])
      ]
    }
    const parent = options.window()
    const picked = await (parent ? dialog.showSaveDialog(parent, config) : dialog.showSaveDialog(config))
    if (picked.canceled || !picked.filePath) return { ok: true }
    const asPng = extname(picked.filePath).toLowerCase() === '.png'
    if (asPng && !validDiagramPng(png)) return failed('This diagram could not be converted to PNG.')
    try {
      await writeFile(picked.filePath, asPng ? Buffer.from((png as string).split(',')[1], 'base64') : svg)
      return { ok: true }
    } catch (error) {
      return failed(`Could not save this diagram: ${(error as Error).message}`)
    }
  })
}
