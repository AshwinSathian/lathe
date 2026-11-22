# Frequently asked questions

## Privacy

### Does Lathe upload my files?

No. Every tool runs in your browser with WebAssembly, WebGL and Web Workers, and the site has no upload endpoint. An automated test runs 80 of the 82 tool pages under network capture and fails on any request that carries data. You can [check it yourself](verify-privacy.md) in two minutes.

### Is it safe for a passport, contract or medical record?

Your file stays on your device, which removes the largest risk of online tools. You should still consider who else can use that device, and any browser extensions you have installed, because extensions can read pages. For the strongest setup, [self-host Lathe](self-hosting.md). The [threat model](threat-model.md) lists what Lathe cannot protect against.

### Does Lathe use analytics or cookies?

No. There are no analytics, cookies or accounts. Cloudflare, which hosts the public site, inserts a bot-detection script into each page. Lathe's Content Security Policy blocks that script, so browsers log one console error.

### What does Lathe store on my device?

Your slider and menu choices, the app's code, and any AI models you chose to download. It never stores your files, passwords, signatures or anything you type. A file passed to the next tool is held briefly in encrypted form and deleted when that tool opens.

## PDF

### Does blacking out text in a PDF really remove it?

Only if the tool removes the text underneath. Many editors draw a box that can be copied straight through. Lathe's [Redact PDF](guides/redact-a-pdf.md) rebuilds every page from pixels by default, so the original text, layers, comments and metadata are gone from the output.

### Can Lathe open a password-protected PDF?

Yes, if you know the password. Lathe does not crack passwords. A PDF with only an owner password opens without one, and the result tells you that its restrictions were not kept.

### Is Sign PDF legally binding?

Lathe places an image of your signature. It is not a certificate-based digital signature, and whether a visual signature is acceptable depends on your jurisdiction and the other party. Ask a lawyer if the document matters.

### Why did my PDF lose its bookmarks or form fields?

Tools that rebuild a document from selected pages do not carry them over, and the result says so. See [limits](limits.md).

## Images

### How do I convert iPhone HEIC photos to JPG?

Open [HEIC to JPG](https://lathe.ashwinsathian.com/heic-to-jpg), drop in your photos and download them. Display P3 colour is converted to sRGB correctly. The [HEIC guide](guides/convert-heic.md) explains your options.

### How do I remove GPS location from a photo?

Use [Remove image metadata](https://lathe.ashwinsathian.com/remove-metadata). It removes EXIF, GPS, XMP, IPTC, comments and thumbnails. See the [metadata guide](guides/remove-photo-metadata.md).

## General

### Is Lathe free?

Yes. There is no account, watermark, paid tier or limit on how many files you process. The code is [MIT licensed](https://github.com/AshwinSathian/lathe).

### Does it work offline?

Yes, for any tool you have already used on that device. See [offline use](offline.md).

### Which browsers does it support?

Current Chrome, Edge, Firefox and Safari. The test suite runs in the Chromium, Firefox and WebKit engines. See [browser support](browser-support.md) for what has and has not been tested.

### Who makes Lathe?

Lathe is an open-source project by [Ashwin Sathian](https://github.com/AshwinSathian). Report a problem through [GitHub issues](https://github.com/AshwinSathian/lathe/issues), or a vulnerability through the [security policy](https://github.com/AshwinSathian/lathe/security/policy).
