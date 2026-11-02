import { describe, expect, it } from 'vitest'
import { countLabel, MAX_STACKED_TOASTS, pushToast, removeToast, splitToast, toastKey, type ToastEntry, type ToastPush } from '../../src/shared/toastStack'

const add = (list: readonly ToastEntry[], id: number, message: string, kind: 'error' | 'info' = 'info'): ToastPush =>
  pushToast(list, { id, key: toastKey(kind, message), kind })

describe('toast stack', () => {
  it('splits a title from its detail', () => {
    expect(splitToast('Saved')).toEqual({ title: 'Saved', detail: '' })
    expect(splitToast('Failed\nDisk is full\nTry again')).toEqual({ title: 'Failed', detail: 'Disk is full\nTry again' })
  })

  it('folds identical toasts into one with a count and moves it to the newest place', () => {
    const first = add([], 1, 'Copied')
    const second = add(first.list, 2, 'Other')
    const third = add(second.list, 3, 'Copied')
    expect(third.repeated).toBe(1)
    expect(third.list.map((entry) => [entry.id, entry.count])).toEqual([[2, 1], [1, 2]])
    expect(third.dropped).toEqual([])
  })

  it('does not fold different kinds or different action labels', () => {
    expect(add(add([], 1, 'Same', 'info').list, 2, 'Same', 'error').list).toHaveLength(2)
    expect(toastKey('info', 'Closed', 'Reopen')).not.toBe(toastKey('info', 'Closed'))
  })

  it('keeps at most three and reports the oldest as dropped', () => {
    let list: readonly ToastEntry[] = []
    let dropped: readonly number[] = []
    for (let id = 1; id <= MAX_STACKED_TOASTS + 2; id += 1) {
      const pushed = add(list, id, `m${id}`)
      list = pushed.list
      dropped = pushed.dropped
    }
    expect(list.map((entry) => entry.id)).toEqual([3, 4, 5])
    expect(dropped).toEqual([2])
  })

  it('does not change the list it was given', () => {
    const list: readonly ToastEntry[] = Object.freeze([{ id: 1, key: 'k', kind: 'info' as const, count: 1 }])
    pushToast(list, { id: 2, key: 'k', kind: 'info' })
    expect(list[0].count).toBe(1)
    expect(removeToast(list, 1)).toEqual([])
  })

  it('labels counts only above one', () => {
    expect(countLabel(1)).toBe('')
    expect(countLabel(4)).toBe('×4')
  })
})
