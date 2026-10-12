import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decideWhatsNew,
  effectiveLastSeen,
  entriesUpTo,
  entryToMarkdown,
  parseChangelog
} from '../../src/shared/changelog'
import { extractSection } from '../../scripts/changelogSection.mjs'

const SAMPLE = `# Changelog

Intro text that is not an entry.

## [Unreleased]

### Added

- Not released yet.

## [0.4.0] - 2026-10-09

### Added

- First item that wraps
  onto a second line.
- Second item with a [link](https://github.com/mfathy234/dawsha/issues/1).

### Fixed

- A fix.

## [0.3.0] - 2026-10-08

### Changed

- Older change.

## [0.2.0] - 2026-10-01

### Added

- Oldest.

[0.4.0]: https://example.invalid/compare
`

describe('parseChangelog', () => {
  const entries = parseChangelog(SAMPLE)

  it('reads versions newest first and skips Unreleased', () => {
    expect(entries.map((e) => e.version)).toEqual(['0.4.0', '0.3.0', '0.2.0'])
    expect(entries[0].date).toBe('2026-10-09')
  })

  it('reads sections and joins wrapped bullets', () => {
    expect(entries[0].sections.map((s) => s.heading)).toEqual(['Added', 'Fixed'])
    expect(entries[0].sections[0].items).toEqual([
      'First item that wraps onto a second line.',
      'Second item with a [link](https://github.com/mfathy234/dawsha/issues/1).'
    ])
  })

  it('sorts a changelog written in the wrong order', () => {
    const shuffled = '## [0.1.0] - a\n\n### Added\n\n- x\n\n## [0.2.0] - b\n\n### Added\n\n- y\n'
    expect(parseChangelog(shuffled).map((e) => e.version)).toEqual(['0.2.0', '0.1.0'])
  })

  it('keeps a new release ahead of higher numbered legacy releases by date', () => {
    const changelog = '## [0.2.0] - 2026-10-11\n\n### Added\n\n- New.\n\n## [0.9.0] - 2026-10-09\n\n### Added\n\n- Legacy.\n'
    expect(parseChangelog(changelog).map((entry) => entry.version)).toEqual(['0.2.0', '0.9.0'])
  })

  it('returns nothing for text without entries', () => {
    expect(parseChangelog('just words')).toEqual([])
  })

  it('round-trips an entry to markdown', () => {
    expect(entryToMarkdown(entries[1])).toBe('### Changed\n- Older change.')
  })

  it('parses the real CHANGELOG.md of this repository', () => {
    const real = parseChangelog(readFileSync(resolve(__dirname, '../../CHANGELOG.md'), 'utf8'))
    expect(real.length).toBeGreaterThanOrEqual(3)
    expect(real.every((e) => e.sections.length > 0)).toBe(true)
  })
})

describe('entriesUpTo', () => {
  it('drops versions newer than the running one', () => {
    expect(entriesUpTo(parseChangelog(SAMPLE), '0.3.0').map((e) => e.version)).toEqual(['0.3.0', '0.2.0'])
  })
})

describe('decideWhatsNew', () => {
  const entries = parseChangelog(SAMPLE)

  it('records the version and shows nothing on a fresh install', () => {
    expect(decideWhatsNew('0.4.0', null, entries)).toEqual({ show: false, record: '0.4.0' })
  })

  it('does nothing when the version is unchanged', () => {
    expect(decideWhatsNew('0.4.0', '0.4.0', entries)).toEqual({ show: false, record: null })
  })

  it('shows the one version that is new after a single step', () => {
    const decision = decideWhatsNew('0.4.0', '0.3.0', entries)
    expect(decision.show).toBe(true)
    if (decision.show) {
      expect(decision.from).toBe('0.3.0')
      expect(decision.entries.map((e) => e.version)).toEqual(['0.4.0'])
    }
  })

  it('keeps archived legacy entries out of release notes', () => {
    const withLegacy = parseChangelog(`## [0.4.0] - 2026-10-12

### Added

- Current release.

## [0.4.0-legacy] - 2026-10-08

### Added

- Older development release.
`)
    const decision = decideWhatsNew('0.4.0', '0.3.0', withLegacy)
    expect(decision.show).toBe(true)
    if (decision.show) expect(decision.entries.map((entry) => entry.version)).toEqual(['0.4.0'])
  })

  it('shows every version in between after a multi-version jump, newest first', () => {
    const decision = decideWhatsNew('0.4.0', '0.2.0', entries)
    expect(decision.show).toBe(true)
    if (decision.show) expect(decision.entries.map((e) => e.version)).toEqual(['0.4.0', '0.3.0'])
  })

  it('does not list versions newer than the running one', () => {
    const decision = decideWhatsNew('0.3.0', '0.2.0', entries)
    expect(decision.show).toBe(true)
    if (decision.show) expect(decision.entries.map((e) => e.version)).toEqual(['0.3.0'])
  })

  it('records quietly on a downgrade or when the changelog has no matching entry', () => {
    expect(decideWhatsNew('0.3.0', '0.4.0', entries)).toEqual({ show: false, record: '0.3.0' })
    expect(decideWhatsNew('0.5.0', '0.4.0', entries)).toEqual({ show: false, record: '0.5.0' })
  })

  it('ignores a corrupt stored version', () => {
    expect(decideWhatsNew('0.4.0', 'banana', entries)).toEqual({ show: false, record: '0.4.0' })
  })

  it('shows the new version to a manual upgrade from 0.3.0 that has no stored version', () => {
    const decision = decideWhatsNew('0.4.0', effectiveLastSeen(null, true), entries)
    expect(decision.show).toBe(true)
    if (decision.show) expect(decision.entries.map((e) => e.version)).toEqual(['0.4.0'])
  })
})

describe('effectiveLastSeen', () => {
  it('returns the stored version when present', () => {
    expect(effectiveLastSeen('0.2.0', true)).toBe('0.2.0')
    expect(effectiveLastSeen('0.2.0', false)).toBe('0.2.0')
  })

  it('falls back to 0.3.0 when missing but the install already has data', () => {
    expect(effectiveLastSeen(null, true)).toBe('0.3.0')
  })

  it('returns null when missing on a fresh install', () => {
    expect(effectiveLastSeen(null, false)).toBeNull()
  })
})

describe('extractSection', () => {
  it('returns the body of one version without its heading', () => {
    expect(extractSection(SAMPLE, '0.3.0')).toBe('### Changed\n\n- Older change.')
    expect(extractSection(SAMPLE, 'v0.3.0')).toBe('### Changed\n\n- Older change.')
  })

  it('stops at the next entry and returns null for a missing version', () => {
    expect(extractSection(SAMPLE, '0.2.0')).toContain('Oldest.')
    expect(extractSection(SAMPLE, '0.4.0')).not.toContain('Older change')
    expect(extractSection(SAMPLE, '9.9.9')).toBeNull()
  })
})
