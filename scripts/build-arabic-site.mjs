import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const siteDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'site')
const browser = await chromium.launch()

try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.route(/^https?:/, (route) => route.abort())
  await page.goto(`${pathToFileURL(join(siteDir, 'index.html')).href}?lang=ar`)
  const translationScript = await page.addScriptTag({ path: join(siteDir, 'i18n.js') })
  await translationScript.evaluate((element) => element.remove())

  await page.evaluate(() => {
    const siteUrl = 'https://dawsha.pages.dev/'
    document.querySelector('link[rel="canonical"]').href = `${siteUrl}ar/`
    document.querySelector('link[rel="alternate"][hreflang="en"]').href = siteUrl
    document.querySelector('link[rel="alternate"][hreflang="ar"]').href = `${siteUrl}ar/`
    document.querySelector('meta[property="og:url"]').content = `${siteUrl}ar/`

    const switcher = document.querySelector('.lang-switch')
    switcher.href = '../index.html'
    switcher.textContent = 'English'
    switcher.lang = 'en'
    switcher.setAttribute('aria-label', 'English')

    const comments = [
      '# أضف هذا المجلد وابدأ وكيله',
      '# ابدأ وكيلًا محددًا لمشروع',
      '# استأنف أحدث جلسة'
    ]
    document.querySelectorAll('.code .c').forEach((element, index) => {
      if (comments[index]) element.textContent = comments[index]
    })

    const latin = /⁨([^⁩]+)⁩|(Sami · PR 8841|Dawsha Cards|dawsha crew|Ctrl\+[A-Za-z+]+|TypeScript|on dev|PR 8841|Maya|Sami|Tarek|Omar|Hana|Lina|Nour|Yara|Zed|Fable|Opus|Sonnet|Haiku|MCP)/g
    for (const section of document.querySelectorAll('#new, #earlier')) {
      const walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT)
      const found = []
      while (walker.nextNode()) if (!walker.currentNode.parentElement.closest('bdi,script,style,svg,pre,code')) found.push(walker.currentNode)
      for (const node of found) {
        const text = node.textContent
        latin.lastIndex = 0
        if (!latin.test(text)) continue
        latin.lastIndex = 0
        const fragment = document.createDocumentFragment()
        let last = 0
        for (const match of text.matchAll(latin)) {
          fragment.append(text.slice(last, match.index))
          const bdi = document.createElement('bdi')
          bdi.textContent = match[1] ?? match[2]
          fragment.append(bdi)
          last = match.index + match[0].length
        }
        fragment.append(text.slice(last))
        node.replaceWith(fragment)
      }
    }

    for (const element of document.querySelectorAll('link[href], script[src], img[src], source[src], video[poster]')) {
      for (const attribute of ['src', 'href', 'poster']) {
        const value = element.getAttribute(attribute)
        if (value && !/^(?:[a-z]+:|\/\/|#|\/)/i.test(value)) element.setAttribute(attribute, `../${value}`)
      }
    }
    document.documentElement.classList.remove('js', 'lenis')
  })

  const outputDir = join(siteDir, 'ar')
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, 'index.html'), await page.content(), 'utf8')
} finally {
  await browser.close()
}
