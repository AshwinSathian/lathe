# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.1.5] - 2026-11-22

### Security

- Redaction and signature marks can no longer be applied without being visible. Marks from a previous file are discarded, and a reopened editor shows every mark it will write
- The test hook that exposed passwords and output on `window` is gone for normal visitors
- Each release replaces the engines the service worker cached. Old pages and engines are no longer served from a retained cache

### Added

- Cancel for running jobs
- Check the result at reading size, then go back to editing with your marks intact

### Fixed

- A result from a previous file can no longer appear under a new one
- Changing a setting labels the finished result as out of date
- Files a tool cannot use are named instead of silently ignored
- Removing the last file no longer reloads the page
- Redact, Sign and Organise explain a damaged or locked file instead of showing a blank page

## [0.1.4] - 2026-11-22

### Security

- Redaction flattens every page by default. The setting returns to on for each visit
- Redaction checks follow the real page tree and PDF structure, so forged `/Parent`, `/Type` and ICC entries cannot hide content
- Delete, extract, split and organise remove images that only a removed page draws, and warn when a kept page reuses removed content

### Fixed

- Delete, extract and split no longer refuse PDFs with internal links or standard form fields
- Merge and organise keep links between pages without adding hidden duplicate pages

## [0.1.3] - 2026-11-22

### Security

- Redaction no longer trusts `/Type` labels when deciding what a kept page can reach, so a mislabelled object cannot carry hidden content into the output

## [0.1.2] - 2026-11-22

### Security

- Redaction no longer misses a shared image stored under a resource name such as `/P` or `/Metadata`

## [0.1.1] - 2026-11-22

### Security

- Redaction now compares everything a page can show, including shared content streams, annotation appearances and Type 3 fonts. A kept page that shares any of it is flattened

### Fixed

- Markdown to PDF no longer decodes escaped HTML entities twice
- The face model is checked against its SHA-256 before it is written to disk

## [0.1.0] - 2026-11-22

First public release, with 60 tools and 22 preset format conversions.

### Added

- Image conversion across JPEG, PNG, WebP, AVIF, JPEG XL, HEIC, GIF, TIFF, BMP and ICO
- HEIC export through the browser's HEVC encoder and a HEIF writer in this repository
- PDF merge, split, organise, compress, encrypt, unlock, redact, sign, fill, OCR, compare and inspect
- On-device background removal, 2x upscaling, OCR and face blur
- Live before and after preview, batch processing, tool chaining and offline use
- Docker image for self-hosting
- CPU fallback for photo tools in browsers without WebGL2

### Security

- Removing pages no longer carries them along through links or form fields
- Redaction also flattens kept pages that can reach an image, form or pattern from a redacted page
- Metadata removal drops data between JPEG scans, after the image, and in unknown PNG chunks
- Markdown links accept only web and mail addresses
- Files are stored for a tool handoff only when you choose the next tool

[0.1.5]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.5
[0.1.4]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.4
[0.1.3]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.3
[0.1.2]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.2
[0.1.1]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.1
[0.1.0]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.0
