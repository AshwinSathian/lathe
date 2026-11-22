# AI models

Lathe's AI tools run on your device. The model is downloaded to your browser, and your image is never sent to it over a network.

| Tool | Model | Download | Served by | Licence |
|---|---|---|---|---|
| [Remove background](https://lathe.ashwinsathian.com/remove-background), with WebGPU | BiRefNet Lite, 1024 px | 115 MB | Hugging Face | MIT |
| Remove background, without WebGPU | MODNet, quantised | 7 MB | Hugging Face | Apache-2.0 |
| [Upscale image](https://lathe.ashwinsathian.com/upscale-image), with WebGPU | Swin2SR x2 | 54 MB | Hugging Face | Apache-2.0 |
| Upscale image, without WebGPU | Swin2SR x2, quantised | 22 MB | Hugging Face | Apache-2.0 |
| [Blur faces](https://lathe.ashwinsathian.com/blur-faces) | MediaPipe BlazeFace | 16 MB with its runtime | This site | Apache-2.0 |
| [Image to text](https://lathe.ashwinsathian.com/ocr-image), [OCR PDF](https://lathe.ashwinsathian.com/ocr-pdf) | Tesseract LSTM | Under 3 MB per language | This site | Apache-2.0 |

## How a model reaches your device

1. The tool asks before its first download and states the size.
2. The page fetches the file from a commit-pinned address.
3. The engine worker computes its SHA-256 and compares it with the value in [`src/engine/pins.json`](../src/engine/pins.json). A file that does not match is refused.
4. A verified file is cached. It is checked again every time it is read, so a changed cache entry is discarded.

The ONNX runtime is 26 MB, over the host's limit per file, so it comes from jsDelivr with a subresource integrity check. The worker that holds your files cannot reach any third-party host, because its Content Security Policy allows only this site.

## What AI tools get wrong

- **Background removal** can clip hair and fine edges. The CPU model is built for portraits.
- **Upscaling** invents plausible detail. Do not use it to read a licence plate or a face in evidence.
- **Face detection** can miss a face, especially in profile or at small sizes. Check every result, and prefer the solid block, because blur and pixelation can sometimes be reversed.
- **OCR** makes mistakes on poor scans and handwriting. Proofread before you rely on the text.
