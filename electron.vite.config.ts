import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import { privateRemoteBuildDefine, remoteControlBuildDefine } from './src/shared/remoteBuild'

const privateRemoteBuild = process.env.DAWSHA_PRIVATE_REMOTE_BUILD === '1'
const remoteBuildDefine = { ...privateRemoteBuildDefine(privateRemoteBuild), ...remoteControlBuildDefine(true) }
const rendererInputs: Record<string, string> = { index: resolve(__dirname, 'src/renderer/index.html') }
rendererInputs.remote = resolve(__dirname, 'src/renderer/remote.html')
const rendererOutDir = resolve(__dirname, privateRemoteBuild ? 'out/renderer-private' : 'out/renderer')

export default defineConfig({
  main: {
    define: remoteBuildDefine,
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } }
  },
  preload: {
    define: remoteBuildDefine,
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    define: remoteBuildDefine,
    build: { outDir: rendererOutDir, rollupOptions: { input: rendererInputs } }
  }
})
