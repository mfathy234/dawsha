import type { ApprovalKind } from './approvals'

export const REMOTE_CAPABILITIES = ['commands', 'answers', 'messages', 'sessions', 'fullOutput'] as const

export type RemoteCapability = (typeof REMOTE_CAPABILITIES)[number]
export type RemoteCapabilities = Record<RemoteCapability, boolean>

export interface RemoteCapabilityInfo {
  label: string
  hint?: string
  confirm?: { title: string; body: string; confirmLabel: string }
}

export const REMOTE_CAPABILITY_INFO: Record<RemoteCapability, RemoteCapabilityInfo> = {
  commands: {
    label: 'Allow or deny commands',
    hint: 'Edits to CI and config files can only be denied from the phone.',
    confirm: {
      title: 'Let phones allow or deny commands?',
      body: 'A paired phone will be able to allow or deny the command or edit an agent is waiting on, from anywhere the phone can reach Dawsha. Allowing a prompt lets the agent run it on this computer.',
      confirmLabel: 'Allow commands from phones'
    }
  },
  answers: { label: 'Answer questions and plan approvals' },
  messages: {
    label: 'Send a message to a session',
    hint: 'This can send text and keys to the agent running in that session.'
  },
  sessions: {
    label: 'Start or resume sessions',
    hint: 'New and resumed agents inherit their Dawsha full-access setting.',
    confirm: {
      title: 'Allow phones to start sessions?',
      body: 'New and resumed agents inherit their existing Dawsha full-access setting. With full access enabled, an agent can read and change files and run commands in the project.',
      confirmLabel: 'Allow starting sessions'
    }
  },
  fullOutput: {
    label: 'Read full terminal output',
    hint: 'Off: the phone sees status lines and questions only.'
  }
}

export const defaultCapabilities = (): RemoteCapabilities =>
  Object.fromEntries(REMOTE_CAPABILITIES.map((capability) => [capability, false])) as RemoteCapabilities

export function sanitizeCapabilities(value: unknown, legacy?: Record<string, unknown>): RemoteCapabilities {
  const result = defaultCapabilities()
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    for (const capability of REMOTE_CAPABILITIES) result[capability] = record[capability] === true
    return result
  }
  if (legacy) {
    result.commands = legacy.approvals === true
    result.answers = legacy.approvals === true
    result.messages = legacy.terminalInput === true
    result.sessions = legacy.sessionControl === true
  }
  return result
}

export function isCapabilityPatch(value: unknown): value is Partial<RemoteCapabilities> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, flag]) => (REMOTE_CAPABILITIES as readonly string[]).includes(key) && typeof flag === 'boolean')
}

export function capabilityForApproval(kind: ApprovalKind): 'commands' | 'answers' {
  return kind === 'other' ? 'answers' : 'commands'
}

export function canAnswerApproval(capabilities: Pick<RemoteCapabilities, 'commands' | 'answers'>, kind: ApprovalKind): boolean {
  return capabilities[capabilityForApproval(kind)]
}
