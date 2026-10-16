import { describe, expect, it } from 'vitest'
import { runTitleFrom } from '../../src/shared/orch/runTitle'

describe('run title from the story', () => {
  it('keeps a short first sentence as it is', () => {
    expect(runTitleFrom('Hide the server dropdown. Then create the database ourselves.')).toBe('Hide the server dropdown.')
  })

  it('cuts a long sentence at a word boundary and ends it with an ellipsis', () => {
    const title = runTitleFrom('on a branch based on develop in the admin.client and adminportal.apis i need to hide the server dropdown')
    expect(title).toBe('on a branch based on develop in the admin.client and…')
    expect(title.length).toBeLessThanOrEqual(60)
  })

  it('uses only the first line and collapses spaces', () => {
    expect(runTitleFrom('  Export   usage\nas CSV')).toBe('Export usage')
  })
})
