import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { activeTermId, closeApp, createSandbox, launchApp, lastInput } from './helpers'

// Opt-in: runs the real Whisper engine on real speech through Chromium's fake microphone, so the whole path
// (getUserMedia, AudioContext, resampling, worker, model, insertion) is exercised. It needs the network on its first
// run to download the model. DICTATION_REAL=<folder of .wav clips>; a clip named en*.wav is expected in English, any other in Arabic script.
// DICTATION_REAL_MODEL picks the model (base, small or turbo).
const CLIPS = process.env.DICTATION_REAL
const PROFILE = process.env.DICTATION_REAL_PROFILE ?? join(tmpdir(), 'dawsha-dictation-real-profile')
const MODEL = process.env.DICTATION_REAL_MODEL ?? 'base'
const RESULTS = resolve(__dirname, `../../test-results/dictation-real-${MODEL}.json`)

/** Seconds of audio in a 16-bit PCM WAV file. */
function wavSeconds(file: string): number {
  const data = readFileSync(file)
  const rate = data.readUInt32LE(24)
  const channels = data.readUInt16LE(22)
  return (data.length - 44) / (rate * channels * 2)
}

const clips = CLIPS ? readdirSync(CLIPS).filter((name) => name.endsWith('.wav')).sort() : []
const results: Record<string, { text: string; seconds: number }> = {}

test.describe.configure({ mode: 'serial' })
test.skip(!CLIPS, 'set DICTATION_REAL to a folder of .wav clips')

for (const name of clips) {
  test(`dictates ${name} through the microphone with the real engine`, async () => {
    test.setTimeout(960_000)
    const sandbox = createSandbox()
    mkdirSync(PROFILE, { recursive: true })
    const settings = JSON.parse(readFileSync(join(sandbox.userData, 'settings.json'), 'utf8'))
    writeFileSync(join(PROFILE, 'settings.json'), JSON.stringify({ ...settings, dictation: { language: 'auto', model: MODEL } }), 'utf8')
    const file = join(CLIPS!, name)
    const { app, page } = await launchApp(sandbox, { DAWSHA_USER_DATA: PROFILE }, [
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}%noloop`
    ])
    try {
      await page.getByRole('button', { name: 'New Claude session in Smoke', exact: true }).click()
      const id = await activeTermId(page)
      const mic = page.locator('.pane-mic')
      await mic.click()
      await expect(mic).toHaveClass(/recording/)
      await page.waitForTimeout(wavSeconds(file) * 1000 + 1200)
      const started = Date.now()
      await mic.click()
      await expect.poll(() => lastInput(page, id), { timeout: 900_000, intervals: [500] }).not.toBe('')
      const text = await lastInput(page, id)
      results[name] = { text, seconds: (Date.now() - started) / 1000 }
      writeFileSync(RESULTS, JSON.stringify(results, null, 2), 'utf8')
      if (name.startsWith('en')) expect(text).toMatch(/[a-z]{3}/i)
      else expect(text).toMatch(/[؀-ۿ]/)
    } finally {
      await closeApp(app)
    }
  })
}
