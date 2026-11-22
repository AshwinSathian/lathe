# Adding a tool

This example adds an "Invert colours" image tool.

## 1. Register it

Add an entry to `base` in [`src/data/tools.ts`](../src/data/tools.ts). That creates the page, settings panel, SEO data, sitemap entry and search result.

```ts
{
  id: "invert-image",
  name: "Invert colours",
  kind: "image",
  group: "Edit",
  blurb: "Turn an image into its colour negative.",
  detail: "Flips each colour channel and leaves transparency alone.",
  accepts: IMG,
  multi: true,
  live: true,
  tech: "Canvas",
  controls: [s("format", "Format", [["auto", "Keep format"], ...FORMATS.slice(0, 4)])],
},
```

## 2. Write the engine

Add a function with the same id to `imageTools` in [`src/engine/image.ts`](../src/engine/image.ts), or to `pdfTools` in `pdf.ts`. The `edit` helper handles batches, previews and encoding.

```ts
"invert-image": edit((img) => {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; }
  return new ImageData(d, img.width, img.height);
}, "-inverted"),
```

Throw `Say` from `core.ts` for an error the person can act on. Its message appears in the interface.

## 3. Test it

`tests/tools.spec.ts` picks up the new entry and checks that it returns a valid file. If the tool makes a specific promise, add a test for it. Here that would be that a white pixel comes back black.

## 4. Update the docs

```bash
npm run docs
```

This refreshes the README tool table, `docs/tools.md` and the licence notices. CI fails if you forget.
