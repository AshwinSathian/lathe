# How to redact a PDF so the text is really gone

To redact a PDF safely, the text under the black box must be removed from the file. Drawing a black rectangle in most PDF editors only covers it, and anyone can select and copy the text underneath. [Lathe's Redact PDF](https://lathe.ashwinsathian.com/redact-pdf) rebuilds each page from pixels on your device, so the original content is not in the output.

## Steps

1. Open [Redact PDF](https://lathe.ashwinsathian.com/redact-pdf) and add your file.
2. Drag a box over everything to remove. On a keyboard or phone, use **Add box on page N**, then move it with the arrow keys or your finger.
3. Leave **Flatten every page (recommended)** on.
4. Select **Apply redactions**.
5. Select **Check the result** and read every page at full size.
6. Download the file. Use **Back to editing** if you missed something.

## What full flatten removes

With full flatten, the output holds one image per page and nothing else from the source. An automated test confirmed these were gone, using five independent PDF readers: visible text, hidden layers, annotations, form values, attachments, bookmarks, named destinations, JavaScript, XMP and document metadata, and text from earlier revisions.

The trade-off is that text is no longer selectable. Run [OCR PDF](https://lathe.ashwinsathian.com/ocr-pdf) afterwards if you need it searchable, and check that the OCR did not read anything you meant to hide.

## When to turn full flatten off

Turning it off keeps pages you did not mark as real text. It is **weaker**, and the tool says so. Lathe still flattens any kept page that shares an image, form, pattern or annotation with a redacted page, but it cannot prove that an unmarked page hides nothing. Use it only for documents you trust, and never for anything legally or medically sensitive.

## Mistakes to avoid

- **Redacting a word but not its other occurrences.** Search the document first. Lathe redacts only the areas you mark.
- **Forgetting headers, footers and page numbers,** which often repeat a name or case number.
- **Leaving context.** A name can be inferred from a job title or the width of the black box.
- **Keeping the original next to the redacted copy.** Lathe changes only the output file.
- **Using blur.** [Blur and pixelation can sometimes be reversed](https://lathe.ashwinsathian.com/censor-image). Use a solid block.

## Related

- [Remove PDF metadata](https://lathe.ashwinsathian.com/pdf-metadata)
- [Delete PDF pages](https://lathe.ashwinsathian.com/delete-pages)
- [Threat model](../threat-model.md)
