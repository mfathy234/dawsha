import { ORCH_ROLES } from './types'

type PropSchema =
  | { type: 'string'; description: string; enum?: readonly string[] }
  | { type: 'number'; description: string }
  | { type: 'array'; description: string; items: { type: 'string' } }

export interface ToolSchema {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, PropSchema>; required: string[] }
}

const str = (description: string, values?: readonly string[]): PropSchema =>
  values ? { type: 'string', description, enum: values } : { type: 'string', description }
const list = (description: string): PropSchema => ({ type: 'array', description, items: { type: 'string' } })
const tool = (name: string, description: string, properties: Record<string, PropSchema> = {}, required: string[] = []): ToolSchema => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required }
})

// Descriptions are written for the agents: they are how a model learns when to call each tool.
export const TOOL_SCHEMAS: readonly ToolSchema[] = [
  tool('whoami', 'Your agent id, role, current task, and the run: its title, the full story the human wrote and the project path. Call this first.'),
  tool('list_agents', 'Everyone working on this run, with role, model and current task.'),
  tool('create_task', 'Lead only. Add a task to this run. Dawsha opens an agent for it when its dependencies are approved.', {
    title: str('Short imperative title.'),
    spec: str('Everything the agent needs: what to change, where, and constraints.'),
    role: str('Which role does it.', ORCH_ROLES),
    depends_on: list('Task keys (e.g. T-2) that must be approved first.'),
    acceptance: list('Testable acceptance criteria.')
  }, ['title', 'spec', 'role']),
  tool('list_tasks', 'Lead only. All tasks in this run with status and assignee.', {
    status: str('Only tasks with this status.')
  }),
  tool('get_my_task', 'Your current task, or the next one for your role that is ready. Read its spec, feedback and acceptance criteria before starting.'),
  tool('update_task', 'Report progress on your task in one or two sentences.', { progress: str('What you did and what is next.') }, ['progress']),
  tool('complete_task', 'Call when your task is finished. It then goes to review or to the human. Do not stop without calling this.', {
    summary: str('What you changed and why.'),
    files: list('Files you changed.'),
    branch: str('Branch with your commits, if any.'),
    tests: str('Tests you ran and their result.')
  }, ['summary']),
  tool('block_task', 'Stop work on your task because something outside your control is missing.', { reason: str('What is missing.') }, ['reason']),
  tool('submit_review', 'Reviewers only. Approve the work or send it back with specific comments.', {
    verdict: str('approve or reject.', ['approve', 'reject']),
    comments: str('What is wrong and how to fix it, or why it is fine.')
  }, ['verdict', 'comments']),
  tool('send_message', 'Send a message to another agent in this run (by agent id or role).', {
    to: str('Agent id or role name.'),
    body: str('The message.'),
    task: str('Related task key.')
  }, ['to', 'body']),
  tool('fetch_inbox', 'Unread messages for you, including reviewer comments and answers from the human. Marks them read.'),
  tool('put_note', 'Save a shared note (a decision or convention) every agent in this run can read.', {
    key: str('Short unique name.'),
    text: str('The note.')
  }, ['key', 'text']),
  tool('get_notes', 'All shared notes in this run, including answers the human gave.'),
  tool('ask_human', 'Ask the human to decide something instead of guessing. Your task pauses until they answer; the answer arrives in fetch_inbox.', {
    question: str('One clear question.'),
    options: list('The choices you see.'),
    recommended: { type: 'number', description: 'Index of the option you recommend.' },
    context: str('Code, file paths or facts the human needs to decide.'),
    urgency: str('normal or high.', ['normal', 'high'])
  }, ['question'])
]

export const MAX_STRING_LENGTH = 20_000
export const MAX_LIST_ITEMS = 50

const BY_NAME = new Map(TOOL_SCHEMAS.map((schema) => [schema.name, schema]))

export const toolSchema = (name: string): ToolSchema | undefined => BY_NAME.get(name)

/** Returns an error message for bad arguments, or null when they are valid. */
export function validateArgs(name: string, args: unknown): string | null {
  const schema = BY_NAME.get(name)
  if (!schema) return `Unknown tool ${name}.`
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return 'Arguments must be an object.'
  const values = args as Record<string, unknown>
  // Wrong values first: "verdict must be approve or reject" helps more than "comments is missing".
  for (const [key, prop] of Object.entries(schema.inputSchema.properties)) {
    const value = values[key]
    if (value === undefined || value === null) continue
    if (prop.type === 'array') {
      if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return `"${key}" must be a list of strings.`
      if (value.length > MAX_LIST_ITEMS) return `"${key}" can have at most ${MAX_LIST_ITEMS} items.`
      if (value.some((item) => item.length > MAX_STRING_LENGTH)) return `Items in "${key}" can be at most ${MAX_STRING_LENGTH} characters.`
    } else if (typeof value === 'string' && value.length > MAX_STRING_LENGTH) {
      return `"${key}" can be at most ${MAX_STRING_LENGTH} characters.`
    } else if (typeof value !== prop.type) {
      return `"${key}" must be a ${prop.type}.`
    } else if (prop.type === 'string' && prop.enum && !prop.enum.includes(value as string)) {
      return `"${key}" must be one of: ${prop.enum.join(', ')}.`
    }
  }
  for (const key of schema.inputSchema.required) {
    if (values[key] === undefined || values[key] === null || values[key] === '') return `Missing required argument "${key}".`
  }
  return null
}
