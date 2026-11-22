# Manual device checklist

Automated tests ran in Chromium and WebKit mobile emulation. None of the items below have been run on a physical device. Tick them on a real iPhone (Safari) and a real Android phone (Chrome), then update [browser support](browser-support.md).

Use test documents only.

## Both phones

- [ ] Open the home page. It scrolls smoothly and the animation does not stutter.
- [ ] Choose a photo from the camera roll in [Compress image](https://lathe.ashwinsathian.com/compress-image), run it and download the result.
- [ ] [Redact PDF](https://lathe.ashwinsathian.com/redact-pdf): a swipe scrolls and draws nothing. **Add box** adds a box. Drag it, resize it from its corner and delete it.
- [ ] Run the redaction, tap **Check the result** and confirm the area is black.
- [ ] [Sign PDF](https://lathe.ashwinsathian.com/sign-pdf): draw with a finger, tap the page, drag the signature and save.
- [ ] [Crop image](https://lathe.ashwinsathian.com/crop-image): drag each corner.
- [ ] [Organise PDF](https://lathe.ashwinsathian.com/organize-pdf): move a page, delete it and undo.
- [ ] [Photo editor](https://lathe.ashwinsathian.com/adjust-image): the photo stays visible while you move a slider.
- [ ] Run a tool, turn on airplane mode, reload and run it again.
- [ ] Open a 100-page PDF and a 12 MP photo. Note if the tab reloads.

## iPhone

- [ ] [HEIC to JPG](https://lathe.ashwinsathian.com/heic-to-jpg) on a real photo, a Live Photo and a burst. Colours match the Photos app.
- [ ] [JPG to HEIC](https://lathe.ashwinsathian.com/jpg-to-heic) produces a file that opens in Photos.
- [ ] Add to Home Screen and open it offline.
- [ ] VoiceOver: add a redaction box and move it. Each control is announced.

## Android

- [ ] Install the app from Chrome's menu and open it offline.
- [ ] TalkBack: add a redaction box and move it. Each control is announced.
