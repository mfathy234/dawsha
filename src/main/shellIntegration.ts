import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LaunchSpec } from './agentLaunch'

let scriptFolder: string | undefined
function integrationFolder(): string {
  if (scriptFolder) return scriptFolder
  scriptFolder = mkdtempSync(join(tmpdir(), 'dawsha-shell-'))
  chmodSync(scriptFolder, 0o700)
  return scriptFolder
}

const POWERSHELL = String.raw`
$global:__DawshaPrompt = $function:prompt
$global:__DawshaReadLine = $function:PSConsoleHostReadLine
$global:__DawshaRan = $false
function global:PSConsoleHostReadLine {
  if ($global:__DawshaReadLine) { $line = & $global:__DawshaReadLine }
  else { $line = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($host.Runspace, $ExecutionContext) }
  if ([string]::IsNullOrWhiteSpace($line)) { return $line }
  $global:__DawshaRan = $true
  [Console]::Write(([char]27) + ']133;C' + [char]7)
  return $line
}
function global:prompt {
  $ok = $?
  $code = if ($ok) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }
  $esc = [char]27
  $bel = [char]7
  if ($global:__DawshaRan) { [Console]::Write("$esc]133;D;$code$bel") }
  $global:__DawshaRan = $false
  if ($PWD.Provider.Name -eq 'FileSystem') {
    $uri = [uri]::new($PWD.ProviderPath + [IO.Path]::DirectorySeparatorChar)
    [Console]::Write("$esc]7;$($uri.AbsoluteUri)$bel")
  }
  [Console]::Write("$esc]133;A$bel")
  if ($global:__DawshaPrompt) { $text = & $global:__DawshaPrompt } else { $text = "PS $PWD> " }
  return "$text$esc]133;B$bel"
}
`

const BASH = String.raw`
if [[ $DAWSHA_SHELL_LOGIN == 1 ]]; then
  [[ -f /etc/profile ]] && source /etc/profile
  for __dawsha_profile in ~/.bash_profile ~/.bash_login ~/.profile; do
    if [[ -f $__dawsha_profile ]]; then source "$__dawsha_profile"; break; fi
  done
else
  [[ -f ~/.bashrc ]] && source ~/.bashrc
fi
__dawsha_prompt() {
  local code=$?
  printf '\033]133;D;%s\007' "$code"
  local uri=$PWD
  uri=${'$'}{uri//%/%25}; uri=${'$'}{uri//#/%23}; uri=${'$'}{uri//\?/%3F}
  printf '\033]7;file://localhost%s\007\033]133;A\007' "$uri"
}
PROMPT_COMMAND=(__dawsha_prompt "${'$'}{PROMPT_COMMAND[@]}")
PS1="$PS1"'\[\e]133;B\a\]'
PS0=$'\e]133;C\a'"$PS0"
`

const ZSH = String.raw`
ZDOTDIR=$DAWSHA_USER_ZDOTDIR
[[ -f $ZDOTDIR/.zshrc ]] && source "$ZDOTDIR/.zshrc"
autoload -Uz add-zsh-hook
__dawsha_preexec() { printf '\033]133;C\007'; }
__dawsha_precmd() {
  local code=$?
  printf '\033]133;D;%s\007' "$code"
  local uri=$PWD
  uri=${'$'}{uri//%/%25}; uri=${'$'}{uri//#/%23}; uri=${'$'}{uri//\?/%3F}
  printf '\033]7;file://localhost%s\007\033]133;A\007' "$uri"
}
add-zsh-hook preexec __dawsha_preexec
add-zsh-hook precmd __dawsha_precmd
PROMPT="$PROMPT"$'%{\e]133;B\a%}'
`

/** Only interactive, recognized shells get hooks. User profiles still run first. */
export function integratedShell(spec: LaunchSpec, env: Record<string, string>): LaunchSpec {
  if (spec.args.some((arg) => /^-(?:c|command|encodedcommand)$/i.test(arg))) return spec
  const name = spec.file.split(/[\\/]/).pop()?.replace(/\.exe$/i, '').toLowerCase()
  if (name === 'pwsh' || name === 'powershell') {
    return { ...spec, args: [...spec.args, '-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(POWERSHELL, 'utf16le').toString('base64')] }
  }
  if (name !== 'bash' && name !== 'zsh') return spec
  const folder = integrationFolder()
  if (name === 'bash') {
    const path = join(folder, 'bashrc')
    writeFileSync(path, BASH, { mode: 0o600 })
    env.DAWSHA_SHELL_LOGIN = spec.args.some((arg) => arg === '-l' || arg === '--login') ? '1' : '0'
    return { ...spec, args: ['--init-file', path, ...spec.args.filter((arg) => arg !== '-l' && arg !== '--login'), '-i'] }
  }
  for (const startup of ['.zshenv', '.zprofile', '.zlogin']) {
    writeFileSync(join(folder, startup), `ZDOTDIR=$DAWSHA_USER_ZDOTDIR\n[[ -f "$ZDOTDIR/${startup}" ]] && source "$ZDOTDIR/${startup}"\nDAWSHA_USER_ZDOTDIR=$ZDOTDIR\nZDOTDIR=$DAWSHA_INJECT_ZDOTDIR\n`, { mode: 0o600 })
  }
  writeFileSync(join(folder, '.zshrc'), ZSH, { mode: 0o600 })
  env.DAWSHA_USER_ZDOTDIR = env.ZDOTDIR || env.HOME || homedir()
  env.ZDOTDIR = folder
  env.DAWSHA_INJECT_ZDOTDIR = folder
  return { ...spec, args: [...spec.args, '-i'] }
}
