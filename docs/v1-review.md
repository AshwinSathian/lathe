# Lathe v1 evidence ledger

Baseline: v0.1.4 (`0a67b43`), frozen and served locally with production headers on 2026-11-22.

Result: **v0.1.4 does not meet a v1 bar.** The review found 21 blockers. No file bytes left the browser in any run, default full-flatten redaction survived every attack, and no crafted file executed script. The blockers are false privacy claims, silently wrong output, and redaction and signing flows that a keyboard user cannot finish.

## How to read this

Three independent reviewers (security, data integrity, UX) and a `loupe` design review received the code and the product's claims. The lead then re-ran their reproductions.

- **Re-run** means the lead executed the reproduction and saw the result.
- **Reviewer** means one reviewer observed it and the lead has not re-run it. Each of these must fail a new test before it is fixed, and is dropped if it does not.
- Severity: **blocker** exposes sensitive data, makes a privacy claim false, silently damages common files, or stops a core flow. **major** is a real defect with a narrower trigger. **minor** is the rest.
- Decision: **fix**, **document** or **cut**.

Independent readers: qpdf (pikepdf 9.11), PDFium, MuPDF 1.26, pypdf, pdfminer, Pillow, sharp, macOS `sips`.

Baseline gates: `check`, `check:docs`, `npm audit` and `build` pass. Playwright: 443 passed, 0 failed, 70 skipped. All 70 skips are conditional (engine-specific, opt-in GPU, `LATHE_URL`, or no HEVC encoder), so those paths have no evidence in that run.

## Blockers

| ID | Claim | How tested | Evidence | Decision | Acceptance check |
|---|---|---|---|---|---|
| B1 | Page removal keeps only what a kept page draws | Re-run. Crafted PDF whose kept page lists images in nested form and pattern resources without drawing them; delete, extract, split, organise | `NESTEDIMGSECRET` and `PATTERNSECRET` survive in all four. Split shows no warning | Fix: keep the conservative name walk, because an operator walk can delete visible content. Treat a parse failure as shared. All four tools warn, and one-click "Remove securely" flattens affected pages | All four tools warn on this fixture. After "Remove securely", both secrets are absent in 3 readers |
| B2 | The page you remove or redact is the one removed | Re-run. PDF with two page trees; xref points at the first | PDF.js shows `DIFFSECRET` as page 1, pdf-lib uses the other tree. Keep-text redaction and delete, extract, split keep `DIFFSECRET` as live text | Fix: normalise once at intake for redact, delete, extract, split and organise, and give those bytes to preview, pdf-lib and render. Refuse on page-count mismatch, disclose repairs | Removing the page shown removes `DIFFSECRET` in all tools |
| B3 | Metadata removal removes location and identity | Re-run. JPEG with GPS through Images to PDF, then metadata wipe | GPS and `ARTISTSECRET` readable from the embedded JPEG after the wipe | Fix: strip JPEG metadata on embed and in the wipe | Pillow reads no EXIF, XMP, IPTC or comment from any embedded image |
| B4 | Stored settings exclude free text | Two reviewers, code read at `workbench.ts:19` | Author, title, watermark, header and footer stored in `localStorage` and prefilled next visit | Fix: allowlist non-text settings, clear old values | No typed value in any storage after use and reload |
| B5 | Redaction applies what you marked | Re-run in Chromium, WebKit, Firefox | Boxes from `a.pdf` stay in `params.regions` after dropping `b.pdf`: 0 visible, 1 applied, black block in output | Fix: clear regions and placements with the file | Replacing the file requires a new box |
| B6 | A result belongs to the file on screen | Re-run | Dropping `photo.jpg` during a run offers `big24mp-cropped.jpg` beside `photo.jpg` | Fix: run token, reject input during a run | Stale completion is never shown |
| B7 | Batch processing | Re-run, 3 browsers | 2 good + 1 corrupt gives 0 outputs | Fix: per-file failure, keep results | Good files download, failed files are named |
| B8 | Preview matches export | Re-run | Slider moved 75 to 10, Download still serves quality 75 with a preview claiming 4.1 KB | Fix: settings change invalidates results | No stale Download after any change |
| B9 | Redaction works by keyboard | Re-run | 0 focusable elements on the page surface, 0 regions from keys | Fix: "Add box" per page, arrow move and resize | Keyboard-only redaction test passes |
| B10 | Signing works by keyboard | Re-run | 0 tab stops, run stays disabled | Fix: "Place on page" button, arrow move | Keyboard-only signing test passes |
| B11 | HEIC converts accurately | Re-run. Display P3 HEIC | P3 (230,60,40) should be sRGB (250,31,14), output (231,60,40). Max error 32 | Fix: colour-manage on decode | Patch error at most 3 against the reference |
| B12 | Compress PDF keeps images intact | Re-run, MuPDF and PDFium | Mean error 93.5 on ICC CMYK, 78.6 on `/Decode` gray, 63.0 on Separation | Fix: only recompress what round-trips, skip the rest | Mean error under 3 on every colour-space fixture |
| B13 | Resize, N-up and Booklet preserve the page | Re-run | Cropped and rotated pages lose words off the sheet. Resize drops form values | Fix: shared placement helper with crop origin | All marked words on sheet at 0, 90, 180, 270 with crop |
| B14 | Markdown to PDF sets your text | Re-run | Non-Latin becomes `?`. `~~not~~ liable` prints "not liable". Table cell truncated | Fix strikethrough, wrapping. Refuse unsupported characters and name them | No `?` substitution, no lost text, strikethrough drawn |
| B15 | Blank-page removal finds blank pages | Re-run | 4 of 5 removed, including "Signed: A. Rao" and a signature stroke | Fix: remove only pages with no marks | Sparse fixture loses only the truly blank page |
| B16 | Flatten locks annotations in place | Re-run | Hidden annotation becomes visible text. Highlight without appearance deleted | Fix: honour flags, keep what cannot be flattened and say so | Hidden stays hidden, highlight survives |
| B17 | Images to PDF has no quality loss | Re-run | P3 JPEG renders wrong. Lossless PNG stored as JPEG, 8.0% of pixels change by more than 8 levels | Fix: keep ICC, keep opaque PNG lossless | Pixel-exact PNG, P3 patch within 3 |
| B18 | The editor shows what will be applied | Re-run. Draw a box, run, reopen the editor by the file chip | Screen shows 0 boxes, `params.regions` holds 1, Run stays enabled. Loupe saw 2 signatures written with 1 on screen | Fix: one editing session per document, marks derived from what is on screen | Reopened editor shows every mark that will be written |
| B19 | Marks can be resized on touch | Reviewer (loupe), measured at 390 px | 18x18 grip sits 0.7 px from the 26x26 delete button, so a missed tap deletes the mark (WCAG 2.5.8) | Fix: larger grip, move delete away | Targets at least 24 px with no adjacent destructive control |
| B20 | Files can be removed by keyboard | Re-run | `span[role=button]` nested in `<button>`, 0 tab stops. On single-file tools it is the only way to clear the file | Fix: real sibling button | Keyboard test removes a file. Replaces M23 |
| B21 | Tools say what they change | Re-run. Structurally signed PDF and XFA form through rotate, watermark, flatten | Flatten deletes the XFA form with no message. Rotate and watermark rewrite a signed file with no warning, which invalidates a real signature. The fixture's signature is structural, so cryptographic validation was not run | Fix: detect both, warn before Sign, state invalidation in results, refuse XFA in fill and flatten | Signed input always produces a notice. XFA input is refused by fill and flatten |

## Major

| ID | Claim | How tested | Evidence | Decision | Acceptance check |
|---|---|---|---|---|---|
| M1 | Models pinned to a commit | Reviewer, mocked Hugging Face | Loader requests `resolve/main/config.json` first, and a changed `main` altered files requested | Fix | Test fails on any `/resolve/main/` request |
| M2 | Third-party files are trusted | Reviewer, code read | ONNX wasm, Tesseract language data and models have no hash check | Fix: verify SHA-256, self-host files under 25 MiB | Tampered file is refused |
| M3 | CSP limits where data goes | Reviewer, mocked | Any jsDelivr package runs as script. POST allowed to Hugging Face and jsDelivr | Fix: remove jsDelivr from `script-src`, narrow `connect-src` | Injected jsDelivr script is blocked, all AI tests pass |
| M4 | Metadata wipe | Re-run | Annotation authors, attachments, form values, layer names, JavaScript, outlines survive | Fix or state what remains | Result lists anything kept |
| M5 | Edited text is gone | Re-run | `ORPHANSECRET` survives rotate, watermark, page numbers, crop, flatten | Fix: collect garbage in shared save | Old revision text absent from all PDF outputs |
| M6 | Page tools keep the document | Reviewer | Merge, split, organise, extract, delete drop forms, attachments, outlines, labels | Fix where safe, else warn | Result states what was dropped |
| M7 | Password removal needs the password | Reviewer | Owner-only PDFs lose restrictions without the owner password | Document or warn | Restricted file produces a clear notice |
| M8 | Compare finds differences | Reviewer | Gray 0.93 "Clause 7" vs "Clause 9": no difference | Fix: lower threshold, diff text | Fixture reports the change |
| M9 | Compress respects target DPI | Reviewer | Image at 3x page: 157 dpi to 65 at Balanced (150 promised) | Fix: use placement | Effective DPI never below target |
| M10 | Repair repairs | Reviewer | 0 of 5 damaged files repaired, native qpdf recovers all 5 | Fix or narrow the claim | Repair rate published from a fixture set |
| M11 | OCR text layer is faithful | Reviewer | `œ`, `€` and curly quotes dropped | Fix | Text layer round-trips those characters |
| M12 | Form filling | Reviewer | Non-WinAnsi input fails | Fix or refuse clearly | Message names the characters |
| M13 | Conversion keeps your image | Reviewer | Animation flattened, 16-bit reduced, TIFF pages lost, wrong primary HEIC image | Fix primary. Warn on the rest | Primary image correct, loss stated in the result |
| M14 | Long jobs | Re-run | No cancel, no unload guard | Fix | Cancel stops a job and the app still works |
| M15 | Results persist | Re-run | Add or remove file wipes results. Removing last file reloads | Fix | Results survive until next run |
| M16 | Files you add are used | Re-run | Extra or wrong files dropped silently | Fix | Message names rejected files |
| M17 | Touch use | Reviewer, emulation | Pages trap scroll. Diagonal swipe draws a redaction box | Fix: explicit mark mode | Swipe scrolls, no box created |
| M18 | Offline after first use | Reviewer | Only tools already run work. Error blames file size | Fix: precache core, honest copy | Offline test in 3 engines, or claim narrowed |
| M19 | Service worker updates | Reviewer, simulated releases | Cache grows, `/vendor/` pinned through update and rollback | Fix | Old entries removed on activate |
| M20 | Model consent | Reviewer | Consent stored before download succeeds | Fix | Failed download asks again |
| M21 | Editors handle bad files | Reviewer | Corrupt or locked PDFs leave a blank editor | Fix | Message shown, Run disabled |
| M22 | Redaction can be corrected | Re-run | Editor disappears after a run | Fix | Boxes can be edited after a run |
| M24 | Focus is managed | Re-run | Focus falls to `<body>` after run, page move, delete | Fix | Focus test passes |
| M25 | Forced colours | Reviewer | Redaction safety toggle identical on and off | Fix | On and off differ in forced colours |
| M26 | PDF worker lifetime | Re-run | 16 PDFs leave 16 workers | Fix | Worker count bounded |
| M27 | Storage-full chaining | Reviewer | Uncaught `QuotaExceededError`, no message | Fix | Message shown |
| M28 | Redaction result can be checked | Reviewer (loupe) | Output shown only as 124 px thumbnails | Fix: reading-width output | Output readable at page width |
| M29 | "Your file stays in this tab" | Re-run via code. `index.astro:23`, handoff writes to IndexedDB | The file can leave the tab's memory for IndexedDB in plaintext | Fix the copy. Encrypt the handoff with AES-GCM, key in `sessionStorage` | Tab killed mid-handoff leaves no plaintext |
| M30 | Signing explains what it does | Reviewer (loupe) | "Not a certified signature" appears only below the tool | Fix: state it in the panel | Line visible beside the signature control |
| M31 | Organise deletes can be undone | Reviewer (loupe) | Delete is instant with no undo or announcement | Fix | Undo restores the page |
| M32 | Phone layouts work | Reviewer (loupe), 390 px | Signature pad about 750 px from the page. Photo sliders and preview cannot be seen together | Fix | One-screen flow at 390 px |
| M33 | Controls are named clearly | Reviewer (loupe) | Primary button reads "Photo editor". Progress bar has no name. No reset for 12 sliders | Fix | Action labels, named progress, Reset all |

## Minor

| ID | Finding | Status | Decision |
|---|---|---|---|
| m1 | `window.__lathe` exposes passwords and output in production | Re-run via code | Fix: test builds only |
| m2 | ZIP entries keep `..` and backslashes from filenames | Reviewer | Fix in `zipOut` |
| m3 | Crop hides content but keeps it, without a result warning | Reviewer | Fix: warn |
| m4 | Optimise SVG keeps `javascript:` animation targets, `foreignObject`, remote images | Reviewer | Fix |
| m5 | Passwords starting with `--` fail as "damaged" | Reviewer | Fix |
| m6 | "No metadata found" is wrong for WebP, GIF, SVG | Reviewer | Fix |
| m7 | Keep-text redaction misses a comment shared by reference | Reviewer | Fix |
| m8 | Redaction drops UserUnit | Reviewer | Fix |
| m9 | Dimension bombs run over 30 s without a limit | Reviewer | Fix: cap before decode |
| m10 | Raw engine text in errors | Reviewer | Fix |
| m11 | Corrupt image error is not announced | Re-run | Fix |
| m12 | Palette listbox markup fails axe (3 violations) | Reviewer | Fix |
| m13 | Compare slider lacks slider semantics | Re-run | Fix |
| m14 | Shift+arrow on fixed-aspect crop moves the box | Re-run | Fix |
| m15 | Touch targets of 18 and 22 px | Reviewer | Fix |
| m16 | Signature object URLs leak (7 created, 0 revoked) | Re-run | Fix |
| m17 | Face detection long task, 327 ms at 12 MP | Reviewer | Document or yield |
| m18 | Conversion pages near-duplicate (similarity 0.645), 16 of 22 unlinked | Reviewer | Fix: format-specific content and links |
| m19 | One shared social card, no `twitter:image`, home mobile Lighthouse 79 | Reviewer | Fix |
| m20 | XMP title stale after metadata edit | Reviewer | Fix |
| m21 | Extract images skips stencil masks | Reviewer | Fix or document |
| m22 | 100 MP WebP export fails with "Encoding error" | Reviewer | Fix message, publish limit |
| m23 | `npm run smoke` omits security and adversarial specs | Re-run via `package.json` | Fix |

## CodeQL alerts

| Alert | Finding | Decision |
|---|---|---|
| `js/missing-origin-check`, `worker.ts:18` | A dedicated worker receives messages only from the page that created it. Forged `postMessage` calls changed nothing | Dismiss with this evidence |
| `js/bad-tag-filter`, `tests/live.spec.ts:48` | Test code that locates a script to hash it, and sanitises nothing | Fix the regex if simple, else dismiss |
| `js/http-to-file-access`, `scripts/vendor.mjs:19` | Written only after the pinned SHA-256 matches | Dismiss with this evidence |
| `js/file-system-race`, `scripts/vendor.mjs:19` | Exploiting it needs write access to the build tree | Fix by removing the check-then-read, else dismiss |

## Held up

- 82 tool pages, 1,964 requests, 0 non-GET, 0 containing file markers. 72 tools completed a run. The other 10 did not, including AI tools on mocked models, so they are not covered by this result.
- Default redaction removed text, layers, annotations, fields, attachments, outlines, destinations, JavaScript, XMP and old revisions across five readers.
- Box alignment held on rotation, CropBox offset, negative origin and UserUnit.
- Passwords were not found in `localStorage`, IndexedDB, Cache Storage or the console.
- axe found 0 WCAG A/AA violations on 85 static pages. No overflow at 320 and 390 px.
- A 500-page PDF, a 100 MB PDF, a 100 MP image and a 200-file batch completed without a crash, except the 100 MP WebP export.

## Not tested so far

- Real phones, VoiceOver, and files produced by Word, LibreOffice, InDesign or a physical scanner.
- Real model inference, tampered WASM execution, and a Windows ZIP extractor.
- Firefox and WebKit for the integrity findings, which ran in Chromium only.
- Real iPhone HDR, Live Photo and burst files. Test HEICs came from `sips` and pillow-heif.

## Test-run disclosure

One security probe opened a WebSocket to `wss://attacker.hf.co/`, which the local mock did not intercept, so the handshake may have left the machine. It carried no file data, and the probe was removed.

## Resolution at v1.0.0

Every blocker and major item above was fixed, narrowed or documented in slices 1 to 15 of [the plan](v1-plan.md), with tests in `tests/`. Items that stay open:

- Real phones, VoiceOver, TalkBack, and files from Word, LibreOffice, InDesign or a physical scanner have not been tested. See the [device checklist](device-checklist.md).
- Real iPhone HDR, Live Photo and burst files have not been tested.
- Integrity fixes were checked with independent readers in Chromium. Firefox and WebKit run the repo's own output tests.
- Keep-text redaction remains best effort and is labelled as weaker.
- Home page mobile Lighthouse varied across three lab runs: performance 76, 100 and 100.
- A pre-publication claim audit of about 120 statements found 18 that were false or overstated. All 18 were corrected.
