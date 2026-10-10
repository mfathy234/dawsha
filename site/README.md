# Dawsha website

A single static page: `index.html`, `style.css`, `release.js`, `motion.js` (scroll reveals, logo intro and terminal typing, all skipped under reduced motion) and `assets/`. No framework and no build step. Open `index.html` in a browser, or serve the folder with any static server (`npx serve site`).

The download buttons link to the latest GitHub release. `release.js` asks `api.github.com` for the newest release and points the buttons at the Setup and Portable assets and fills in the version. With JavaScript off, or when the API is rate limited, the buttons keep their fallback link to `https://github.com/mfathy234/dawsha/releases/latest`.

## Canonical URL

The planned site URL is `https://mfathy234.github.io/dawsha/`. It appears in `index.html` in the `canonical` link, `og:url`, `og:image` and `twitter:image`. Enable GitHub Pages before sharing it.

`assets/og.png` is the 1200x630 social preview.

## Hosting

The Pages workflow can publish `site/` to `https://mfathy234.github.io/dawsha/` after GitHub Pages is enabled for the new repository. Run it manually from Actions.

## Hosting on GitHub Pages

1. Merge `site/` and `.github/workflows/pages.yml` into `main`.
2. In the repository, open Settings > Pages and set Source to **GitHub Actions**.
3. Run the `Pages` workflow from the Actions tab. The site is served at `https://mfathy234.github.io/dawsha/`.

## Custom domain

1. Add a file `site/CNAME` containing only the domain, for example `dawsha.example.com`.
2. At your DNS provider add either a `CNAME` record from `dawsha` to `mfathy234.github.io`, or for an apex domain the four `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (and optionally the matching `AAAA` records).
3. In Settings > Pages enter the domain and enable **Enforce HTTPS** once the certificate is issued.
4. Update the canonical URL as described above.

## Free alternatives

Cloudflare Pages: create a project from the GitHub repository, set the build command to empty and the output directory to `site`. Netlify and Vercel work the same way with `site` as the publish directory.
