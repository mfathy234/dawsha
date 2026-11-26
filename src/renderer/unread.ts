export type UnreadOf = (paneId: string) => boolean

let reader: UnreadOf = () => false

/** The one place the unread-reply state is read from; the sessions work plugs its selector in here. */
export const setUnreadOf = (next: UnreadOf): void => {
  reader = next
}

export const isUnread = (paneId: string): boolean => reader(paneId)
