// Wording sources (CLI banners as printed, checked against public reports):
//  Claude Code: claude-code issues about "Claude usage limit reached. Your limit will reset at 5pm",
//    "5-hour limit reached ∙ resets 3pm", "You've hit your limit", "Credit balance is too low",
//    "Invalid API key · Please run /login", "API Error: 429 ... rate_limit_error".
//  Codex CLI: github.com/openai/codex/issues/2669 ("You've hit your usage limit. Upgrade to Pro (...)
//    or try again in 2 days 20 hours 44 minutes."), discussions/2251, "stream error: exceeded retry limit,
//    last status: 429 Too Many Requests".
//  Gemini CLI: github.com/google-gemini/gemini-cli issues 10722, 13112, 8437 ("Resource exhausted. Please try
//    again later", RESOURCE_EXHAUSTED, "Quota exceeded for quota metric", "You have exhausted your capacity
//    on this model. Your quota will reset after 3h20m5s", and the fallback notice "Possible quota
//    limitations in place or slow response times detected. Switching to the gemini-2.5-flash model", which is not a hit).

export type LimitRunner = 'claude' | 'codex' | 'gemini'
export interface LimitHit {
  kind: 'usage-limit' | 'rate-limit' | 'quota' | 'auth'
  message: string
  resetsAt: string | null
}

type Kind = LimitHit['kind']

const PATTERNS: Record<LimitRunner, Array<[Kind, RegExp]>> = {
  claude: [
    ['usage-limit', /^\W*(claude )?(ai )?usage limit reached/i],
    ['usage-limit', /\b\d+-hour limit reached\b/i],
    ['usage-limit', /^\W*(weekly|session|opus) limit reached/i],
    ['usage-limit', /^\W*you['’]ve hit your (\w+ )?limit/i],
    ['rate-limit', /^\W*api error:? [(]?429/i],
    ['rate-limit', /"type"\s*:\s*"rate_limit_error"/],
    ['quota', /^\W*credit balance is too low/i],
    ['auth', /\binvalid api key\b.*\/login/i],
    ['auth', /^\W*(oauth token has expired|api error:? 401)/i]
  ],
  codex: [
    ['usage-limit', /^\W*you['’]ve hit your usage limit/i],
    ['rate-limit', /stream error: exceeded retry limit, last status: 429/i],
    ['rate-limit', /^\W*you['’]ve reached your rate limit/i],
    ['quota', /^\W*(error:? )?quota exceeded\b/i],
    ['quota', /^\W*(error:? )?you exceeded your current quota/i],
    ['auth', /your access token could not be refreshed|^[^\w]*not logged in\b/i]
  ],
  gemini: [
    ['quota', /\bquota exceeded for (quota )?metric\b/i],
    ['quota', /^\W*you have exhausted your capacity on this model/i],
    ['quota', /^\W*you have reached your daily quota/i],
    ['usage-limit', /^\W*usage limit reached for all/i],
    ['rate-limit', /^\W*api error:.*(429|resource_exhausted)/i],
    ['rate-limit', /^\W*resource exhausted\. please try again later/i],
    ['auth', /^\W*(api error:.*)?(api key not valid|please set an auth method)/i]
  ]
}

const RESET = /(?:resets?|try again|retry)\s+(?:at|in|after|on)?\s*([^.∙·•|()]+?)\s*(?:\.(?:\s|$)|[∙·•|(]|$)/i
const MAX_MESSAGE = 200

export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\x5c)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\x5c-_]/g, '')
}

function cleanLines(text: string): string[] {
  return stripAnsi(text)
    .replace(/[─-╿]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function resetOf(line: string, next: string | undefined): string | null {
  const found = RESET.exec(line) ?? (next ? RESET.exec(next) : null)
  return found ? found[1].slice(0, 40) : null
}

export function detectLimit(runner: LimitRunner, text: string): LimitHit | null {
  const lines = cleanLines(text)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const match = PATTERNS[runner].find(([, re]) => re.test(line))
    if (!match) continue
    return {
      kind: match[0],
      message: line.replace(/^[^\w\[]+/, '').slice(0, MAX_MESSAGE),
      resetsAt: resetOf(line, lines[i + 1])
    }
  }
  return null
}
