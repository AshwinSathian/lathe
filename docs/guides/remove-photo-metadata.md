# How to remove GPS location and metadata from a photo

Most phone photos record where and when they were taken, along with the device model. To remove this before sharing, open [Remove image metadata](https://lathe.ashwinsathian.com/remove-metadata), add the photo and download the clean copy. The photo is processed on your device.

## What a photo can reveal

| Metadata | Example |
|---|---|
| GPS | Latitude and longitude, often accurate enough to identify a home |
| Date and time | When the photo was taken |
| Device | Camera or phone model, and sometimes a serial number |
| Author | A name or copyright line set in the camera or an editor |
| Thumbnail | A small preview, which can show the photo before it was cropped |

Check any photo first with the [image metadata viewer](https://lathe.ashwinsathian.com/view-metadata).

## What Lathe removes

EXIF, GPS, XMP, IPTC, comments, embedded thumbnails and data appended after the image. For JPEG and PNG, the compressed pixels are left untouched, so quality does not change. A JPEG that needs its rotation applied is re-encoded so it still displays upright. Other formats are saved again without metadata.

## Photos inside PDFs

A PDF can carry a photo's full metadata inside it. [Images to PDF](https://lathe.ashwinsathian.com/images-to-pdf) strips it when embedding a JPEG, and the wipe in [Edit PDF metadata](https://lathe.ashwinsathian.com/pdf-metadata) removes it from JPEGs already in a PDF. The wipe tells you what remains, such as comments or attachments.

## What metadata removal cannot do

It does not change what is visible. A street sign, a reflection or a document on a desk stays in the picture. Use [Pixelate image](https://lathe.ashwinsathian.com/censor-image) with a solid block for those.
