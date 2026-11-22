# Offline use

A Lathe tool works with no connection once you have used it online on that device. Your browser saves the code for each tool the first time it runs.

## What works offline

| Situation | What happens |
|---|---|
| A tool you have already run | Works normally |
| The tool finder | Works, and lists every tool |
| A tool you have never opened | Shows a notice asking you to open it once while online |
| A tool opened but never run | Its page loads, and running it asks you to go online once |
| Remove background or Upscale image | Works offline after its model has downloaded |

## Install it

Lathe is a progressive web app. In Chrome or Edge, use **Install** in the address bar. In Safari on iPhone, use **Share**, then **Add to Home Screen**. It runs in its own window and can be opened with no connection.

## What is stored

Saved code lives in your browser's cache. Each release replaces the previous one, and the prior release's code chunks are kept only so that a tab left open keeps working. Downloaded models are kept in a separate cache and are checked against their SHA-256 each time they are read. Your files are not saved in either.

To clear everything, remove this site's data in your browser settings.

## Tested

The service worker's offline and update behaviour is tested automatically in Chromium. Firefox and Safari [have not been verified](browser-support.md).
