// Builds real fixtures: photos with EXIF and GPS, and PDFs with text, images and forms.
// photo.heic is committed, because only macOS can create one without shipping an encoder.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
const dir = "tests/fixtures";
export default async function setup() {
  mkdirSync(dir, { recursive: true });
  if (existsSync(`${dir}/form.pdf`)) return;
  const W = 900, H = 600;
  const svg = (a: string, b: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="300" cy="280" r="150" fill="#fff" opacity=".85"/><rect x="520" y="150" width="240" height="300" fill="#123"/><text x="60" y="540" font-family="Arial" font-size="64" fill="#fff">Hello Lathe 2026</text></svg>`);
  const photo = sharp(svg("#d33", "#26a"));
  await photo.clone().jpeg({ quality: 92 }).withExif({ IFD0: { Make: "LatheCam", Model: "T1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "9/1 58/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "76/1 17/1 0/1" } }).toFile(`${dir}/photo.jpg`);
  await sharp(svg("#2a7", "#fc3")).jpeg({ quality: 90 }).toFile(`${dir}/photo2.jpg`);
  await photo.clone().png().toFile(`${dir}/photo.png`);
  await photo.clone().webp().toFile(`${dir}/photo.webp`);
  await photo.clone().avif().toFile(`${dir}/photo.avif`);
  await photo.clone().tiff().toFile(`${dir}/photo.tiff`);
  await photo.clone().gif().toFile(`${dir}/photo.gif`);
  await sharp(svg("#111", "#999"), { animated: false }).resize(200).png().toFile(`${dir}/small.png`);
  writeFileSync(`${dir}/logo.svg`, `<?xml version="1.0"?><!-- editor junk --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><metadata>junk</metadata><script>alert(1)</script><g><circle cx="60.00000" cy="60.00000" r="50.0000" fill="#ff0000"/></g></svg>`);

  const base = async (n: number, label: string) => {
    const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), j = await d.embedJpg(await sharp(svg("#d33", "#26a")).jpeg({ quality: 95 }).toBuffer());
    d.setTitle("Secret title"); d.setAuthor("Hidden Author");
    for (let i = 0; i < n; i++) { const p = d.addPage([595, 842]); p.drawText(`${label} page ${i + 1} TOPSECRET`, { x: 60, y: 760, size: 22, font: f }); p.drawImage(j, { x: 60, y: 300, width: 450, height: 300 }); p.drawRectangle({ x: 60, y: 200, width: 100, height: 40, color: rgb(.1, .4, .8) }); }
    return d;
  };
  writeFileSync(`${dir}/a.pdf`, await (await base(5, "Alpha")).save());
  writeFileSync(`${dir}/b.pdf`, await (await base(2, "Bravo")).save());
  const rot = await base(1, "Rotated"); rot.getPage(0).setRotation((await import("pdf-lib")).degrees(90)); writeFileSync(`${dir}/rotated.pdf`, await rot.save());
  const blank = await base(2, "Blanks"); blank.insertPage(1, [595, 842]); writeFileSync(`${dir}/blank.pdf`, await blank.save());
  const fm = await PDFDocument.create(), pg = fm.addPage([595, 842]), form = fm.getForm(), tf = form.createTextField("full.name"); tf.addToPage(pg, { x: 60, y: 700, width: 300, height: 30 }); form.createCheckBox("agree").addToPage(pg, { x: 60, y: 650, width: 20, height: 20 });
  writeFileSync(`${dir}/form.pdf`, await fm.save());
  writeFileSync(`${dir}/notes.md`, "# Title\n\nSome **bold** and *italic* with `code` and a [link](https://example.com).\n\n- one\n- two\n\n> quote\n\n```\ncode block\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
}
