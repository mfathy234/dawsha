export type ToolKind = 'agent' | 'shell' | 'edit' | 'create' | 'read' | 'search' | 'web' | 'other'

const KINDS: Record<string, ToolKind> = {
  task: 'agent',
  agent: 'agent',
  collabagenttoolcall: 'agent',
  bash: 'shell',
  powershell: 'shell',
  shell: 'shell',
  shell_command: 'shell',
  exec_command: 'shell',
  local_shell: 'shell',
  run_shell_command: 'shell',
  execute_bash: 'shell',
  commandexecution: 'shell',
  edit: 'edit',
  multiedit: 'edit',
  notebookedit: 'edit',
  replace: 'edit',
  apply_patch: 'edit',
  applypatch: 'edit',
  filechange: 'edit',
  write: 'create',
  create_file: 'create',
  write_file: 'create',
  read: 'read',
  read_file: 'read',
  read_many_files: 'read',
  view: 'read',
  grep: 'search',
  glob: 'search',
  ls: 'search',
  list_directory: 'search',
  search_file_content: 'search',
  grep_search: 'search',
  websearch: 'web',
  web_search: 'web',
  websearchcall: 'web',
  webfetch: 'web',
  web_fetch: 'web',
  google_web_search: 'web'
}

/** What a tool call does, from the name an agent logs for it. Claude and Codex names map to the same kinds, so the same action looks the same. */
export function toolKind(name: unknown): ToolKind {
  if (typeof name !== 'string') return 'other'
  return KINDS[name.trim().toLowerCase()] ?? 'other'
}
