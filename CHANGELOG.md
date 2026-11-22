# Changelog

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

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
- Redaction also flattens kept pages that share an image with a redacted page
- Metadata removal drops data between JPEG scans, after the image, and in unknown PNG chunks
- Markdown links accept only web and mail addresses
- Files are stored for a tool handoff only when you choose the next tool

[0.1.0]: https://github.com/AshwinSathian/lathe/releases/tag/v0.1.0
