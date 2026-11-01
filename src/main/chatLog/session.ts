import type { ChatReadResult } from '../../shared/chatLog'
import type { TabAgent } from '../../shared/types'
import { CodexChatReader } from './codexReader'
import { ClaudeChatReader } from './claudeReader'
import { unrecognised, type ChatLineReader } from './reader'
import { LogTail } from './tail'

function createReader(agent: TabAgent): ChatLineReader {
  return agent === 'codex' ? new CodexChatReader() : new ClaudeChatReader()
}

/** The state of one session's log: the file position and what has been read from it. */
export class ChatSession {
  private reader: ChatLineReader
  private readonly tail: LogTail
  private counter = 0

  constructor(private readonly agent: TabAgent, maxBytes?: number) {
    this.reader = createReader(agent)
    this.tail = new LogTail(maxBytes)
  }

  get version(): string {
    return `${this.counter}`
  }

  /** Reads what the file gained; true when the thread changed. */
  async refresh(path: string): Promise<boolean> {
    const read = await this.tail.read(path)
    if (read.reset) this.reader = createReader(this.agent)
    if (read.text !== '') this.reader.feed(read.text)
    const changed = read.reset || read.text !== ''
    if (changed) this.counter += 1
    return changed
  }

  result(): ChatReadResult {
    if (unrecognised(this.reader.stats)) {
      return { status: 'failed', reason: 'Dawsha could not recognise this session log. The agent may have changed its format.' }
    }
    return { status: 'ok', items: this.reader.items(), version: this.version, earlier: this.reader.earlier }
  }
}
