import { homedir } from 'node:os'
import { join } from 'node:path'

export const claudeHome = (): string =>
  process.env.DAWSHA_CLAUDE_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.claude')

export const claudeSettingsPath = (): string => join(claudeHome(), 'settings.json')

export const claudeProjectsDir = (): string => join(claudeHome(), 'projects')

export const bridgeDirs = (userData: string): { binDir: string; statusDir: string } => ({
  binDir: join(userData, 'bin'),
  statusDir: join(userData, 'status')
})

const roaming = (): string => process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')

export const opsDirs = (): string[] =>
  process.env.DAWSHA_OPS_DIR
    ? [process.env.DAWSHA_OPS_DIR]
    : [join(roaming(), 'dawsha', 'ops'), join(roaming(), 'claude-grid', 'ops')]

export const legacyUserDataDir = (): string | null => {
  return process.env.DAWSHA_LEGACY_USER_DATA ?? null
}

export const paneonUserDataDir = (): string =>
  process.env.DAWSHA_PANEON_USER_DATA ?? join(roaming(), 'Paneon')
