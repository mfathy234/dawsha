import { describe, expect, it } from 'vitest'
import { checkVersions, expectedAssets, siteVersion } from '../../scripts/release-check.mjs'

describe('release check', () => {
  it('accepts matching package, requested and top changelog versions', () => {
    expect(checkVersions('1.7.4', '## [1.7.4] - 2026-10-29\n\n## [1.7.3]', '1.7.4').ok).toBe(true)
  })

  it('rejects a mismatched package or requested version', () => {
    expect(checkVersions('1.7.3', '## [1.7.4]', '1.7.4').ok).toBe(false)
    expect(checkVersions('1.7.4', '## [1.7.4]', '1.7.5').ok).toBe(false)
  })

  it('checks the first release entry rather than finding an older match', () => {
    expect(checkVersions('1.7.4', '## [Unreleased]\n\n## [1.7.5]\n\n## [1.7.4]', '1.7.4').ok).toBe(false)
    expect(checkVersions('1.7.4', '## [Unreleased]\n\n## [1.7.4]', '1.7.4').ok).toBe(true)
    expect(checkVersions('1.7.4', '# Changelog', '1.7.4').ok).toBe(false)
    expect(checkVersions('1.7.4', '## [1.8.0-rc.1]\n\n## [1.7.4]', '1.7.4').ok).toBe(false)
  })

  it('rejects invalid version arguments', () => {
    for (const version of ['--help', '1.7', 'v1.7.4', '1.7.4/other']) {
      expect(checkVersions(version, `## [${version}]`, version).ok).toBe(false)
    }
  })

  it('requires all platform packages and update manifests with the exact release version', () => {
    expect(expectedAssets('1.7.5')).toEqual([
      'Dawsha-Setup-1.7.5.exe',
      'Dawsha-Portable-1.7.5.exe',
      'Dawsha-1.7.5-mac-arm64.dmg',
      'Dawsha-1.7.5-mac-arm64.zip',
      'Dawsha-1.7.5-linux-x86_64.AppImage',
      'Dawsha-1.7.5-linux-amd64.deb',
      'latest.yml', 'latest-mac.yml', 'latest-linux.yml'
    ])
  })

  it('reads the New in heading, ignoring navigation links and patch versions', () => {
    expect(siteVersion('<a>New in 9.9</a><h2 id="new-h">New in 1.7.4</h2>')).toBe('1.7')
    expect(siteVersion('<h2>New in 1.8</h2>')).toBe('1.8')
    expect(siteVersion('<a>New in 1.7</a>')).toBeNull()
  })
})
