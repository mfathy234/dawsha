/** An included file can change while the open diagram's own text stays identical. */
export const diagramHasIncludes = (text: string): boolean => /^\s*!include(?:_once|_many|once|many|url)?\b/im.test(text)
