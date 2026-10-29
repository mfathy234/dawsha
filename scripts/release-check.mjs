import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const VERSION = /^\d+\.\d+\.\d+$/

export function checkVersions(packageVersion, changelog, requestedVersion) {
  const top = [...changelog.matchAll(/^##\s+\[([^\]]+)\]/gm)]
    .map((match) => match[1]).find((entry) => entry.toLowerCase() !== 'unreleased')
  return {
    ok: VERSION.test(requestedVersion) && packageVersion === requestedVersion && top === requestedVersion,
    reason: `requested ${requestedVersion}, package.json ${packageVersion}, top CHANGELOG ${top ?? 'missing'}`
  }
}

export function expectedAssets(version) {
  return [
    `Dawsha-Setup-${version}.exe`,
    `Dawsha-Portable-${version}.exe`,
    `Dawsha-${version}-mac-arm64.dmg`,
    `Dawsha-${version}-mac-arm64.zip`,
    `Dawsha-${version}-linux-x86_64.AppImage`,
    `Dawsha-${version}-linux-amd64.deb`,
    'latest.yml', 'latest-mac.yml', 'latest-linux.yml'
  ]
}

export function siteVersion(html) {
  return /<h[1-6]\b[^>]*>\s*New in\s+(\d+\.\d+)(?:\.\d+)?\s*<\/h[1-6]>/i.exec(html)?.[1] ?? null
}

async function main() {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const command = (file, args) => execFileSync(file, args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
  let failed = false
  const check = async (label, work) => {
    try {
      const result = await work()
      console.log(`${result.ok ? '✓' : '✗'} ${label}: ${result.reason}`)
      if (!result.ok) failed = true
    } catch (error) {
      failed = true
      console.log(`✗ ${label}: ${String(error.stderr || error.message).trim().split(/\r?\n/)[0]}`)
    }
  }
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
  const version = process.argv[2] ?? pkg.version
  await check('Versions', () => checkVersions(pkg.version, readFileSync(resolve(cwd, 'CHANGELOG.md'), 'utf8'), version))
  if (!VERSION.test(version) || process.argv.length > 3) {
    console.log('✗ Arguments: usage: npm run release:check -- <major.minor.patch>')
    process.exitCode = 1
    return
  }
  const tag = `v${version}`
  let repo
  let mainSha
  let tagSha
  await check('Origin tag and main', () => {
    const remote = command('git', ['remote', 'get-url', 'origin'])
    repo = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote)?.[1]
    if (!repo) throw new Error('origin is not a GitHub repository')
    // ls-remote and the GitHub API inspect origin without fetching objects or updating local refs.
    const refs = new Map(command('git', ['ls-remote', 'origin', 'refs/heads/main', `refs/tags/${tag}`, `refs/tags/${tag}^{}`])
      .split(/\r?\n/).filter(Boolean).map((line) => {
        const [sha, ref] = line.split(/\s+/)
        return [ref, sha]
      }))
    mainSha = refs.get('refs/heads/main')
    tagSha = refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`)
    if (!mainSha || !tagSha) throw new Error(`${!mainSha ? 'main' : tag} is missing on origin`)
    const comparison = JSON.parse(command('gh', ['api', `repos/${repo}/compare/${tagSha}...${mainSha}`]))
    const ok = comparison.status === 'ahead' || comparison.status === 'identical'
    return { ok, reason: ok ? `${tag} points to a commit on origin/main` : `${tag} is not an ancestor of origin/main` }
  })
  const ghJson = (args) => {
    if (!repo) throw new Error('origin repository unavailable')
    return JSON.parse(command('gh', [...args, '--repo', repo]))
  }
  let release
  await check('Published release', () => {
    release = ghJson(['release', 'view', tag, '--json', 'tagName,isDraft,publishedAt,assets'])
    const ok = release.tagName === tag && !release.isDraft && Boolean(release.publishedAt)
    return { ok, reason: ok ? `${tag} is published` : `${tag} is not published` }
  })
  await check('Release assets', () => {
    if (!release) throw new Error('release unavailable')
    const names = new Set(release.assets.filter((asset) => asset.state === 'uploaded').map((asset) => asset.name))
    const missing = expectedAssets(version).filter((name) => !names.has(name))
    return { ok: missing.length === 0, reason: missing.length ? `missing ${missing.join(', ')}` : 'all 9 required assets uploaded' }
  })
  await check('Release workflow', () => {
    const [run] = ghJson(['run', 'list', '--workflow', 'release.yml', '--branch', tag, '--limit', '1', '--json', 'status,conclusion,headSha'])
    const ok = Boolean(run && tagSha && run.headSha === tagSha && run.status === 'completed' && run.conclusion === 'success')
    return { ok, reason: run ? `latest release.yml for ${tag}: ${run.status}/${run.conclusion || 'pending'}${run.headSha !== tagSha ? ' (commit differs from tag)' : ''}` : `no release.yml run for ${tag}` }
  })
  await check('Website HTTP', async () => {
    const response = await fetch('https://dawsha.pages.dev/', { signal: AbortSignal.timeout(30_000), redirect: 'manual' })
    await response.body?.cancel()
    return { ok: response.status === 200, reason: `https://dawsha.pages.dev/ returned ${response.status}` }
  })
  await check('Website New in', () => {
    if (!repo || !mainSha) throw new Error('origin/main unavailable')
    const content = JSON.parse(command('gh', ['api', `repos/${repo}/contents/site/index.html?ref=${mainSha}`]))
    const actual = siteVersion(Buffer.from(content.content, 'base64').toString('utf8'))
    const wanted = version.split('.').slice(0, 2).join('.')
    return { ok: actual === wanted, reason: `origin/main heading ${actual ?? 'missing'}, expected ${wanted}` }
  })
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`✗ Release check: ${error.message}`)
    process.exitCode = 1
  })
}
