import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('styles.css', () => {
  it('closes every rule it opens, so no later rule is swallowed', () => {
    const css = readFileSync(join(__dirname, '../../src/renderer/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    let depth = 0
    let line = 1
    for (const char of css) {
      if (char === '\n') line += 1
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      // Checked by hand first: two expect calls per character time out on a 5,000-line stylesheet.
      if (depth < 0) expect.fail(`unbalanced brace near line ${line}`)
      if (depth > 2) expect.fail(`a rule is still open near line ${line}`)
    }
    expect(depth).toBe(0)
  })
})
