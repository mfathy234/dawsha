import type { AgentKind } from '../shared/types'
import claudeLogo from './assets/brand/claude.svg?raw'
import geminiLogo from './assets/brand/googlegemini.svg?raw'
import openaiLogo from './assets/brand/openai.svg?raw'

const BRAND_LOGOS: Partial<Record<AgentKind, string>> = {
  claude: claudeLogo.replace(/<title>[^<]*<\/title>/, ''),
  codex: openaiLogo.replace(/<title>[^<]*<\/title>/, ''),
  gemini: geminiLogo.replace(/<title>[^<]*<\/title>/, '')
}

export const brandLogo = (agent: AgentKind): string | undefined => BRAND_LOGOS[agent]
