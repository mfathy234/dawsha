import { session, type BrowserWindow } from 'electron'
import { isMediaPermissionAllowed } from '../shared/mediaPermission'

/**
 * Dictation needs the microphone. Grant 'media' to the app's own window for audio only and deny every
 * other permission request, origin and window (including video capture).
 */
export function installMediaPermissions(getWindow: () => BrowserWindow | null): void {
  const target = session.defaultSession
  const fromAppWindow = (webContents: Electron.WebContents | null): boolean => {
    const window = getWindow()
    return window !== null && !window.isDestroyed() && webContents === window.webContents
  }
  target.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const appUrl = webContents?.getURL() ?? ''
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes
    callback(fromAppWindow(webContents) && isMediaPermissionAllowed(permission, details.requestingUrl, { mediaTypes }, appUrl))
  })
  target.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const appUrl = webContents?.getURL() ?? ''
    const mediaType = (details as { mediaType?: string }).mediaType
    const mediaTypes = mediaType && mediaType !== 'unknown' ? [mediaType] : []
    return fromAppWindow(webContents) && isMediaPermissionAllowed(permission, details.requestingUrl ?? requestingOrigin, { mediaTypes }, appUrl)
  })
}
