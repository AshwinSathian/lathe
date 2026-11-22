# Getting started

Lathe is a set of 82 image and PDF tool pages that run in your browser. You open a tool, add a file, choose settings and download the result. Your file stays on your device, and there is no account, watermark or usage limit.

## Use a tool

1. Open [Lathe](https://lathe.ashwinsathian.com) and drop a file on the home page, or press Cmd K (Ctrl K on Windows and Linux) to find a tool by name.
2. Adjust the settings in the panel. Tools marked as live show a preview while you drag a slider.
3. Press the main button, such as **Compress image** or **Apply redactions**.
4. Check the note under the result. It tells you anything the tool changed or could not keep.
5. Download the file, or pick a next tool to carry the result straight into it.

## Read the note on every result

The note is part of the output. A tool uses it to say that a digital signature no longer validates, that bookmarks were not carried over, that an animation became its first frame, or that wide-gamut colour was converted to sRGB. If you change a setting after a run, the result is labelled as out of date and its button reads **Download earlier version**.

## Work with several files

Tools that accept several files process them one at a time. If one file is damaged, the others still finish, and the result names the file that failed. **Download all as ZIP** collects the finished files.

## Cancel a job

While a tool runs, a **Cancel** button appears under the progress bar. It stops the engine at once and leaves your files in place.

## Use the keyboard

| Action | Keys |
|---|---|
| Find a tool | Cmd K or Ctrl K |
| Run the tool | Cmd Enter or Ctrl Enter |
| Add a redaction box or place a signature | Tab to **Add box** or **Place signature**, then Enter |
| Move a selected box | Arrow keys, with Alt for larger steps |
| Resize a selected box | Shift and arrow keys |
| Remove a selected box | Delete or Backspace |

## Use a phone

A finger scrolls the document. To mark a PDF, tap **Add box** or **Place signature**, then drag the mark into position. This flow has been tested in Chromium and WebKit mobile emulation, and [has not yet been confirmed on physical phones](browser-support.md).

## Next

- [Verify that your files stay local](verify-privacy.md)
- [What each tool can handle](limits.md)
- [Frequently asked questions](faq.md)
