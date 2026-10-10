# Contributing to Dawsha

Thanks for helping. Dawsha is a small Electron + TypeScript app; changes are easiest to review when they are focused.

## Set up

```bash
npm install
npm run dev
```

Requirements: Windows, Node 24.

## Before you open a pull request

- `npm run build` type-checks and builds.
- `npm test` runs the unit tests (vitest) and the Electron end-to-end tests (Playwright). New behaviour needs a test: a unit test for pure logic in `src/shared` or `src/main`, an end-to-end test for UI behaviour. The end-to-end tests use temporary folders and fake agent commands, never your real settings.
- Follow the surrounding code: plain TypeScript in the renderer, small modules, immutable state updates, no explanatory comments where the code is clear.
- Screenshots in `docs/screenshots` come from `npm run screenshots` with fake demo projects. Never commit images or fixtures that show real project names, session titles or personal paths.

## Commits and pull requests

Use short, imperative Conventional Commit messages (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`). One logical change per pull request, with a description of what changed and how you tested it.

## Reporting bugs

Open an issue using the bug template. Include the Dawsha version, Windows version, which agent was involved and steps to reproduce.

## License

By contributing you agree that your contributions are licensed under the MIT License.
