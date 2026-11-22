# Limits and measured performance

Lathe runs on your device, so its limits come from your browser's memory and from 32-bit WebAssembly, which can address at most 4 GB. There is no file size or usage limit imposed by the site.

## Measured results

Measured on 2026-11-22 with Lathe's release candidate in headless Chromium on a 24 GB Mac. Peak memory is the whole browser process tree. A phone or older laptop will be slower and can run out of memory sooner.

| Input | Tool | Result | Time | Peak memory |
|---|---|---|---|---|
| 500-page PDF | Rotate | Completed | 5.1 s | 571 MB |
| 500-page PDF | Compress | Completed | 5.6 s | 518 MB |
| 500-page PDF | Split into single pages | Completed | 13.6 s | 599 MB |
| 500-page PDF | PDF to text | Completed | 1.8 s | 476 MB |
| 500-page PDF, twice | Merge to 1,000 pages | Completed | 9.7 s | 578 MB |
| 500-page PDF | Grayscale | Completed | 99.5 s | 773 MB |
| 100 MB PDF | Rotate | Completed | 6.6 s | 589 MB |
| 100 MB PDF | Compress | Completed | 8.8 s | 1,171 MB |
| 100 MP JPEG | Convert to PNG | Completed | 5.8 s | 2,841 MB |
| 100 MP JPEG | Convert to WebP | **Failed with a clear message** | 11.2 s | 2,789 MB |
| 100 MP JPEG | Resize to 5000 px | Completed | 17.1 s | 2,443 MB |
| 100 MP JPEG | Compress | Completed | 30.7 s | 2,324 MB |
| 200 images | Convert to WebP | Completed | 31.4 s | 541 MB |
| 200 images | Compress | Completed | 54.9 s | 416 MB |

## Hard limits

- **Image size:** Lathe refuses images over 268 megapixels before decoding them.
- **WebP export:** a 100 MP image failed to encode on the test machine. Resize it first, or export PNG.
- **HEIC export:** needs a browser with an HEVC encoder. It is tested in Safari's engine on macOS.
- **Text in generated PDFs:** Markdown to PDF and Fill PDF use standard PDF fonts, which cover Western European characters. They refuse other scripts and name the characters instead of printing `?`.

## What a conversion can lose

| Input | What happens | How you are told |
|---|---|---|
| Animated GIF, WebP or PNG | The first frame is used | Result note |
| 10-bit HEIC or 16-bit PNG | Reduced to 8-bit | Result note |
| Multi-page TIFF | The first page is used | Result note |
| Display P3 HEIC | Converted to sRGB, and colours outside sRGB are clipped | Result note |
| HDR HEIC | Colours may look different | Result note |
| HEIC with several images | The primary image is used | Result note |

## What a PDF tool can lose

| Tools | What changes |
|---|---|
| Merge, split, organise, extract, delete, resize, N-up, booklet | Forms, attachments and bookmarks are not carried over. The result says which |
| Any tool that rewrites a signed PDF | The digital signature no longer validates. The result says so |
| Resize, N-up, booklet on a file with layers | Pages are rebuilt as images, so hidden layers stay hidden |
| Fill and Flatten | XFA forms are refused, because changing them would delete the form |
| Crop | The cut area is hidden and stays in the file. Use [Redact PDF](guides/redact-a-pdf.md) to remove it |
