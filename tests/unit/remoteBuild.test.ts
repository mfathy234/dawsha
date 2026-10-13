import { describe, expect, it } from 'vitest'
import { isPrivateRemoteBuild, isRemoteControlBuild, privateRemoteBuildDefine, remoteControlBuildDefine } from '../../src/shared/remoteBuild'

describe('private remote build gate', () => {
  it('is disabled when the build define is absent', () => {
    expect(isPrivateRemoteBuild).toBe(false)
  })

  it('sets an explicit boolean define for private and default builds', () => {
    expect(privateRemoteBuildDefine(false)).toEqual({ __DAWSHA_PRIVATE_REMOTE__: 'false' })
    expect(privateRemoteBuildDefine(true)).toEqual({ __DAWSHA_PRIVATE_REMOTE__: 'true' })
  })

  it('enables Remote Control independently of the private build identity', () => {
    expect(isRemoteControlBuild).toBe(false)
    expect(remoteControlBuildDefine(true)).toEqual({ __DAWSHA_REMOTE_CONTROL__: 'true' })
    expect(remoteControlBuildDefine(false)).toEqual({ __DAWSHA_REMOTE_CONTROL__: 'false' })
  })
})
