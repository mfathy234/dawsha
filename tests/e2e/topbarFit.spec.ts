import { expect, test } from '@playwright/test'
import { closeApp, createSandbox, launchApp } from './helpers'

test('keeps the top bar on one row at 1024 wide, with New session at the far right', async () => {
  const { app, page } = await launchApp(createSandbox())
  try {
    await page.setViewportSize({ width: 1024, height: 728 })
    const newSession = page.locator('#new-session')
    const more = page.locator('#more-button')
    await expect(newSession).toBeVisible()
    const box = await newSession.boundingBox()
    const moreBox = await more.boundingBox()
    const bar = await page.locator('.topbar').boundingBox()
    expect(box).not.toBeNull()
    expect(moreBox).not.toBeNull()
    expect(bar).not.toBeNull()
    expect(Math.abs(box!.y - moreBox!.y)).toBeLessThan(4)
    expect(box!.x + box!.width).toBeGreaterThan(bar!.x + bar!.width - 24)
    expect(box!.x).toBeGreaterThan(moreBox!.x + moreBox!.width)
  } finally {
    await closeApp(app)
  }
})
