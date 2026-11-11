import { fileListText } from './chatStrings'
import { shortText } from './rewind'

const files = (count: number): string => `${count} file${count === 1 ? '' : 's'}`

/** Every word the rewind, edit and try-again features say. */
export const REWIND_TEXT = {
  edit: 'Edit',
  rewind: 'Rewind to here',
  tryAgain: 'Try another way',
  copy: 'Copy',
  copied: 'Copied',
  stopFirst: 'Stop the agent first',
  noSnapshot: 'No snapshot was taken before this message',
  actionsLabel: 'Message actions',
  nothingToPutBack: 'This message and the replies after it changed no files, so there is nothing to put back.',
  allChanged: 'Every file was changed after that, so none can be put back.',
  confirmTitle: (message: string): string => `Rewind to before “${shortText(message)}”?`,
  confirmBody: (count: number, time: string | null): string => `${count === 1 ? 'This file goes' : `These ${count} files go`} back to how ${count === 1 ? 'it was' : 'they were'} ${time ? `at ${time}` : 'before that message'}. Files you changed yourself after that are left alone.`,
  putBack: (count: number): string => `Put back ${files(count)}`,
  isNew: 'new, will be deleted',
  keptHeading: 'Changed since, kept',
  keptTag: 'changed since, kept',
  keptNote: (count: number): string => `${files(count)} changed after the snapshot and ${count === 1 ? 'was' : 'were'} left as ${count === 1 ? 'it is' : 'they are'}.`,
  rewound: (time: string | null, count: number): string => `Rewound to ${time ?? 'before that message'} · ${files(count)} put back`,
  redo: 'Redo',
  redoTitle: 'Redo the rewind?',
  redoBody: (names: readonly string[]): string => `Put ${fileListText(names)} back to how they were before the rewind?`,
  redoButton: (count: number): string => `Redo ${files(count)}`,
  rewindFailed: 'Could not rewind the files.',
  rewindInfoFailed: 'Could not check the files.',
  editFoot: (count: number): string => (count === 0 ? 'No files to put back. Sends the new text' : `Puts back ${files(count)} this and later replies changed, then sends`),
  editLabel: 'Edit message',
  cancel: 'Cancel',
  send: 'Send',
  tryTitle: (message: string): string => `Try another way from “${shortText(message)}”`,
  tryBody: (time: string | null): string => `A new session starts in its own worktree, with the files as they were ${time ? `at ${time}` : 'before that message'}. This session keeps going untouched.`,
  tryMessage: 'Message',
  tryBring: 'Bring the conversation up to this message',
  tryStart: (number: number): string => `Start try ${number}`,
  tryAgentLabel: 'Agent',
  tryEmpty: 'The message cannot be empty.',
  tryFailed: 'Could not start the new session.',
  tryFilesFailed: (path: string): string => `The worktree ${path} was made, but the files could not be copied into it.`,
  tryNoConversation: 'The conversation could not be saved, so the new session starts without it.',
  tried: (title: string, time: string | null): string => `Tried from “${title}”${time ? ` at ${time}` : ''}`,
  compare: (number: number): string => `Compare with try ${number}`
} as const
