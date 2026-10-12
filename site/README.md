# Dawsha website

The public website is [dawsha.pages.dev](https://dawsha.pages.dev/). Cloudflare Pages serves the static files in `site/`: `index.html` for English and `ar/index.html` for Arabic. There is no site build step. To preview locally, run `npx serve site`.

Both languages render without JavaScript. The language links switch between `/` and `/ar/`, which have separate canonical URLs and social metadata. `i18n.js` is the translation source used to regenerate the Arabic page with `node scripts/build-arabic-site.mjs`; commit the regenerated `ar/index.html` whenever the English content or translations change.

The Download dropdowns offer Windows Setup and Portable, macOS Apple Silicon DMG, and Linux x64 AppImage and Debian packages. Native HTML details keep the choices keyboard accessible and usable without JavaScript. `release.js` asks `api.github.com` for the newest release, resolves each available package, and fills in the version. Missing packages, disabled JavaScript, and API failures retain a link to the latest release; Linux downloads resolve after the first release containing Linux assets. Escape closes a dropdown and returns focus to its trigger.

Linux packages are built on Ubuntu in CI and uploaded to tagged GitHub releases by `release-linux`. Package filenames must match the patterns in `release.js`. To verify the site, run `node scripts/build-arabic-site.mjs` followed by `npx playwright test tests/e2e/site.spec.ts`.

## Hosting

Connect this repository to Cloudflare Pages and set the production branch to `main`. Leave the build command empty and set the build output directory to `site`. Cloudflare Pages will publish the site at `https://dawsha.pages.dev/`.

The canonical, Open Graph, and Twitter image URLs in both HTML pages use this domain. The Arabic page generator sets the same canonical and language alternate URLs. `assets/og.png` is the 1200 × 630 social preview.
