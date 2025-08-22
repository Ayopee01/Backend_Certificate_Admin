// src/render/index.js
const JSZip = require('jszip');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('fontkit'); // <— สำคัญ ต้องมีเพื่อรองรับฟอนต์ .ttf/.otf
const { hexToRgb01, slug } = require('./utils/helpers');

/** สร้าง SVG overlay สำหรับกรณี template เป็นรูปภาพ (ใช้กับ sharp) */
function svgTextOverlay({ w, h, x, y, text, color, fontSize, family, weight = 400, letterSpacing = 0, fontFileBuf }) {
  // ถ้ามีฟอนต์ custom ให้ฝังผ่าน @font-face (base64)
  let fontFace = '';
  let familyToUse = family || 'sans-serif';
  if (fontFileBuf && fontFileBuf.length) {
    const b64 = fontFileBuf.toString('base64');
    familyToUse = 'UserFontEmbed';
    fontFace = `
    @font-face {
      font-family: '${familyToUse}';
      src: url('data:font/ttf;base64,${b64}') format('truetype');
      font-weight: 100 900;
      font-style: normal;
      font-display: swap;
    }`;
  }

  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <style>
        ${fontFace}
        text {
          font-family: ${familyToUse};
          font-weight: ${weight};
          font-size: ${fontSize}px;
          fill: ${color};
          letter-spacing: ${letterSpacing}px;
        }
      </style>
      <text x="${x}" y="${y}" dominant-baseline="middle" text-anchor="middle">${esc(text)}</text>
    </svg>`
  );
}

/** วางชื่อบนรูปภาพแล้วส่งออกเป็น PNG */
async function renderImageToPng({ templateBuf, name, xRel, yRel, color, fontSize, family, weight, letterSpacing, fontFileBuf }) {
  const meta = await sharp(templateBuf).metadata();
  const w = meta.width, h = meta.height;

  const x = Math.round((xRel || 0.5) * w);
  const y = Math.round((yRel || 0.5) * h);

  const svg = svgTextOverlay({
    w, h, x, y,
    text: name,
    color, fontSize, family, weight, letterSpacing,
    fontFileBuf
  });

  const out = await sharp(templateBuf)
    .composite([{ input: svg }])
    .png()
    .toBuffer();

  return out;
}

/** วางชื่อบนหน้า PDF (template เป็น PDF) */
async function renderPdfPage({
  templatePdfBuf, pageIndex = 0, name,
  xRel, yRel, color, fontSize, family, letterSpacing, fontFileBuf
}) {
  const src = await PDFDocument.load(templatePdfBuf);
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit); // <— เพิ่มบรรทัดนี้

  const pages = await out.copyPages(src, [pageIndex]);
  const page = pages[0];
  out.addPage(page);

  // ฟอนต์ (ถ้าอัปโหลดมาให้ฝัง; ถ้าไม่มีก็ fallback)
  let font;
  if (fontFileBuf && fontFileBuf.length) {
    try {
      font = await out.embedFont(fontFileBuf, { subset: true });
    } catch {
      font = await out.embedStandardFont(StandardFonts.Helvetica);
    }
  } else {
    font = await out.embedStandardFont(StandardFonts.Helvetica);
  }

  const { r, g, b } = hexToRgb01(color || '#000000');
  const { width, height } = page.getSize();

  // พิกัดจากบนลงล่าง
  const x = (xRel || 0.5) * width;
  const yFromTop = (yRel || 0.5) * height;
  const y = height - yFromTop;

  page.drawText(String(name || ''), {
    x: x - (font.widthOfTextAtSize(String(name || ''), fontSize) / 2), // จัดกลาง
    y,
    size: fontSize,
    font,
    color: rgb(r, g, b),
    characterSpacing: Number(letterSpacing || 0) // หน่วย pt
  });

  return await out.save();
}

/** วางชื่อบนรูป แล้วส่งออกเป็น PDF */
async function renderImageToPdf({ templateImageBuf, name, xRel, yRel, color, fontSize, family, letterSpacing, fontFileBuf }) {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit); // <— เพิ่มบรรทัดนี้

  // อ่านขนาดรูป
  const meta = await sharp(templateImageBuf).metadata();
  const w = meta.width || 2000;
  const h = meta.height || 1414;

  const page = out.addPage([w, h]);

  // ฝังรูปเป็นพื้นหลัง
  let img;
  if (/png/i.test(meta.format)) img = await out.embedPng(templateImageBuf);
  else img = await out.embedJpg(templateImageBuf);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });

  // ฟอนต์
  let font;
  if (fontFileBuf && fontFileBuf.length) {
    try {
      font = await out.embedFont(fontFileBuf, { subset: true });
    } catch {
      font = await out.embedStandardFont(StandardFonts.Helvetica);
    }
  } else {
    font = await out.embedStandardFont(StandardFonts.Helvetica);
  }

  const { r, g, b } = hexToRgb01(color || '#000000');

  const x = (xRel || 0.5) * w;
  const yFromTop = (yRel || 0.5) * h;
  const y = h - yFromTop;

  page.drawText(String(name || ''), {
    x: x - (font.widthOfTextAtSize(String(name || ''), fontSize) / 2),
    y,
    size: fontSize,
    font,
    color: rgb(r, g, b),
    characterSpacing: Number(letterSpacing || 0)
  });

  return await out.save();
}

/** รวมทุกอย่างแล้วแพ็กเป็น ZIP */
exports.renderZip = async function renderZip({
  templateBuf,
  templateMime,    // 'application/pdf' หรือ 'image/png/jpeg'
  rows,            // [{...}]
  nameColumn,      // ชื่อคอลัมน์
  outputFormat,    // 'pdf' | 'png'
  mode,            // 'pdf' | 'image'
  pageIndex = 0,
  xRel, yRel,
  color = '#000',
  fontSize = 48,
  fontFamily = 'sans-serif',
  fontWeight = 700,
  letterSpacing = 0,
  fontFileBuf,     // optional
  filenamePrefix = 'CERT_'
}) {
  const zip = new JSZip();

  for (const row of rows) {
    const name = (row?.[nameColumn] ?? '').toString().trim() || 'UNKNOWN';
    const fileSafe = `${filenamePrefix}${slug(name)}`;

    if (mode === 'pdf' && templateMime === 'application/pdf') {
      const pdfBytes = await renderPdfPage({
        templatePdfBuf: templateBuf,
        pageIndex,
        name,
        xRel, yRel, color, fontSize,
        family: fontFamily,
        letterSpacing,
        fontFileBuf
      });
      zip.file(`${fileSafe}.pdf`, pdfBytes);
    } else if (mode === 'image' && outputFormat === 'png') {
      const png = await renderImageToPng({
        templateBuf,
        name,
        xRel, yRel, color, fontSize,
        family: fontFamily,
        weight: fontWeight,
        letterSpacing,
        fontFileBuf
      });
      zip.file(`${fileSafe}.png`, png);
    } else if (mode === 'image' && outputFormat === 'pdf') {
      const pdf = await renderImageToPdf({
        templateImageBuf: templateBuf,
        name, xRel, yRel, color, fontSize,
        family: fontFamily,
        letterSpacing,
        fontFileBuf
      });
      zip.file(`${fileSafe}.pdf`, pdf);
    } else {
      throw new Error(`ไม่รองรับโหมดนี้ (mode=${mode}, templateMime=${templateMime}, outputFormat=${outputFormat})`);
    }
  }

  return await zip.generateAsync({ type: 'nodebuffer' });
};
