# Lathe v1.0.0 plan

Built from [the evidence ledger](v1-review.md). IDs below refer to it.

## The v1.0.0 bar

v1.0.0 ships only when every check is true.

**Privacy**
1. Every B and M privacy item (B1 to B5, B18, B21, M1 to M5, M29) has a test that failed on v0.1.4 and passes now.
2. All 82 tools complete a run under network capture, with real inference for each AI engine. Every cross-origin request matches an exact allowlist of pinned URLs, and none carries a body.
3. `script-src` contains no third-party origin. `connect-src` allows third parties only on AI routes, in `_headers` and nginx. Every third-party download is verified by SHA-256 or self-hosted, including when read back from cache (poisoned-cache test).
4. After using each tool, no file data, password, signature or typed text remains in `localStorage`, IndexedDB or Cache Storage. A tab killed mid-handoff leaves no plaintext.
5. `window.__lathe` is undefined for every visitor. It exists only when the test harness sets a flag before page load, so the full suite can still run against production. A hook-free spec drives one tool per engine through real upload, click and download.

**Output integrity**
6. B7, B11 to B17, B21 and M6 to M13 each have a fixture test that opens the output in two independent readers.
7. No tool replaces a character with `?` or drops text without telling the user.
8. Any loss a tool cannot avoid (animation, 16-bit depth, extra pages, forms) is stated in its result.

**Reliability and access**
9. B5 to B20 and M13 pass in Chromium, WebKit and Firefox, or the engine difference is published.
10. Cancel works on long jobs. One failed file never loses finished results.
11. Redaction, signing, crop, page reordering and file removal pass keyboard-only tests and touch-emulation tests.
12. axe reports 0 violations on all tool pages and in editor, result and error states.

**Release**
13. Every claim in the README, site and docs traces to a test or a measurement, or is removed.
14. All four CodeQL alerts are fixed or dismissed with recorded evidence.
15. All ship gates pass and CI is green. The full suite passes against production.
16. Measured limits are published.

## Slices, blockers first

Each slice ends with a failing test turned green, docs and CHANGELOG updated, and all gates run. A slice with a security fix may ship as a 0.x patch.

| # | Slice | Items | Root-cause change |
|---|---|---|---|
| 1 | Test seam | m1, m23 | Hook needs a flag set before load. Hook-free production spec. `smoke` covers security specs |
| 2 | Service worker first | M19 | Versioned cache, stale engines removed, so later patches reach returning users |
| 3 | One editing session | B5, B6, B8, B18, M14, M15, M16, M21, M22, M28 | Marks and results belong to a session keyed to the file. Run token and Cancel |
| 4 | Batch results | B7 | Shared `each` returns successes plus named failures |
| 5 | PDF intake and save | B1, B2, B21, M5, M6, M7, m7, m8 | Serialised qpdf normalise at intake for page-removal and redaction tools. `collectGarbage` in save. Signed and XFA detection. "Remove securely" |
| 6 | Metadata and storage | B3, B4, M4, M29, m2, m4, m6, m20 | JPEG strip on embed, settings allowlist, encrypted handoff, safe ZIP names |
| 7 | Supply chain | M1, M2, M3, M20 | Pinned config, `fetch` integrity for ONNX, verified model cache, self-hosted OCR data, per-route CSP |
| 8 | PDF output | B12, B13, B15, B16, B17, M8, M9, M10, m21 | Recompress only safe colour spaces, one placement helper. Compare reports DPI and a text diff. Blank pages preselected for review. Repair reports page counts |
| 9 | Text | B14, M11, M12 | Shared encoder that keeps WinAnsi and refuses the rest by name |
| 10 | Image fidelity | B11, M13, m9, m22 | P3 to sRGB in plain JS, primary HEIC image, dimension cap, stated loss. Blur faces defaults to a solid block and asks for review |
| 11 | Keyboard and touch | B9, B10, B19, B20, M17, M24, M25, M30 to M33, m11 to m16 | Shared box controls, mark mode, real buttons, forced-colours rules |
| 12 | Offline and workers | M18, M26, M27, m17 | Build manifest precache, worker disposal |
| 13 | Discovery | m18, m19 | Format-specific copy, internal links, per-tool cards |
| 14 | Claims and release | m3, m5, m10, CodeQL, bar 13 to 16 | Claim audit, limits page, runbook, scheduled production check, manual device checklist |

## Out of v1

- **PDF to Word and Excel.** Output quality is not proven.
- **A guarantee for keep-text redaction.** It stays available, labelled as weaker, because no test can prove it safe for every PDF. Full flatten remains the default.
- **Unicode fonts in generated PDFs.** They add large downloads. Unsupported characters are refused by name.
- **Keeping animation, 16-bit depth and multi-page TIFF through conversion.** The result states the loss.
- **Certificate-based signing and XFA editing.** Lathe warns and refuses instead.
- **Claims about real phones, VoiceOver, or Word, LibreOffice and InDesign files** until someone runs them. A manual checklist ships instead.
