# Threat model

Lathe's central promise is that your file stays on your device. This page sets out how that is enforced and where it stops.

## What protects your files

| Risk | Control | Checked by |
|---|---|---|
| A tool sends a file somewhere | No backend exists. The CSP limits `connect-src` to this site, jsDelivr and Hugging Face | `no tool sends a file anywhere` test |
| A crafted file runs script | Untrusted text goes through `textContent`. SVGs are drawn through `<img>` after scripts are removed. `script-src` has no `unsafe-inline` | CSP, SVG optimiser test |
| The site is framed to trick you | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | `security headers are present` test |
| Redacted text can be copied back | Redacted pages are rebuilt from pixels, so their text and vectors are gone | `redaction removes the text` tests |
| Photos reveal a location | EXIF, XMP and IPTC are removed | `metadata removal strips GPS` test |
| A model changes upstream | Hugging Face models are pinned to a commit, and the face model to a SHA-256 | `src/engine/ai.ts`, `scripts/vendor.mjs` |
| A compromised build action | GitHub Actions are pinned to commit hashes, with read-only tokens by default | `.github/workflows` |

## What Lathe cannot protect against

- **A compromised host or CDN.** If this site or jsDelivr served malicious code, it would run in your tab. The CSP limits where it could send data, but both allowed hosts accept requests. For stronger assurance, [self-host](self-hosting.md) and block outbound traffic.
- **Malware or extensions on your device.** Browser extensions can read the page.
- **Who sees your downloads.** jsDelivr and Hugging Face can see your IP address when you download a model. They receive no file data.
- **Blur and pixelation.** These can sometimes be reversed. Use a solid block for text and numbers.
- **Sign PDF as proof of identity.** It adds a visual signature, not a certificate-based one.
- **Weak passwords.** AES-256 does not help if the password can be guessed.
- **Other copies of a redacted file.** Redaction changes the output only.

## Data at rest

| Stored | Where | For how long |
|---|---|---|
| App and engines | Service worker cache | Until the browser evicts them |
| AI models | Browser Cache API | Until the browser evicts them |
| Tool settings, without passwords or free text | `localStorage` | Until cleared |
| A file passed to the next tool | IndexedDB | Until the next page opens it |

If you close the tab during a handoff, that file stays in IndexedDB until the next handoff replaces it or you clear site data.
