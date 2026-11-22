# Offline use

A tool works offline after you reload its page and run it once while online. Each release clears saved tools, so run it again after an update. Your browser saves each tool's code as it runs.

## What works offline

| Situation | What happens |
|---|---|
| A tool you reloaded and ran online | Works normally |
| The tool finder | Works, and lists every tool |
| A tool you have never opened | Shows a notice asking you to open it once while online |
| A tool opened but never run | Its page loads, and running it asks you to go online once |
| Remove background or Upscale image | May work if your browser's HTTP cache still holds the 26 MB runtime. Not tested |

## Install it

Lathe is a progressive web app. In Chrome or Edge, use **Install** in the address bar. In Safari on iPhone, use **Share**, then **Add to Home Screen**. It runs in its own window and can be opened with no connection.

## What is stored

Saved code lives in your browser's cache. Each release clears the saved tools, and the prior release's code chunks are kept only so that a tab left open keeps working. Downloaded models are kept in a separate cache and are checked against their SHA-256 each time they are read. Your files are not saved in either.

To clear everything, remove this site's data in your browser settings.

## Tested

The service worker's offline and update behaviour is tested automatically in Chromium. Firefox and Safari [have not been verified](browser-support.md).
