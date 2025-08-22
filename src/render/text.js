const { rgb, StandardFonts, PDFDocument } = require('pdf-lib');
const fontkit = require('fontkit');
const { hexToRgb01 } = require('../utils/helpers');
const { createCanvas, loadImage, registerFont } = require('canvas');

// draw text on PDF page with manual letterSpacing
function drawTextWithSpacing(page, text, x, y, opts) {
  const { size, color, font, letterSpacing = 0 } = opts;

  if (!letterSpacing) {
    page.drawText(text, { x, y, size, font, color });
    return;
  }

  // manual per-char
  let cursorX = x;
  for (const ch of text) {
    page.drawText(ch, { x: cursorX, y, size, font, color });
    const w = font.widthOfTextAtSize(ch, size);
    cursorX += w + letterSpacing;
  }
}

async function loadPdfFont(pdfDoc, { fontBuffer, family }) {
  pdfDoc.registerFontkit(fontkit);
  if (fontBuffer) {
    return await pdfDoc.embedFont(fontBuffer, { subset: true });
  }
  // fallback to standard fonts
  // map โดยคร่าวๆ
  const fam = String(family || '').toLowerCase();
  if (fam.includes('times')) return await pdfDoc.embedFont(StandardFonts.TimesRoman);
  if (fam.includes('courier')) return await pdfDoc.embedFont(StandardFonts.Courier);
  // Helvetica เป็น default
  return await pdfDoc.embedFont(StandardFonts.Helvetica);
}

function makeCanvasText(ctx, text, x, y, { fontSize, fontFamily, fontWeight = 700, fillStyle = '#000', letterSpacing = 0 }) {
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = fillStyle;
  ctx.font = `${fontWeight || 700} ${fontSize}px ${fontFamily || 'sans-serif'}`;

  if (!letterSpacing) {
    ctx.fillText(text, x, y);
    return;
  }
  // manual spacing
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    const m = ctx.measureText(ch);
    cursor += (m.width || 0) + letterSpacing;
  }
}

async function rasterizeImageToCanvas(buf) {
  const img = await loadImage(buf);
  const cw = img.width;
  const ch = img.height;
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, width: cw, height: ch };
}

module.exports = {
  drawTextWithSpacing,
  loadPdfFont,
  makeCanvasText,
  rasterizeImageToCanvas,
  hexToRgb01
};
