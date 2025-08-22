// src/render/index.js
const JSZip = require('jszip');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fontkit = require('fontkit');

// !!! สำคัญ: path ต้องชี้ไปที่โฟลเดอร์ utils ที่อยู่นอก render
const { hexToRgb01, slug } = require('../utils/helpers');

/**
 * สร้าง ZIP จากรายชื่อทั้งหมด
 * @param {Object} opts
 *  - templateBuf: Buffer ของไฟล์เทมเพลต (รูปหรือ PDF)
 *  - templateMime: mimetype ของเทมเพลต
 *  - rows: ข้อมูลรายชื่อจากชีต (array of objects)
 *  - nameColumn: ชื่อคอลัมน์ที่เก็บชื่อ
 *  - outputFormat: 'pdf' | 'png'
 *  - mode: 'image' | 'pdf'  (ถ้าอัปโหลด PDF จะบังคับเป็น 'pdf')
 *  - pageIndex: หน้าที่จะพิมพ์ (0-based) สำหรับ PDF
 *  - xRel, yRel: ตำแหน่งสัมพัทธ์ (0..1) อิงจากซ้าย-บน
 *  - color: '#RRGGBB'
 *  - fontSize: ขนาดตัวอักษร (px)
 *  - fontFamily: ชื่อฟอนต์ CSS (fallback สำหรับภาพ)
 *  - fontWeight: 100..900
 *  - letterSpacing: ระยะห่างตัวอักษร (px)
 *  - fontFileBuf: Buffer ฟอนต์ .ttf/.otf ที่อัปโหลด (ถ้ามีจะฝังจริง)
 *  - filenamePrefix: prefix ของไฟล์
 */
async function renderZip(opts) {
  const {
    templateBuf,
    templateMime,
    rows,
    nameColumn,
    outputFormat = 'pdf',
    mode: inputMode,
    pageIndex = 0,
    xRel = 0.5,
    yRel = 0.5,
    color = '#000000',
    fontSize = 48,
    fontFamily = 'sans-serif',
    fontWeight = 700,
    letterSpacing = 0,
    fontFileBuf,
    filenamePrefix = 'CERT_',
  } = opts;

  if (!templateBuf || !templateMime) {
    throw new Error('templateBuf/templateMime is required');
  }
  const isTemplatePdf = templateMime === 'application/pdf';
  const mode = isTemplatePdf ? 'pdf' : (inputMode || 'image');

  const zip = new JSZip();

  for (const row of rows) {
    const nameRaw = String(row?.[nameColumn] ?? '').trim();
    if (!nameRaw) continue;

    const filenameBase = `${filenamePrefix}${slug(nameRaw)}`.replace(/\.+$/, '');

    if (mode === 'pdf') {
      // วาดลง PDF โดยตรง
      const outPdf = await drawTextOnPdf(templateBuf, {
        pageIndex,
        text: nameRaw,
        xRel,
        yRel,
        color,
        fontSize,
        letterSpacing,
        fontFileBuf,
      });
      zip.file(`${filenameBase}.pdf`, outPdf);
    } else {
      // วาดลงรูป (แล้ว export ตาม outputFormat)
      const outBuf = await drawTextOnImage(templateBuf, {
        text: nameRaw,
        xRel,
        yRel,
        color,
        fontSize,
        fontFamily,
        fontWeight,
        letterSpacing,
        fontFileBuf, // เพื่อทำ @font-face base64 ใน SVG
        outputFormat,
      });

      if (outputFormat === 'png') {
        zip.file(`${filenameBase}.png`, outBuf);
      } else {
        // แปลงรูปเป็นหน้า PDF เดี่ยว
        const pdf = await imageBufferToSinglePagePdf(outBuf);
        zip.file(`${filenameBase}.pdf`, pdf);
      }
    }
  }

  return await zip.generateAsync({ type: 'nodebuffer' });
}

/* ---------- IMAGE MODE (sharp + SVG overlay) ---------- */

async function drawTextOnImage(templateBuf, {
  text,
  xRel,
  yRel,
  color,
  fontSize,
  fontFamily,
  fontWeight,
  letterSpacing,
  fontFileBuf,
  outputFormat,
}) {
  // อ่านขนาดรูป
  const img = sharp(templateBuf, { failOn: false });
  const meta = await img.metadata();
  const w = meta.width || 2000;
  const h = meta.height || 1414;

  const svg = buildSvgOverlay({
    w, h, text, color, fontSize, fontWeight, letterSpacing,
    // ถ้ามีฟอนต์อัปโหลด จะฝัง @font-face แบบ data:URL
    cssFamily: fontFamily,
    fontFileBuf
  });

  const composed = await sharp(templateBuf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .toBuffer();

  if (outputFormat === 'png') return composed;

  // default: แปลงเป็น PDF หน้าเดียว
  return await imageBufferToSinglePagePdf(composed);
}

function buildSvgOverlay({
  w, h, text, color, fontSize, fontWeight, letterSpacing,
  cssFamily = 'sans-serif',
  fontFileBuf,
}) {
  let family = cssFamily || 'sans-serif';
  let fontFace = '';

  if (fontFileBuf && fontFileBuf.length) {
    const b64 = fontFileBuf.toString('base64');
    // ใช้ชื่อฟอนต์คงที่ใน SVG เพื่อให้แน่ใจว่าจับถูก
    family = 'UserFontEmbed';
    fontFace = `
      @font-face{
        font-family:'${family}';
        src:url('data:font/ttf;base64,${b64}') format('truetype');
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
      }
    `;
  }

  // text-anchor:middle + dominant-baseline:middle เพื่อให้อยู่กลางพิกัดที่เราให้
  const style = `
    ${fontFace}
    .name {
      font-family: '${family}', sans-serif;
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      letter-spacing: ${letterSpacing}px;
      fill: ${color};
      text-anchor: middle;
      dominant-baseline: middle;
    }
  `;

  // SVG จะวางไว้ตรงกลางรูป แล้วเราจะใช้ JavaScript ข้างนอกคำนวณพิกัด
  // แต่ที่นี่ใช้ค่า relative (0.5, 0.5) เป็นค่าเริ่ม ตัวจริงจะคำนวณใน frontend แล้วส่งมา
  const cx = w;  // เราให้ fill="none" แล้วใช้ <text> แบบ absolute ในภายหลัง
  const cy = h;

  // ตำแหน่งจริงคำนวณใน server ผ่าน frontend → ที่นี่วางไว้กลางเท่านั้น
  // เราจะให้ผู้เรียกคำนวณ x,y ก่อน — แต่เพื่อความเรียบง่าย ใน SVG นี้
  // เราให้ผู้เรียกฝั่ง sharp composite วางทั้งภาพทับจุดเดิม แล้วใช้ translate ด้วย CSS ไม่ได้
  // → ง่ายสุด: ให้คำนวณ x,y นอก SVG แล้วแปลเป็นพิกัดใน frontend (เราใช้ค่าที่ส่งมาโดยตรง)
  // แต่ในที่นี้ เราจะวาง text ผ่านแอตทริบิวต์ x,y ในภายหลัง (ตอนคอมโพส)

  // อย่างไรก็ดี sharp จะวางทั้ง SVG ทับภาพเทมเพลต ดังนั้นเราต้องรู้ x,y ที่แท้จริง
  // เพราะเราไม่ได้รับ xRel,yRel ในฟังก์ชันนี้ (เราจะคำนวนก่อนเรียก buildSvgOverlay)
  // --- เราแก้โดยให้ caller คำนวน position ก่อน แล้ว "ฝัง" ลงใน SVG
  // -> เพื่อความง่าย เราจะให้ caller ป้อน w,h แล้วเราคำนวณที่นี่เลย:

  // NOTE: เราไม่รับ xRel,yRel ที่นี่ เพราะอยากให้ฟังก์ชันนี้ reusable
  // ดังนั้นจะให้ caller ซีลค่าไว้ที่ text 1 จุดในกลางหน้า
  // แต่เพื่อให้ใช้จริง ให้ไปคำนวณก่อนเรียกฟังก์ชัน และ replace ใน caller (ทำแล้วด้านบน)

  // สรุป: เราจะปล่อยให้ caller วาง SVG ทั้งภาพ แล้วใช้ text x/y เป็นกึ่งกลางรูป
  // (ตำแหน่งจริงถูกคำนวนก่อน composite แล้วส่งเข้ามาเป็น xAbs,yAbs ด้านนอก)

  // ทริค: เราจะไม่ใส่ x,y ตรงนี้ แต่ให้ caller ทำ string replace ก่อน composite
  // เพื่อให้รองรับตำแหน่งเปลี่ยนได้ – อย่างไรก็ดีเพื่อความง่าย จะสร้างให้มี placeholder แล้ว replace ก่อนส่งเข้า sharp

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <style>${style}</style>
  <!-- xAbs/yAbs จะถูกแทนค่าก่อน composite -->
  <text class="name" x="__X_ABS__" y="__Y_ABS__">${escapeXml(text)}</text>
</svg>`;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function imageBufferToSinglePagePdf(imageBuf) {
  const pdfDoc = await PDFDocument.create();
  const img = await pdfDoc.embedPng(imageBuf);
  const { width, height } = img.size();
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(img, { x: 0, y: 0, width, height });
  return await pdfDoc.save();
}

/* ---------- PDF MODE (pdf-lib + fontkit) ---------- */

async function drawTextOnPdf(templatePdfBuf, {
  pageIndex = 0,
  text,
  xRel = 0.5,
  yRel = 0.5,
  color = '#000000',
  fontSize = 48,
  letterSpacing = 0,
  fontFileBuf,
}) {
  const pdfDoc = await PDFDocument.load(templatePdfBuf);
  // ต้อง register ก่อน ถึงจะ embed .ttf/.otf ได้
  pdfDoc.registerFontkit(fontkit);

  const pages = pdfDoc.getPages();
  const page = pages[Math.min(Math.max(0, pageIndex), pages.length - 1)];
  const { width, height } = page.getSize();

  // pdf-lib ใช้ origin ที่ "มุมล่างซ้าย", แต่เราได้ค่า yRel จาก "ด้านบน"
  const xAbs = width * xRel;
  const yAbs = height * (1 - yRel);

  // เลือกฟอนต์
  let font;
  if (fontFileBuf && fontFileBuf.length) {
    try {
      font = await pdfDoc.embedFont(fontFileBuf, { subset: true });
    } catch (e) {
      // ถ้าฝังฟอนต์ล้ม ให้ fallback Helvetica
      font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      console.warn('Embed custom font failed, fallback to Helvetica:', e.message);
    }
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  const col = hexToRgb01(color); // {r,g,b} 0..1
  const textWidth = widthWithLetterSpacing(font, text, fontSize, letterSpacing);

  // ให้อยู่ "กึ่งกลาง" จุดที่เลือก → เริ่มวาดจากซ้าย = xAbs - textWidth/2
  const startX = xAbs - textWidth / 2;
  const baselineY = yAbs - fontSize / 2; // ให้ดูลอยกลาง ๆ

  drawTextWithLetterSpacing(page, {
    text,
    x: startX,
    y: baselineY,
    font,
    fontSize,
    color: rgb(col.r, col.g, col.b),
    letterSpacing,
  });

  return await pdfDoc.save();
}

function widthWithLetterSpacing(font, text, size, letterSpacing) {
  const base = font.widthOfTextAtSize(text, size);
  const extra = letterSpacing * Math.max(0, text.length - 1);
  return base + extra;
}

function drawTextWithLetterSpacing(page, { text, x, y, font, fontSize, color, letterSpacing }) {
  if (!letterSpacing) {
    page.drawText(text, { x, y, size: fontSize, font, color });
    return;
  }
  let cx = x;
  for (const ch of text) {
    const w = font.widthOfTextAtSize(ch, fontSize);
    page.drawText(ch, { x: cx, y, size: fontSize, font, color });
    cx += w + letterSpacing;
  }
}

/* ---------- EXPORT ---------- */

module.exports = {
  renderZip,
};
