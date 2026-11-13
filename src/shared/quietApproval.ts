const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep'])

/** The Quiet approval card's title: what the agent wants to do, in plain words. */
export function quietApprovalTitle(agentName: string, tool: string): string {
  if (tool === 'Bash') return `${agentName} wants to run a command`
  if (EDIT_TOOLS.has(tool)) return `${agentName} wants to edit a file`
  if (READ_TOOLS.has(tool)) return `${agentName} wants to read files`
  if (tool === 'WebFetch' || tool === 'WebSearch') return `${agentName} wants to use the web`
  return tool === '' || tool === 'Requested action' ? `${agentName} wants to continue` : `${agentName} wants to use ${tool}`
}
