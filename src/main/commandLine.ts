const NEEDS_QUOTES = /[\s"]/

export function quoteWindowsArg(arg: string): string {
  if (arg !== '' && !NEEDS_QUOTES.test(arg)) return arg
  let quoted = '"'
  let backslashes = 0
  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1
      continue
    }
    if (char === '"') quoted += '\\'.repeat(backslashes * 2 + 1)
    else quoted += '\\'.repeat(backslashes)
    backslashes = 0
    quoted += char
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`
}

export const windowsCommandLine = (args: string[]): string => args.map(quoteWindowsArg).join(' ')

export function ptyArguments(args: string[], platform = process.platform): string | string[] {
  return platform === 'win32' ? windowsCommandLine(args) : args
}
