# Releasing and rolling back

Lathe deploys as static assets to Cloudflare Workers. A release is a commit on `main`, a green CI run, a deployment and a tag.

## Ship gates

Run these before every push:

```bash
npm run check
npm run check:docs
npm audit --omit=dev --audit-level=high
npm run build
npx playwright test
gitleaks git --staged --no-banner --redact
```

Run `LATHE_GPU=1 npx playwright test tests/webgpu.spec.ts --project=chromium` when AI code changes.

## Release

1. Update `CHANGELOG.md`, `package.json` and `CITATION.cff`.
2. Commit to `main` and push.
3. Wait for CI to pass.
4. Run `npx wrangler deploy`.
5. Run `LATHE_URL=https://lathe.ashwinsathian.com npx playwright test`.
6. Run `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`. The Release workflow publishes the site archive, SBOM and signed provenance.

## Roll back

```bash
npx wrangler deployments list
npx wrangler rollback <version-id> -m "reason"
curl -s https://lathe.ashwinsathian.com/sw.js | grep CACHE
LATHE_URL=https://lathe.ashwinsathian.com npx playwright test tests/live.spec.ts tests/production.spec.ts --project=chromium
```

Each build names its service worker cache after its contents, so a rollback changes the cache name and returning visitors replace the newer engines on their next visit. Keep the previous release's version ID in the release notes.

If a release exposed user data, roll back first, then follow [the security policy](../SECURITY.md).

## Updating a pinned download

`src/engine/pins.json` records the SHA-256 of every model file, the ONNX runtime and the OCR data. The build fails if the installed ONNX runtime no longer matches. After a dependency update, recompute the hash, update the file and run the model tests.

## Monitoring

The Production check workflow runs the header, page and hook-free specs against the live site every day. CodeQL, Scorecard and dependency review run on GitHub.
