// Dawsha Remote service worker. It only shows approval notifications for a page that is open in
// the background and handles their buttons. It never caches anything and has no push handler:
// notifications reach a phone only while the Dawsha page is still running. Plain JavaScript on
// purpose, because it is served as a static file next to the page.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

async function openApprovals() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = windows[0]
  if (existing) {
    await existing.focus().catch(() => undefined)
    existing.postMessage({ type: 'open-approvals' })
    return
  }
  await self.clients.openWindow('./#approvals')
}

async function allow(data) {
  const response = await fetch('./api/approvals/answer', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: data.id, fingerprint: data.fingerprint, allow: true })
  })
  if (response.ok) return
  const body = await response.json().catch(() => ({}))
  await self.registration.showNotification('Could not allow that prompt', {
    body: typeof body.error === 'string' ? body.error : 'Open Dawsha to check it.',
    tag: 'approval-error'
  })
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {}
  event.notification.close()
  if (event.action === 'allow' && typeof data.id === 'string' && typeof data.fingerprint === 'string') {
    event.waitUntil(allow(data).catch(() => self.registration.showNotification('Could not reach Dawsha', { body: 'Open the page to allow it.', tag: 'approval-error' })))
    return
  }
  event.waitUntil(openApprovals())
})
