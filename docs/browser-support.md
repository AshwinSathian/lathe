# Browser support

The automated suite runs in Chromium, Firefox and WebKit builds from Playwright. It has not been run on physical phones.

| Capability | Chromium | Firefox | WebKit / Safari |
|---|---|---|---|
| All non-AI tools | Tested | Tested | Tested |
| HEIC import | Tested | Tested | Tested |
| HEIC export | Needs a build with an HEVC encoder | Skipped unless an encoder exists | Tested on macOS |
| GPU background removal | Tested on Apple Metal | Not tested | Not tested |
| CPU AI tools | Tested | Not tested | Not tested |
| Offline after first use | Tested | Not tested | Not tested |

Playwright's Chromium has no HEVC encoder. Branded Chrome and Edge may have one, depending on the operating system and hardware. Lathe asks the browser at run time and shows a message if it cannot encode.

Very large files are limited by your device's memory and by the 4 GB ceiling of 32-bit WebAssembly.
