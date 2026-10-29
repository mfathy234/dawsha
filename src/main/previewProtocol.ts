import { protocol } from 'electron'
import { PREVIEW_SCHEME, type PreviewServer } from './filePreviewServer'

export function registerPreviewProtocol(server: PreviewServer): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    const answer = await server.serve(request.url)
    return new Response(typeof answer.body === 'string' ? answer.body : new Uint8Array(answer.body), { status: answer.status, headers: answer.headers })
  })
}
