import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'build')
const siteAssets = join(root, 'site', 'assets')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 512

const mark = readFileSync(join(root, 'src', 'renderer', 'assets', 'logo.svg'), 'utf8')
const render = (size) => new Resvg(mark, { fitTo: { mode: 'width', value: size } }).render().asPng()
const logoBody = mark.slice(mark.indexOf('>') + 1, mark.lastIndexOf('</svg>'))
const socialPreview = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0c0e12"/>
  <rect x="52" y="52" width="1096" height="526" rx="32" fill="#11141a" stroke="#232833" stroke-width="2"/>
  <g transform="translate(104 194) scale(.94)">${logoBody}</g>
  <text x="410" y="305" fill="#d6dae3" font-family="Segoe UI, Arial, sans-serif" font-size="112" font-weight="700">Dawsha</text>
  <text x="416" y="369" fill="#8a93a6" font-family="Segoe UI, Arial, sans-serif" font-size="30">One window for all your AI coding agents.</text>
  <rect x="416" y="421" width="515" height="4" rx="2" fill="#34d399"/>
</svg>`

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'icon.png'), render(PNG_SIZE))
writeFileSync(join(out, 'icon.ico'), await pngToIco(ICO_SIZES.map((size) => render(size))))
mkdirSync(siteAssets, { recursive: true })
writeFileSync(join(siteAssets, 'icon.png'), render(192))
writeFileSync(join(siteAssets, 'favicon.png'), render(64))
writeFileSync(join(siteAssets, 'og.png'), new Resvg(socialPreview).render().asPng())
console.log(`wrote build/icon.png (${PNG_SIZE}) and build/icon.ico (${ICO_SIZES.join(', ')})`)
