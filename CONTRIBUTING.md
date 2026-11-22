# Contributing to Lathe

Bug reports, tool ideas and pull requests are welcome. For a new tool or a large change, open an issue first so we can agree on the approach.

## Setup

You need Node 24.

```bash
git clone https://github.com/AshwinSathian/lathe.git
cd lathe
npm ci
npx playwright install chromium firefox webkit
npm run dev        # http://localhost:4340
```

## Checks

```bash
npm run check      # types: TypeScript 7 for .ts, TypeScript 6 for .astro
npm run build
npm test           # every tool in Chromium, Firefox and WebKit
npm run docs       # regenerate the tool list and licence notices
```

`npm test` includes the model tests when run outside CI, and they download about 150 MB once. To skip them, run `CI=1 npx playwright test`.

## Rules for changes

1. **File contents never leave the browser.** No analytics, upload endpoints or remote processing. A new network destination has to be added to the CSP in `public/_headers` and justified in the pull request.
2. **Check licences.** AGPL and non-commercial code or models cannot be added. CI blocks AGPL dependencies.
3. **State limits in the product.** If a tool cannot do something well, its page says so.
4. **Treat every input as hostile.** Render untrusted text with `textContent`, and never inject file content as HTML.
5. **Add a test that fails if your logic breaks.** The test suite runs each registered tool automatically, and anything with a specific promise (such as "the text is gone") needs its own assertion.

To add a tool, follow [docs/adding-a-tool.md](docs/adding-a-tool.md).

## Pull requests

Keep each one to a single change, and write the commit subject in the imperative. By contributing you agree that your work is released under the [MIT License](LICENSE), and you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
