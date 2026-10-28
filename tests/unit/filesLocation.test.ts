import { describe, expect, it } from 'vitest'
import { branchLine, checkoutTitle, unavailableReason, type FilesCheckout } from '../../src/shared/filesWorkspace'

const checkout = (over: Partial<FilesCheckout> = {}): FilesCheckout => ({ folder: 'C:\\w\\acme-web-dark', branch: 'feat/dark-mode', head: 'abcdef1234', detached: false, unavailable: false, main: false, ...over })

describe('location button lines', () => {
  it('shows the branch and the worktree folder', () => {
    expect(branchLine(checkout())).toBe('feat/dark-mode · acme-web-dark')
  })
  it('shows a detached head with its short hash', () => {
    expect(branchLine(checkout({ detached: true, branch: '' }))).toBe('Detached · abcdef12 · acme-web-dark')
  })
  it('has no line for a folder without git or without a branch', () => {
    expect(branchLine(checkout(), false)).toBe('')
    expect(branchLine(checkout({ branch: '' }))).toBe('')
    expect(branchLine(undefined)).toBe('')
  })
})

describe('checkout menu entries', () => {
  it('names a checkout by branch, then by folder', () => {
    expect(checkoutTitle(checkout())).toBe('feat/dark-mode')
    expect(checkoutTitle(checkout({ branch: '' }))).toBe('acme-web-dark')
    expect(checkoutTitle(checkout({ detached: true }))).toBe('Detached · abcdef12')
  })
  it('gives a reason only for an unavailable checkout', () => {
    expect(unavailableReason(checkout())).toBe('')
    expect(unavailableReason(checkout({ unavailable: true }))).toMatch(/pruned/)
  })
})
