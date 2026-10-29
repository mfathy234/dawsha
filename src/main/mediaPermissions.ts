import { session } from 'electron'

/** Dawsha asks for no browser permission (camera, microphone, notifications or otherwise), so every request and check is denied. */
export function denyPermissionRequests(): void {
  const target = session.defaultSession
  target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
}
