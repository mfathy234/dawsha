import { existsSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import type { Project } from '../shared/types'

const IMAGE_EXTENSIONS = new Set(['.png', '.svg', '.ico', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_ICON_BYTES = 2 * 1024 * 1024
const MISS_MS = 30_000
const ROOT_DIRS = ['', 'public', 'site', 'assets']
const SRC_DIRS = ['src']

const isIcon = (path: string): boolean => {
  try {
    const info = statSync(path)
    return info.isFile() && info.size > 0 && info.size <= MAX_ICON_BYTES && IMAGE_EXTENSIONS.has(extname(path).toLowerCase())
  } catch {
    return false
  }
}

function firstFile(dir: string, names: readonly string[]): string | null {
  for (const name of names) {
    const path = join(dir, name)
    if (existsSync(path) && isIcon(path)) return path
  }
  return null
}

/** The icon a project folder already ships: `.dawsha/icon`, then a favicon at the root or in public, site or assets, then build/icon.png, then a favicon one folder under src. Cheap: a handful of stat calls. */
export function findProjectIcon(folder: string): string | null {
  const own = firstFile(join(folder, '.dawsha'), ['icon.png', 'icon.svg'])
  if (own) return own
  for (const dir of ROOT_DIRS) {
    const found = firstFile(join(folder, dir), ['favicon.svg', 'favicon.ico', 'favicon.png'])
    if (found) return found
  }
  const build = firstFile(join(folder, 'build'), ['icon.png'])
  if (build) return build
  for (const dir of SRC_DIRS) {
    const root = join(folder, dir)
    const direct = firstFile(root, ['favicon.svg', 'favicon.ico', 'favicon.png'])
    if (direct) return direct
    const nested = nestedFavicon(root)
    if (nested) return nested
  }
  return null
}

function nestedFavicon(root: string): string | null {
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return null
  }
  for (const name of names.slice(0, 40)) {
    const found = firstFile(join(root, name), ['favicon.svg', 'favicon.ico', 'favicon.png'])
    if (found) return found
  }
  return null
}

type IconProject = Pick<Project, 'id' | 'name' | 'folder' | 'iconPath' | 'noIcon'>

/** Resolves and remembers each project's icon file; a changed name, folder or icon choice looks again. */
export class ProjectIcons {
  private readonly cache = new Map<string, { key: string; path: string | null; at: number }>()

  pathFor(project: IconProject): string | null {
    if (project.noIcon === true) return null
    const key = [project.name, project.folder, project.iconPath ?? ''].join('\0')
    const hit = this.cache.get(project.id)
    if (hit && hit.key === key && (hit.path === null ? Date.now() - hit.at < MISS_MS : existsSync(hit.path))) return hit.path
    const custom = project.iconPath && isIcon(project.iconPath) ? project.iconPath : null
    const path = custom ?? findProjectIcon(project.folder)
    this.cache.set(project.id, { key, path, at: Date.now() })
    return path
  }
}
