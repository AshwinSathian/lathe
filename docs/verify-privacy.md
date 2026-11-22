# Verify that your files stay on your device

You do not have to take Lathe's word for it. Your browser can show every request a page makes, and the steps below take about two minutes.

## Watch the network

1. Open any tool, such as [Compress PDF](https://lathe.ashwinsathian.com/compress-pdf).
2. Open your browser's developer tools (F12, or Cmd Option I on a Mac) and select the **Network** tab.
3. Tick **Preserve log**, then clear the list.
4. Add a file and run the tool.
5. Look at the **Method** column. Every entry should be `GET`, fetching the app's own code. A file upload would appear as `POST` or `PUT` with a request body.

## Run it with no network

1. Use a tool once while online, so your browser saves it.
2. Turn off Wi-Fi and mobile data.
3. Reload the page and run the tool again.

A tool that works with no connection cannot be sending your file anywhere. See [offline use](offline.md) for what is saved and when.

## Read the Content Security Policy

The site sends a `Content-Security-Policy` header that tells your browser which addresses a page may contact. To read it, select the first request in the Network tab and open its response headers.

On every page except two, `connect-src` is `'self' blob: data:`, so the page can only contact this site. [Remove background](https://lathe.ashwinsathian.com/remove-background) and [Upscale image](https://lathe.ashwinsathian.com/upscale-image) also allow jsDelivr and Hugging Face, because their models are too large to host here. On those two pages the download is a request for a model file, and each file is checked against a [pinned SHA-256](ai-models.md).

## Inspect the code

Lathe is [open source under the MIT licence](https://github.com/AshwinSathian/lathe). Each release publishes the built site with an SBOM and signed build provenance, so you can match what you run to the source. For the strongest guarantee, [host it yourself](self-hosting.md) on a network with no outbound access.

## How the project tests this

An automated test runs 80 of the 82 tool pages in Chromium under network capture, using the real AI models. It fails if any request is not `GET` or `HEAD`, carries a body, or goes to a third-party address that is not a pinned model file. The other two pages export HEIC and need an HEVC encoder that the test browser does not have. The test is in [`tests/network.spec.ts`](../tests/network.spec.ts).

## What this cannot prove

These checks show what the site does while you watch. They do not protect you from a browser extension that can read pages, malware on your device, or a future compromise of the site. The [threat model](threat-model.md) covers each of these.
