import { describe, expect, it } from 'vitest'
import { notificationActions, parseNotificationActivation, canAnswerNotification, PermissionPromptTracker } from '../../src/shared/notificationAction'
import { NotificationRequests } from '../../src/main/notificationRequests'

const token = 'a'.repeat(32)
const prompt = 'npm test\nDo you want to run this command?\n1. Yes\n2. No\n'
const permission = { tabId: 'tab-1', promptId: 'instance:1' }

describe('notification activation', () => {
  it('builds Allow and Deny links without prompt text and round trips escaped pane IDs', () => {
    const actions = notificationActions('pane & <1>', token)
    expect(actions.map(action => action.content)).toEqual(['Allow', 'Deny'])
    expect(parseNotificationActivation(actions[0].arguments)).toEqual({ paneId: 'pane & <1>', requestId: token, allow: true })
    expect(parseNotificationActivation(actions[1].arguments)).toMatchObject({ allow: false })
    expect(JSON.stringify(actions)).not.toContain('npm test')
  })
  it.each([
    'https://allow?pane=p&request=' + token,
    'dawsha-action:delete?pane=p&request=' + token,
    'dawsha-action:allow?pane=p',
    'dawsha-action:allow?pane=&request=' + token,
    'dawsha-action:allow?pane=p&request=bad',
    'dawsha-action:allow?pane=p&pane=q&request=' + token,
    'dawsha-action:allow?pane=p&request=' + token + '&command=rm',
    'dawsha-action:allow?pane=%00&request=' + token,
    'dawsha-action:allow?pane=p&request=' + token + '#fragment',
    'dawsha-action://user:pass@allow?pane=p&request=' + token
  ])('rejects malformed activation %s', value => expect(parseNotificationActivation(value)).toBeNull())
})

describe('permission recheck', () => {
  it('only answers the same tab and exact live permission prompt', () => {
    const answer = { ...permission, allow: true }
    expect(canAnswerNotification(answer, 'tab-1', 'instance:1')).toBe(true)
    expect(canAnswerNotification(answer, 'tab-2', 'instance:1')).toBe(false)
    expect(canAnswerNotification(answer, 'tab-1', 'instance:2')).toBe(false)
    expect(canAnswerNotification(answer, 'tab-1', null)).toBe(false)
  })
  it('tracks complete prompt lifetimes, including identical later prompts and changed long prefixes', () => {
    const tracker = new PermissionPromptTracker('instance')
    const first = tracker.observe(prompt)
    expect(tracker.observe(prompt)).toBe(first)
    expect(tracker.observe('Finished')).toBeNull()
    expect(tracker.observe(prompt)).not.toBe(first)
    const long = `${'prefix'}${'x'.repeat(13000)}\n${prompt}`
    const longId = tracker.observe(long)
    expect(tracker.observe(long.replace('prefix', 'changed'))).not.toBe(longId)
    tracker.invalidate()
    expect(tracker.observe(long)).not.toBe(longId)
  })
})

describe('NotificationRequests', () => {
  it('authorizes only a matching one-use capability and expires old requests', () => {
    const requests = new NotificationRequests()
    requests.add('p', token, permission, 100)
    expect(requests.take({ paneId: 'other', requestId: token, allow: true }, 101)).toBeUndefined()
    expect(requests.take({ paneId: 'p', requestId: token, allow: false }, 101)).toEqual({ ...permission, allow: false })
    expect(requests.take({ paneId: 'p', requestId: token, allow: true }, 102)).toBeUndefined()
    requests.add('p', token, permission, 100)
    expect(requests.take({ paneId: 'p', requestId: token, allow: true }, 100 + 24 * 60 * 60 * 1000)).toBeUndefined()
  })
})
