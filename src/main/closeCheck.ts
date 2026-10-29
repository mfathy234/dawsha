import type { EventEmitter } from 'node:events'
import { IPC } from '../shared/ipc'
import type { QuitLog } from './quitLog'

const CLOSE_ACK_MS = 10_000
type Events = Pick<EventEmitter, 'once' | 'removeListener'>

/** Acknowledgement is bounded; once a user dialog opens, wait for its decision or a page crash. */
export function requestCloseCheck(ipc: Events, page: Events & { send(channel: string): void }, log: QuitLog): Promise<boolean> {
  log('close check requested')
  return new Promise((resolve) => {
    const finish = (_event?: unknown, ok?: unknown): void => {
      clearTimeout(ackTimer)
      ipc.removeListener(IPC.closeCheckAck, acknowledged)
      ipc.removeListener(IPC.closeCheckDone, finish)
      page.removeListener('destroyed', onGone)
      page.removeListener('render-process-gone', onGone)
      log(`close check ${ok === false ? 'cancelled' : 'approved'}`)
      resolve(ok !== false)
    }
    const acknowledged = (): void => {
      clearTimeout(ackTimer)
      log('close check acknowledged')
    }
    const onGone = (): void => finish(undefined, true)
    const ackTimer = setTimeout(() => {
      log('close check acknowledgement timed out')
      finish(undefined, true)
    }, CLOSE_ACK_MS)
    ipc.once(IPC.closeCheckAck, acknowledged)
    ipc.once(IPC.closeCheckDone, finish)
    page.once('destroyed', onGone)
    page.once('render-process-gone', onGone)
    page.send(IPC.closeCheck)
  })
}
