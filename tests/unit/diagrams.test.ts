import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseDiagramError, parseJavaVersion, sanitizeDiagramSvg } from '../../src/shared/diagrams'
import { diagramCacheKey, DiagramService, localPlantumlEnvironment, verifyJarHash } from '../../src/main/diagrams'

const folders: string[] = []
afterEach(async () => {
  delete process.env.DAWSHA_PLANTUML_FAKE_RENDERER
  delete process.env.DAWSHA_USER_DATA
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })))
})

describe('diagram helpers', () => {
  it('recognizes both modern OpenJDK and old Java version output', () => {
    expect(parseJavaVersion('openjdk version "21.0.5" 2024-10-15\nOpenJDK Runtime Environment')).toBe(21)
    expect(parseJavaVersion('java version "1.8.0_452"')).toBe(8)
    expect(parseJavaVersion('openjdk 21.0.7 2025-04-15')).toBe(21)
    expect(parseJavaVersion('java was not found')).toBeNull()
  })

  it('extracts PlantUML error lines from CLI and SVG descriptions', () => {
    expect(parseDiagramError('ERROR\n5\nSyntax Error?', '')).toMatchObject({ line: 6, error: expect.stringContaining('Syntax Error') })
    expect(parseDiagramError('Error line 12: unexpected token', '')).toMatchObject({ line: 12 })
    expect(parseDiagramError('', '<svg><text>[From string (line 7) ]</text><text>Syntax Error?</text></svg>')).toMatchObject({ line: 7 })
  })

  it('removes executable SVG and external resources but keeps local geometry', () => {
    const clean = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><a href="https://evil.invalid"><text>safe</text></a><image href="file:///secret"/><use xlink:href="#local"/><rect fill="red"/></svg>')
    expect(clean).toContain('<rect fill="red"/>')
    expect(clean).toContain('xlink:href="#local"')
    expect(clean).not.toMatch(/script|onload|foreignObject|https:\/\/evil|file:\/\/secret/)
  })

  it('removes SVG CSS network references and rejects entities', () => {
    expect(sanitizeDiagramSvg('<!DOCTYPE svg [<!ENTITY secret SYSTEM "file:///secret">]><svg>&secret;</svg>')).toBe('')
    expect(sanitizeDiagramSvg('<svg><style>@import "https://evil.invalid"; rect{fill:url(https://evil.invalid)}</style><rect style="fill:url(//evil.invalid)"/></svg>')).not.toContain('evil.invalid')
  })

  it('removes namespaced script nodes and obfuscated CSS before exporting SVG', () => {
    const source = String.raw`<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>alert(1)</s:script><style>rect { fill: \75rl(https://evil.invalid) }</style><rect style="fill:u&#114;l(https://evil.invalid)"/><s:foreignObject>bad</s:foreignObject></svg>`
    expect(sanitizeDiagramSvg(source)).not.toMatch(/script|alert|evil\.invalid|foreignObject/)
  })

  it('blocks commented CSS imports and every namespace alias for external links', () => {
    const clean = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:alt="http://www.w3.org/1999/xlink"><style>@import/**/"https://review.invalid/css";</style><image alt:href="https://review.invalid/image"/><rect fill="red"/></svg>')
    expect(clean).not.toContain('review.invalid')
    expect(clean).toContain('<rect fill="red"/>')
  })

  it('preserves safe Mermaid theme CSS and local marker references', () => {
    const clean = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>#flow .node rect{fill:#fff;stroke:#333} #flow .edge{marker-end:url(#arrow)}</style><defs><marker id="arrow"><path d="M0,0L1,1"/></marker></defs><path marker-end="url(#arrow)"/></svg>')
    expect(clean).toContain('fill:#fff;stroke:#333')
    expect(clean).toContain('marker-end:url(#arrow)')
    expect(clean).toContain('marker-end="url(#arrow)"')
  })

  it('rejects DTDs and malformed XML rather than repairing an ambiguous document', () => {
    for (const source of ['<!DOCTYPE svg><svg/>', '<svg><g></svg>', '<svg><rect fill=red /></svg>', '<svg/><svg/>', '<svg>&unknown;</svg>']) expect(sanitizeDiagramSvg(source)).toBe('')
  })

  it('copies only SVG elements and safe attributes regardless of namespace prefix', () => {
    const clean = sanitizeDiagramSvg('<svg xmlns="http://www.w3.org/2000/svg" xmlns:html="http://www.w3.org/1999/xhtml" xmlns:evil="https://evil.invalid"><html:script>alert(1)</html:script><evil:rect evil:onload="alert(1)"/><rect evil:onload="alert(1)" xml:base="https://evil.invalid" fill="url(https://evil.invalid)"/><use href="&#104;ttps://evil.invalid"/></svg>')
    expect(clean).not.toMatch(/alert|evil\.invalid|xml:base|html:|evil:|onload/)
    expect(clean).toContain('<rect')
  })

  it('clears inherited remote allowlists and JVM flags from the Java environment', () => {
    const env = { ...process.env }
    try {
      process.env['plantuml.allowlist.url'] = 'https://evil.invalid'
      process.env.PLANTUML_INCLUDE_PATH = '/outside/project'
      process.env.JAVA_TOOL_OPTIONS = '-DPLANTUML_SECURITY_PROFILE=UNSECURE'
      process.env.JDK_JAVA_OPTIONS = '-Dplantuml.allowlist.url=https://evil.invalid'
      const local = localPlantumlEnvironment()
      expect(local.PLANTUML_SECURITY_PROFILE).toBe('ALLOWLIST')
      expect(local['plantuml.allowlist.url']).toBeUndefined()
      expect(local.PLANTUML_INCLUDE_PATH).toBeUndefined()
      expect(local.JAVA_TOOL_OPTIONS).toBeUndefined()
      expect(local.JDK_JAVA_OPTIONS).toBeUndefined()
    } finally { process.env = env }
  })

  it('keys cache entries by text, origin, and jar identity', () => {
    const first = diagramCacheKey('hello', '/work/a', 'mit-1')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toBe(diagramCacheKey('hello', '/work/a', 'mit-1'))
    expect(first).not.toBe(diagramCacheKey('world', '/work/a', 'mit-1'))
    expect(first).not.toBe(diagramCacheKey('hello', '/work/b', 'mit-1'))
    expect(first).not.toBe(diagramCacheKey('hello', '/work/a', 'mit-2'))
  })

  it('verifies SHA-256 against actual jar bytes and refuses mismatches', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'dawsha-diagram-hash-'))
    folders.push(folder)
    const jar = join(folder, 'test.jar')
    await writeFile(jar, 'abc')
    expect(await verifyJarHash(jar, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(true)
    expect(await verifyJarHash(jar, '0'.repeat(64))).toBe(false)
  })
})

describe('local diagram service', () => {
  async function service(script: string): Promise<{ service: DiagramService; folder: string }> {
    const folder = await mkdtemp(join(tmpdir(), 'dawsha-diagram-service-'))
    folders.push(folder)
    const fake = join(folder, 'renderer.cjs')
    await writeFile(fake, script)
    process.env.DAWSHA_USER_DATA = folder
    process.env.DAWSHA_PLANTUML_FAKE_RENDERER = fake
    return { service: new DiagramService(folder, () => ''), folder }
  }

  it('identifies a missing configured jar so the preview can ask for a corrected path', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'dawsha-diagram-missing-'))
    folders.push(folder)
    const renderer = new DiagramService(folder, () => join(folder, 'missing.jar'))
    expect(await renderer.status()).toMatchObject({ jar: false, jarOverride: true })
  })

  it('renders UTF-8 locally, caches results and preserves the file folder', async () => {
    const { service: renderer, folder } = await service(`const fs = require('node:fs'); let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => text += x); process.stdin.on('end', () => { fs.appendFileSync('calls', 'x'); process.stdout.write('<svg xmlns="http://www.w3.org/2000/svg"><text>' + text + '</text></svg>') })`)
    expect(await renderer.status()).toMatchObject({ java: true, jar: true })
    const result = await renderer.render(folder, join(folder, 'flow.puml'), 'مرحبا')
    expect(result).toMatchObject({ ok: true, svg: expect.stringContaining('مرحبا') })
    expect(await renderer.render(folder, join(folder, 'flow.puml'), 'مرحبا')).toEqual(result)
    expect(await readFile(join(folder, 'calls'), 'utf8')).toBe('x')
  })

  it('renders separate PlantUML fences in one Markdown file without superseding each other', async () => {
    const { service: renderer, folder } = await service(`let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => text += x); process.stdin.on('end', () => process.stdout.write('<svg><text>' + text + '</text></svg>'))`)
    const first = renderer.render(folder, join(folder, 'readme.md'), 'first block', 2)
    const second = renderer.render(folder, join(folder, 'readme.md'), 'second block', 8)
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toMatchObject({ ok: true, svg: expect.stringContaining('first block') })
    expect(secondResult).toMatchObject({ ok: true, svg: expect.stringContaining('second block') })
  })

  it('reports renderer syntax errors with the source line', async () => {
    const { service: renderer, folder } = await service(String.raw`process.stdin.resume(); process.stdin.on('end', () => { process.stderr.write('ERROR\n4\nSyntax Error?'); process.exitCode=200 })`)
    expect(await renderer.render(folder, join(folder, 'broken.puml'), '@startuml\nbroken')).toMatchObject({ ok: false, line: 5, reason: 'render' })
  })

  it('bypasses cache for includes so edits in relative files are visible', async () => {
    const { service: renderer, folder } = await service(`const fs=require('node:fs'); process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('<svg><text>' + fs.readFileSync('included.txt', 'utf8') + '</text></svg>'))`)
    await writeFile(join(folder, 'included.txt'), 'first')
    expect(await renderer.render(folder, join(folder, 'main.puml'), '!include included.txt')).toMatchObject({ ok: true, svg: expect.stringContaining('first') })
    await writeFile(join(folder, 'included.txt'), 'second')
    expect(await renderer.render(folder, join(folder, 'main.puml'), '!include included.txt')).toMatchObject({ ok: true, svg: expect.stringContaining('second') })
  })

  it('rejects oversized source before running a renderer', async () => {
    const { service: renderer, folder } = await service('throw new Error("must not execute")')
    expect(await renderer.render(folder, join(folder, 'large.puml'), 'x'.repeat(1024 * 1024 + 1))).toMatchObject({ ok: false, error: expect.stringContaining('1 MB') })
  })
})
