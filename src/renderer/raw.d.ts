declare module '*.md?raw' {
  const text: string
  export default text
}

declare module '*.svg?raw' {
  const text: string
  export default text
}

declare module '*.mjs?url' {
  const url: string
  export default url
}

declare module '*.wasm?url' {
  const url: string
  export default url
}
