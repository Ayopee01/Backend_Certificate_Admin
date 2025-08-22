// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const { getSheetTabs, getPreview, getAllRows } = require('./sheets');
const { renderZip } = require('./render');

const app = express();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : true;

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const upload = multer({ storage: multer.memoryStorage() });

app.get('/', (req, res) => res.send('OK: Certificate backend running'));

/** รายชื่อแท็บในสเปรดชีต (ต้องมี GOOGLE_API_KEY) */
app.post('/api/sheets/tabs', async (req, res) => {
  try {
    const { sheetId } = req.body || {};
    if (!sheetId) return res.status(400).send('sheetId required');
    const tabs = await getSheetTabs(sheetId);
    res.json({ tabs });
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

/** พรีวิวข้อมูล */
app.post('/api/sheets/preview', async (req, res) => {
  try {
    const { sheetId, range } = req.body || {};
    if (!sheetId || !range) return res.status(400).send('sheetId and range required');
    const data = await getPreview(sheetId, range);
    res.json(data);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
});

/** สร้าง ZIP ใบประกาศนียบัตร */
app.post('/api/generate', upload.fields([
  { name: 'template', maxCount: 1 },
  { name: 'fontFile', maxCount: 1 }
]), async (req, res) => {
  try {
    const fTemplate = req.files?.template?.[0];
    if (!fTemplate) return res.status(400).send('template file is required');

    const {
      sheetId, range, nameColumn,
      outputFormat, mode,
      xRel, yRel,
      color, fontSize,
      fontFamily, fontWeight, letterSpacing,
      pageIndex, filenamePrefix
    } = req.body;

    const { rows } = await getAllRows(sheetId, range);

    const zipBuf = await renderZip({
      templateBuf: fTemplate.buffer,
      templateMime: fTemplate.mimetype,
      rows,
      nameColumn,
      outputFormat,
      mode,
      pageIndex: Number(pageIndex || 0),
      xRel: Number(xRel || 0.5),
      yRel: Number(yRel || 0.5),
      color: color || '#000000',
      fontSize: Number(fontSize || 48),
      fontFamily: fontFamily || 'sans-serif',
      fontWeight: Number(fontWeight || 700),
      letterSpacing: Number(letterSpacing || 0),
      fontFileBuf: req.files?.fontFile?.[0]?.buffer,
      filenamePrefix: filenamePrefix || 'CERT_'
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="certificates.zip"`);
    res.end(zipBuf);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e.message || e));
  }
});

const port = Number(process.env.PORT || 5050);
app.listen(port, () => {
  console.log(`✅ Server listening on :${port}`);
});
