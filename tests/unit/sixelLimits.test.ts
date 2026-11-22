import { expect, it } from 'vitest'
import { sixelWithinLimits } from '../../src/shared/sixelLimits'

it('accepts normal sixel raster, repeat and line commands', () => {
  expect(sixelWithinLimits('"1;1;16;6#0;2;100;0;0#0!16~-!16~')).toBe(true)
  expect(sixelWithinLimits('#0;2;100;0;0!60~-!60~')).toBe(true)
  expect(sixelWithinLimits('"1;1;0;4096?')).toBe(true)
})

it('rejects zero-width rasters that would advance millions of terminal rows', () => {
  expect(sixelWithinLimits('"1;1;0;2147483647?')).toBe(false)
  expect(sixelWithinLimits('"1;1;0;000000000002147483647?')).toBe(false)
})

it('bounds declared dimensions, repeat counts and implicit image height', () => {
  expect(sixelWithinLimits('"1;1;4097;1~')).toBe(false)
  expect(sixelWithinLimits('"1;1;2001;2000~')).toBe(false)
  expect(sixelWithinLimits('"1;1;1;1~"1;1;0;2147483647?')).toBe(false)
  expect(sixelWithinLimits('!2147483647?')).toBe(false)
  expect(sixelWithinLimits('-'.repeat(683))).toBe(false)
  expect(sixelWithinLimits('"1;1;0;' + '0'.repeat(80) + '?')).toBe(false)
  expect(sixelWithinLimits('?'.repeat(8_000_001))).toBe(false)
})
