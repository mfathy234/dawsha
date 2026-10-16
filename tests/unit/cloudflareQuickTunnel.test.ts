import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createCloudflareQuickTunnel, type TunnelProcess } from '../../src/main/cloudflareQuickTunnel'

function fakeProcess() {
  const child = new EventEmitter() as EventEmitter & TunnelProcess
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  child.stdout = stdout as unknown as TunnelProcess['stdout']
  child.stderr = stderr as unknown as TunnelProcess['stderr']
  child.kill = vi.fn(() => true)
  return child
}

describe('Cloudflare Quick Tunnel adapter', () => {
  it('uses fixed loopback arguments and accepts a generated Quick Tunnel URL', async () => {
    const child = fakeProcess()
    child.kill = vi.fn(() => { child.emit('exit', 0); return true })
    const run = vi.fn(() => child)
    const tunnel = createCloudflareQuickTunnel(run)
    const pending = tunnel.start(4567, 'owner@example.com')
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    ;(child.stderr as unknown as EventEmitter).emit('data', 'Your quick Tunnel has been created! Visit it at https://silver-owl.trycloudflare.com\n')
    const handle = await pending
    expect(handle.url).toBe('https://silver-owl.trycloudflare.com')
    expect(run).toHaveBeenCalledWith('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:4567', '--allowed-mail', 'owner@example.com'], expect.objectContaining({ shell: false }))
    await handle.stop()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('can start a tunnel without the Cloudflare email gate when Dawsha pairing is used alone', async () => {
    const child = fakeProcess()
    child.kill = vi.fn(() => { child.emit('exit', 0); return true })
    const run = vi.fn(() => child)
    const tunnel = createCloudflareQuickTunnel(run)
    const pending = tunnel.start(4567)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    ;(child.stderr as unknown as EventEmitter).emit('data', 'Visit it at https://silver-owl.trycloudflare.com\n')
    await pending
    expect(run).toHaveBeenCalledWith('cloudflared', ['tunnel', '--url', 'http://127.0.0.1:4567'], expect.objectContaining({ shell: false }))
  })

  it('rejects invalid ports and email addresses without spawning', async () => {
    const run = vi.fn(() => fakeProcess())
    const tunnel = createCloudflareQuickTunnel(run)
    await expect(tunnel.start(0, 'owner@example.com')).rejects.toThrow(/port/i)
    await expect(tunnel.start(1234, 'not-an-email')).rejects.toThrow(/email/i)
    expect(run).not.toHaveBeenCalled()
  })

  it('stops a child which exits before returning a valid URL', async () => {
    const child = fakeProcess()
    const tunnel = createCloudflareQuickTunnel(() => child)
    const pending = tunnel.start(1234, 'owner@example.com')
    await vi.waitFor(() => expect(child.listenerCount('exit')).toBeGreaterThan(0))
    child.emit('exit', 1)
    await expect(pending).rejects.toThrow(/failed to start/i)
    expect(child.kill).not.toHaveBeenCalled()
  })
})
