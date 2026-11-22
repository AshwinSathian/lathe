# Self-hosting

Lathe builds to static files, so it can run on any web server. Self-hosting is the strongest privacy option, because you control the code that reaches the browser.

## Docker

```bash
docker build -t lathe .
docker run --rm -p 8080:8080 lathe
```

Open <http://localhost:8080>. The container runs nginx as a non-root user and serves the same security headers as the public site.

## Cloudflare Workers

Change `account_id`, `name` and `routes` in `wrangler.jsonc`, then run:

```bash
npm run deploy
```

This runs the type check, build and tests before it deploys. `public/_headers` sets the headers.

## Any static host

```bash
npm ci
npm run build   # output in dist/
```

Your server needs to:

- serve `/merge-pdf` from `merge-pdf.html`
- send `.wasm` as `application/wasm`
- send the headers in `public/_headers`, or translate them as [`deploy/nginx.conf`](../deploy/nginx.conf) does

`Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` turn on WebAssembly threads. Without them the tools still work, but AVIF, JPEG XL and AI run more slowly.

## Offline or air-gapped networks

Everything except these downloads is served from your host:

| Feature | Downloads from |
|---|---|
| Background removal, upscaling | `huggingface.co`, and `cdn.jsdelivr.net` for ONNX Runtime |

To block them, remove those hosts from the two model routes in the CSP. Remove background and Upscale image will then show an error, and all other tools keep working, including OCR and face blur.
