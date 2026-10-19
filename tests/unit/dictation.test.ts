import { describe, expect, it } from 'vitest'
import {
  DICTATION_MAX_SAMPLES,
  DICTATION_SHORTCUT,
  cleanTranscript,
  defaultDictation,
  downmix,
  insertAtCaret,
  isTextField,
  joinChunks,
  levelFromRms,
  peakOf,
  resample,
  rmsOf,
  sanitizeDictation,
  SILENCE_PEAK,
  whisperLanguage
} from '../../src/shared/dictation'
import { defaultSettings, migrateSettings } from '../../src/shared/settingsSchema'
import { bind, matchesBinding } from '../../src/shared/shortcuts'
import { isMediaPermissionAllowed } from '../../src/shared/mediaPermission'

describe('dictation settings', () => {
  const DEFAULTS = { language: 'auto', model: 'turbo', microphone: '', introShown: false }

  it('defaults to automatic language, the large turbo model, the system microphone and the intro not yet shown', () => {
    expect(defaultDictation()).toEqual(DEFAULTS)
    expect(defaultSettings().dictation).toEqual(DEFAULTS)
  })

  it('keeps valid choices and repairs everything else', () => {
    expect(sanitizeDictation({ language: 'ar', model: 'small', microphone: 'abc123', introShown: true })).toEqual({
      language: 'ar',
      model: 'small',
      microphone: 'abc123',
      introShown: true
    })
    expect(sanitizeDictation({ microphone: 42, introShown: 'yes' })).toEqual(DEFAULTS)
    expect(sanitizeDictation({ microphone: 'x'.repeat(513) }).microphone).toBe('')
    expect(sanitizeDictation({ language: 'fr', model: 'huge' })).toEqual(defaultDictation())
    expect(sanitizeDictation(null)).toEqual(defaultDictation())
    expect(sanitizeDictation(['ar'])).toEqual(defaultDictation())
  })

  it('is read back through the settings migration', () => {
    expect(migrateSettings({ dictation: { language: 'en', model: 'small' } }).dictation).toEqual({ ...DEFAULTS, language: 'en', model: 'small' })
    expect(migrateSettings({ dictation: 'bad' }).dictation).toEqual(defaultDictation())
  })

  it('passes a language name to Whisper only when one is chosen', () => {
    expect(whisperLanguage('auto')).toBeNull()
    expect(whisperLanguage('ar')).toBe('arabic')
    expect(whisperLanguage('en')).toBe('english')
  })
})

describe('audio helpers', () => {
  it('averages channels into mono', () => {
    expect(Array.from(downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)]))).toEqual([0.5, 0.5])
    expect(downmix([]).length).toBe(0)
  })

  it('resamples to the requested length', () => {
    const input = new Float32Array(48_000).fill(0.25)
    const out = resample(input, 48_000, 16_000)
    expect(out.length).toBe(16_000)
    expect(out[100]).toBeCloseTo(0.25)
    expect(resample(input, 16_000, 16_000)).toBe(input)
  })

  it('interpolates between samples', () => {
    const out = resample(Float32Array.of(0, 1, 0, 1), 4, 8)
    expect(out.length).toBe(8)
    expect(out[1]).toBeCloseTo(0.5)
  })

  it('joins chunks and never exceeds the limit', () => {
    expect(Array.from(joinChunks([Float32Array.of(1, 2), Float32Array.of(3)]))).toEqual([1, 2, 3])
    expect(Array.from(joinChunks([Float32Array.of(1, 2), Float32Array.of(3, 4)], 3))).toEqual([1, 2, 3])
    expect(joinChunks([new Float32Array(DICTATION_MAX_SAMPLES + 5)]).length).toBe(DICTATION_MAX_SAMPLES)
  })

  it('collapses whitespace in a transcript', () => {
    expect(cleanTranscript('  مرحبا   بالعالم \n')).toBe('مرحبا بالعالم')
  })
})

describe('dictation target selection', () => {
  const field = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, insideTerminal: false, ...extra })

  it('accepts text inputs and textareas', () => {
    expect(isTextField(field('TEXTAREA'))).toBe(true)
    expect(isTextField(field('INPUT', { type: 'text' }))).toBe(true)
    expect(isTextField(field('INPUT', { type: 'search' }))).toBe(true)
  })

  it('rejects the terminal, read-only, disabled and non-text fields', () => {
    expect(isTextField(field('TEXTAREA', { insideTerminal: true }))).toBe(false)
    expect(isTextField(field('INPUT', { type: 'text', readOnly: true }))).toBe(false)
    expect(isTextField(field('INPUT', { type: 'text', disabled: true }))).toBe(false)
    expect(isTextField(field('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTextField(field('INPUT', { type: 'password' }))).toBe(false)
    expect(isTextField(field('BUTTON'))).toBe(false)
    expect(isTextField(null)).toBe(false)
  })

  it('inserts at the caret and replaces a selection', () => {
    expect(insertAtCaret('hello world', 5, 5, ' big')).toEqual({ value: 'hello big world', caret: 9 })
    expect(insertAtCaret('hello world', 6, 11, 'مرحبا')).toEqual({ value: 'hello مرحبا', caret: 11 })
    expect(insertAtCaret('', 0, 0, 'x')).toEqual({ value: 'x', caret: 1 })
  })
})

describe('dictation shortcut', () => {
  const event = (key: string, extra = {}) => ({ key, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, ...extra })

  it('matches Ctrl+Shift+Space, whose key value is a space character', () => {
    const binding = bind(DICTATION_SHORTCUT)
    expect(matchesBinding(event(' '), binding, 'Win32')).toBe(true)
    expect(matchesBinding(event(' ', { shiftKey: false }), binding, 'Win32')).toBe(false)
    expect(matchesBinding(event('a'), binding, 'Win32')).toBe(false)
  })
})

describe('microphone permission', () => {
  const app = 'file:///C:/app/out/renderer/index.html'
  it('allows audio-only capture for the app window', () => {
    expect(isMediaPermissionAllowed('media', app, { mediaTypes: ['audio'] }, app)).toBe(true)
    expect(isMediaPermissionAllowed('media', app, {}, app)).toBe(true)
  })

  it('denies video, other origins and other permissions', () => {
    expect(isMediaPermissionAllowed('media', app, { mediaTypes: ['video', 'audio'] }, app)).toBe(false)
    expect(isMediaPermissionAllowed('media', 'https://evil.example/', { mediaTypes: ['audio'] }, app)).toBe(false)
    expect(isMediaPermissionAllowed('geolocation', app, {}, app)).toBe(false)
  })
})

describe('microphone level', () => {
  it('measures peak and loudness', () => {
    const samples = new Float32Array([0, 0.5, -0.8, 0.1])
    expect(peakOf(samples)).toBeCloseTo(0.8)
    expect(rmsOf(samples)).toBeCloseTo(Math.sqrt((0.25 + 0.64 + 0.01) / 4))
    expect(rmsOf(new Float32Array(0))).toBe(0)
  })

  it('treats a muted microphone as silence', () => {
    expect(peakOf(new Float32Array(16000)) <= SILENCE_PEAK).toBe(true)
    expect(peakOf(new Float32Array([0.01])) <= SILENCE_PEAK).toBe(false)
  })

  it('maps loudness to a 0..1 meter on a decibel scale', () => {
    expect(levelFromRms(0)).toBe(0)
    expect(levelFromRms(0.0001)).toBe(0)
    expect(levelFromRms(0.01)).toBeCloseTo(0.4)
    expect(levelFromRms(0.5)).toBe(1)
  })
})
