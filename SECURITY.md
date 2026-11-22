# Security policy

Report vulnerabilities through [GitHub private reporting](https://github.com/AshwinSathian/lathe/security/advisories/new). Please do not open a public issue. You can expect a first reply within 7 days.

Only the latest release and the live site at [lathe.ashwinsathian.com](https://lathe.ashwinsathian.com) receive fixes.

## In scope

Lathe has no backend or accounts, and it opens files from strangers. These are the problems that matter most:

- anything that sends file contents, passwords or signatures off the device
- script execution from a crafted image, SVG, PDF, filename or metadata field
- redaction that leaves the hidden content recoverable from the output file
- metadata removal that leaves location or identity data behind
- PDF encryption that is weaker than the AES-256 the tool claims
- a gap in the Content Security Policy that lets a page reach an unlisted host

## Out of scope

- Memory exhaustion from a very large file, which only affects your own tab
- Reversing blur or pixelation. The tool warns about this and offers a solid block
- Cracking a PDF password, which Lathe does not attempt
- Vulnerabilities in a dependency with no path to exploit them in Lathe. Report those upstream

The design behind these boundaries is in the [threat model](docs/threat-model.md).
