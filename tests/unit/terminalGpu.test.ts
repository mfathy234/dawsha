import { expect, it, vi } from 'vitest'
import { releaseRenderer, reserveRenderer } from '../../src/renderer/terminalGpu'

it('evicts a hidden renderer before allocating a thirteenth context', () => {
  const release = vi.fn()
  for (let i = 0; i < 12; i++) expect(reserveRenderer(String(i), { visible: () => i !== 3, release: i === 3 ? release : vi.fn() })).toBe(true)
  expect(reserveRenderer('visible', { visible: () => true, release: vi.fn() })).toBe(true)
  expect(release).toHaveBeenCalledOnce()
  expect(reserveRenderer('extra', { visible: () => true, release: vi.fn() })).toBe(false)
  for (let i = 0; i < 12; i++) releaseRenderer(String(i))
  releaseRenderer('visible')
})
