export const PRIVATE_REMOTE_BUILD_DEFINE = '__DAWSHA_PRIVATE_REMOTE__'
export const REMOTE_CONTROL_BUILD_DEFINE = '__DAWSHA_REMOTE_CONTROL__'

declare const __DAWSHA_PRIVATE_REMOTE__: boolean | undefined
declare const __DAWSHA_REMOTE_CONTROL__: boolean | undefined

export const isPrivateRemoteBuild = typeof __DAWSHA_PRIVATE_REMOTE__ !== 'undefined' && __DAWSHA_PRIVATE_REMOTE__
export const isRemoteControlBuild = typeof __DAWSHA_REMOTE_CONTROL__ !== 'undefined' && __DAWSHA_REMOTE_CONTROL__

export function privateRemoteBuildDefine(enabled: boolean): Record<string, string> {
  return { [PRIVATE_REMOTE_BUILD_DEFINE]: JSON.stringify(enabled) }
}

export function remoteControlBuildDefine(enabled: boolean): Record<string, string> {
  return { [REMOTE_CONTROL_BUILD_DEFINE]: JSON.stringify(enabled) }
}
