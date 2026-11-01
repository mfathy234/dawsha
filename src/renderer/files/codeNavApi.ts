import type { CodeNavRequest, CodeNavResult, CodeNavStatus, EditorConfigRules } from '../../shared/codeNav'
import { api } from '../api'

const message = (error: unknown): string => (error instanceof Error ? error.message : 'Code navigation is not available.')

// The engine can be missing or can fail to answer; every call here turns that into a plain result instead of a throw.

export async function requestCodeNav(folder: string, request: CodeNavRequest): Promise<CodeNavResult> {
  try {
    return await api.codeNav(folder, request)
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export async function requestStatus(folder: string, path: string): Promise<CodeNavStatus | null> {
  try {
    return await api.codeNavStatus(folder, path)
  } catch {
    return null
  }
}

export async function requestRestart(folder: string, path: string): Promise<string | null> {
  try {
    await api.codeNavRestart(folder, path)
    return null
  } catch (error) {
    return message(error)
  }
}

export async function requestInstall(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    return await api.codeNavInstall()
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export async function requestEditorConfig(folder: string, path: string): Promise<EditorConfigRules | null> {
  try {
    return await api.editorConfig(folder, path)
  } catch {
    return null
  }
}
