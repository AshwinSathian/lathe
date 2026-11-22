# Threat model

Lathe's central promise is that your file stays on your device. This page sets out how that is enforced and where it stops.

## What protects your files

| Risk | Control | Checked by |
|---|---|---|
| A tool sends a file somewhere | No backend exists. The CSP limits `connect-src` to this site on every page except Remove background and Upscale image, which may also reach jsDelivr and Hugging Face to download a model. The worker that holds your files has no third-party access on any page | `no tool sends a file anywhere` and `supply-chain` tests |
| A crafted file runs script | Untrusted text goes through `textContent`. SVGs are drawn through `<img>` after scripts are removed. `script-src` has no `unsafe-inline` | CSP, SVG optimiser test |
| The site is framed to trick you | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | `security headers are present` test |
| Redacted text can be copied back | Redacted pages are rebuilt from pixels. Links to removed pages are dropped, and every page is flattened by default. With that setting off, kept pages that reuse any content from a redacted page are still flattened | `redaction` tests |
| Photos reveal a location | EXIF, XMP, IPTC, comments, thumbnails and data appended after the image are removed | `metadata removal strips GPS` test |
| A model or runtime changes upstream | Every model file, the ONNX runtime and the OCR data are pinned to a SHA-256 and checked before use, including when read back from the browser cache | `supply-chain` tests, `src/engine/pins.json` |
| A compromised build action | GitHub Actions are pinned to commit hashes, with read-only tokens by default | `.github/workflows` |

## What Lathe cannot protect against

- **A compromised host.** If this site served malicious code, it would run in your tab. On the two model tools, that code could also send data to jsDelivr or Hugging Face, because the CSP has to allow those hosts there. For stronger assurance, [self-host](self-hosting.md) and block outbound traffic.
- **Cloudflare, which hosts the public site.** Its JS Detections feature inserts an inline bot-detection script into each page, and this site cannot turn that off. The CSP blocks the script and a production test checks that its loader is never requested, so browsers log one CSP error. Self-hosting removes it.
- **Page removal with shared content.** Delete, extract, split and organise keep what a kept page still draws, such as a repeated logo, and say so in the result. Remove securely rebuilds the pages as images when that content must go.
- **Malware or extensions on your device.** Browser extensions can read the page.
- **Who sees your downloads.** On Remove background and Upscale image, jsDelivr and Hugging Face can see your IP address when the model downloads. They receive no file data.
- **Blur and pixelation.** These can sometimes be reversed. Use a solid block for text and numbers.
- **Sign PDF as proof of identity.** It adds a visual signature, not a certificate-based one.
- **Weak passwords.** AES-256 does not help if the password can be guessed.
- **Other copies of a redacted file.** Redaction changes the output only.

## Data at rest

| Stored | Where | For how long |
|---|---|---|
| App and engines | Service worker cache | Until the browser evicts them |
| AI models | Browser Cache API | Until the browser evicts them |
| Tool choices such as sliders and menus. Nothing you type | `localStorage` | Until cleared |
| A file passed to the next tool, encrypted with AES-GCM. The key is in that tab's `sessionStorage` | IndexedDB | Until the next page opens it |

A file is written to IndexedDB only when you pick the next tool. If that navigation is interrupted, the next Lathe page you open deletes it. If the tab is closed first, the key is gone and what remains cannot be read.
