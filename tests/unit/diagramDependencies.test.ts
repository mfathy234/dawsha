import { expect, it } from 'vitest'
import { diagramHasIncludes } from '../../src/shared/diagramDependencies'

it('recognizes local diagram includes in standalone and Markdown source', () => {
  expect(diagramHasIncludes('@startuml\n!include parts/common.iuml\n@enduml')).toBe(true)
  expect(diagramHasIncludes('```plantuml\n  !include_once common.puml\n```')).toBe(true)
  expect(diagramHasIncludes('@startuml\nAlice -> Bob: include files\n@enduml')).toBe(false)
})
