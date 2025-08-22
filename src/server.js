// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { getSheetTabs, getPreview, getAllRows } = require('./sheets');
const { renderZip } = require('./render');

const app = express();

/* ===== CORS =====
   ตั้งค่า .env เช่น
   CORS_ORIGIN=https://certificate-admin.vercel.app,https://another.app
   ถ้าไม่ตั้ง จะรับทุก origin (reflect) */
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.options('*', cors({ origin: corsOrigin, credentials: true })); // รองรับ preflight
app.use(express.json({ limit: '10mb' }));

/* ===== Upload (เก็บไฟล์ไว้ในหน่วยความจำ) ===== */
const upload = multer({ storage: multer.memoryStorage() });

/* ===== Helpers ===== */
const clamp01 = v => Math.max(0, Math.min(1, v));
const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/* ===== Health ===== */
app.get('/', (_req, res) => res.send('OK: Certificate backend running'));

/* ===== Google Sheets: รายชื่อแท็บ (ต้องมี GOOGLE_API_KEY) ===== */
app.post('/api/sheets/tabs', async (req, res) => {
  try {
    const { sheetId } = req.body || {};
    if (!sheetId) return res.status(400).send('sheetId required');
    const tabs = await getSheetTabs(sheetId);
    res.json({ tabs });
  } catch (e) {
    console.error('tabs error:', e);
    res.status(500).send(String(e.message || e));
  }
});

/* ===== Google Sheets: พรีวิวข้อมูล ===== */
app.post('/api/sheets/preview', async (req, res) => {
  try {
    const { sheetId, range } = req.body || {};
    if (!sheetId || !range) return res.status(400).send('sheetId and range required');
    const data = await getPreview(sheetId, range);
    res.json(data);
  } catch (e) {
    console.error('preview error:', e);
    res.status(500).send(String(e.message || e));
  }
});

/* ===== Generate ZIP ใบประกาศนียบัตร =====
   รับได้ทั้ง template (ภาพ/PDF) และฟอนต์ (fontFile .ttf/.otf/woff/woff2) */
app.post(
  '/api/generate',
  upload.fields([
    { name: 'template', maxCount: 1 },
    { name: 'fontFile', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const fTemplate = req.files?.template?.[0];
      if (!fTemplate) return res.status(400).send('template file is required');

      const {
        sheetId,
        range,
        nameColumn,
        outputFormat,
        mode,
        xRel,
        yRel,
        color,
        fontSize,
        fontFamily,
        fontWeight,
        letterSpacing,
        pageIndex,
        filenamePrefix,
      } = req.body || {};

      if (!sheetId || !range) {
        return res.status(400).send('sheetId and range required');
      }

      const { rows } = await getAllRows(sheetId, range);

      const zipBuf = await renderZip({
        templateBuf: fTemplate.buffer,
        templateMime: fTemplate.mimetype,

        rows,
        nameColumn,

        outputFormat: outputFormat || 'pdf',
        mode: mode || 'auto',
        pageIndex: num(pageIndex, 0),

        xRel: clamp01(num(xRel, 0.5)),
        yRel: clamp01(num(yRel, 0.5)),

        color: color || '#000000',
        fontSize: num(fontSize, 48),
        fontFamily: fontFamily || 'sans-serif',
        fontWeight: num(fontWeight, 700),          // ใช้ได้เมื่อฟอนต์รองรับ/มีไฟล์เวอร์ชันตาม weight
        letterSpacing: num(letterSpacing, 0),

        // ฟอนต์ที่อัปโหลด (optional) — renderZip ต้องฝังฟอนต์นี้ตอนวาดตัวอักษร
        fontFileBuf: req.files?.fontFile?.[0]?.buffer || null,

        filenamePrefix: filenamePrefix || 'CERT_',
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="certificates.zip"');
      res.end(zipBuf);
    } catch (e) {
      console.error('generate error:', e);
      res.status(500).send(String(e.message || e));
    }
  }
);

/* ===== Start ===== */
const port = num(process.env.PORT, 5050);
app.listen(port, () => {
  console.log(`✅ Server listening on :${port}`);
});
