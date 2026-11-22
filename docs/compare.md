# How Lathe compares

Choose by where your file is processed. Most free online PDF and image sites upload your file to their server. Local tools do the work on your own device. Facts below about other projects come from their public repositories, checked on 2026-11-22.

| | Lathe | [BentoPDF](https://github.com/alam00000/bentopdf) | [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) | Typical upload site |
|---|---|---|---|---|
| Where files are processed | Your browser | Your browser | Desktop app, browser UI or your own server | The site's server |
| Scope | Images and PDFs | PDFs | PDFs | Varies |
| Licence | MIT | AGPL-3.0, with a commercial option | Open-core | Proprietary |
| Self-hosting | Docker or any static host | Yes | Yes | No |

## When another tool is the better choice

- Pick **Stirling-PDF** if your team wants a shared server or a REST API.
- Pick **BentoPDF** if you want a PDF-only toolkit in the browser and its licence suits you.
- Pick a desktop app such as Adobe Acrobat if you need certificate-based signatures, XFA forms or print-production colour.

## When Lathe is the better choice

Pick Lathe when a file is sensitive, when you need images and PDFs in one place, or when you need an MIT-licensed base to build on. See [how to verify that it stays local](verify-privacy.md).
