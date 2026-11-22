# How to convert HEIC photos to JPG, PNG or WebP

HEIC is the format iPhones use for photos since iOS 11. Chrome and Firefox cannot open it, and many apps and upload forms reject it. To convert, open [HEIC to JPG](https://lathe.ashwinsathian.com/heic-to-jpg), drop in one photo or a whole batch, and download the results. Nothing is uploaded.

## Which format to choose

| Choose | When | Trade-off |
|---|---|---|
| [JPG](https://lathe.ashwinsathian.com/heic-to-jpg) | Sharing, email, forms | Larger than HEIC, no transparency |
| [PNG](https://lathe.ashwinsathian.com/heic-to-png) | Editing, keeping every pixel | Several times larger |
| [WebP](https://lathe.ashwinsathian.com/heic-to-webp) | Websites | Some older apps cannot open it |

## What happens to quality and colour

iPhones capture in Display P3, a wider colour range than standard sRGB. Lathe reads the photo's colour profile and converts it correctly, so skin and skies keep their colour. Colours beyond sRGB are brought to the nearest value, and the result note tells you this happened.

| In the file | What Lathe does |
|---|---|
| Rotation | Applied |
| Alpha | Kept in PNG and WebP |
| Several images, such as a burst | Uses the primary image and says so |
| 10-bit depth | Reduced to 8-bit and says so |
| HDR | May look different and says so |

Real iPhone HDR, Live Photo and burst files have not yet been tested. The test files were created with macOS tools.

## Converting to HEIC

[JPG to HEIC](https://lathe.ashwinsathian.com/jpg-to-heic) uses your browser's own HEVC encoder, so Lathe ships no encoder of its own. It works in Safari on macOS. Other browsers tell you if they cannot encode.
