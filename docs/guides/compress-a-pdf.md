# How to compress a PDF without damaging it

Most of a PDF's size is its images. [Compress PDF](https://lathe.ashwinsathian.com/compress-pdf) re-encodes them with MozJPEG, reduces those stored at more detail than the page can show, and rewrites the file with qpdf. Text and vector graphics stay as they are, so the document remains searchable.

## Choose a level

| Level | Target | Use for |
|---|---|---|
| Print | 220 dpi | Documents you will print |
| Balanced | 150 dpi | Email and everyday sharing |
| Smallest | 96 dpi | Reading on screen only |

The target applies to where each image is actually drawn. A small logo and a full-page photo are sized separately, and an image shown enlarged keeps the pixels it needs.

## What is left alone

Lathe skips images that JPEG conversion could misread. CMYK, spot colours, inverted images, masks, indexed colour and premultiplied transparency keep their pixel values, because converting them can shift or invert colours. A PDF made mostly of those will shrink less.

## If the file does not get smaller

A PDF that is already optimised, or that is mostly text, may have nothing to remove. Lathe then keeps your original and tells you. For a scan, try the Smallest level.

## Signed documents

Any change invalidates a digital signature, and the result warns you. Compress before signing.
