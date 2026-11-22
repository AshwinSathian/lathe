# Supported formats

## Images

| Format | Open | Save | Notes |
|---|---|---|---|
| JPEG | Yes | Yes | Encoded with MozJPEG |
| PNG | Yes | Yes | Lossless, optional OxiPNG optimisation |
| WebP | Yes | Yes | Lossy, with transparency |
| AVIF | Yes | Yes | Falls back to a WebAssembly decoder |
| JPEG XL | Yes | Yes | Decoded in WebAssembly, so your browser need not support it |
| HEIC, HEIF | Yes | Needs an HEVC encoder | Decoded with libheif in every browser |
| GIF | First frame | Yes | Use [GIF to frames](https://lathe.ashwinsathian.com/gif-to-frames) for every frame |
| TIFF | First page | Yes | |
| BMP | Yes | Yes | |
| ICO | Yes | Yes | |
| SVG | Yes | Optimised SVG | Rendered without running its scripts |

## PDF

Lathe reads standard PDF files, including those encrypted with RC4 or AES when you have the password. It writes AES-256 encryption. It does not edit XFA forms or create certificate-based digital signatures.

## Why PDF to Word and Excel are missing

Client-side conversion to Word and Excel does not yet produce output good enough to trust with a real document, so Lathe leaves it out instead of offering a result that looks right and is not.
