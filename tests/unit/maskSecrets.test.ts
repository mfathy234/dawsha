import { describe, expect, it } from 'vitest'
import { maskSecrets, MASK_MAX_LENGTH } from '../../src/shared/maskSecrets'

describe('maskSecrets', () => {
  it('masks bearer tokens and keeps the word Bearer', () => {
    expect(maskSecrets('sent Authorization Bearer abc.def-ghi_123 to the API')).toBe('sent Authorization Bearer [masked] to the API')
  })

  it('masks the value of token, key, password and secret assignments and keeps the name', () => {
    expect(maskSecrets('token=abc123 ok')).toBe('token=[masked] ok')
    expect(maskSecrets('password=hunter2')).toBe('password=[masked]')
    expect(maskSecrets('key=XYZ&next=1')).toBe('key=[masked]&next=1')
    expect(maskSecrets('api_key=zz9 secret=qq')).toBe('api_key=[masked] secret=[masked]')
  })

  it('does not mask a word that only ends in a secret name', () => {
    expect(maskSecrets('monkey=banana')).toBe('monkey=banana')
  })

  it('masks sk- style keys', () => {
    expect(maskSecrets('used sk-proj-abcdefghijklmnop1234 today')).toBe('used sk-[masked] today')
  })

  it('masks hex runs of 24 characters or more and leaves shorter ones', () => {
    expect(maskSecrets('id a1b2c3d4e5f6a1b2c3d4e5f6 end')).toBe('id [masked] end')
    expect(maskSecrets('id a1b2c3d4e5f6a1b2c3d4e5f')).toBe('id a1b2c3d4e5f6a1b2c3d4e5f')
  })

  it('masks base64 runs of 24 characters or more that mix letters and digits', () => {
    expect(maskSecrets('blob QWxhZGRpbjpvcGVuIHNlc2FtZQ== end')).toBe('blob [masked] end')
    expect(maskSecrets('file src/main/agentLaunch.test.ts')).toBe('file src/main/agentLaunch.test.ts')
  })

  it('leaves ordinary activity text alone', () => {
    expect(maskSecrets('npm test')).toBe('npm test')
    expect(maskSecrets('run tests/unit/crew.test.ts in billing-api')).toBe('run tests/unit/crew.test.ts in billing-api')
    expect(maskSecrets('')).toBe('')
  })

  it('truncates to 120 characters after masking, marking the cut', () => {
    const long = 'npm test '.repeat(40)
    const out = maskSecrets(long)
    expect(MASK_MAX_LENGTH).toBe(120)
    expect(out.length).toBe(120)
    expect(out.endsWith('…')).toBe(true)
    expect(maskSecrets('x'.repeat(120))).toBe('x'.repeat(120))
  })

  it('never lets a secret survive the truncation', () => {
    const out = maskSecrets(`${'a '.repeat(59)}password=hunter2`)
    expect(out).not.toContain('hunter2')
  })
})
