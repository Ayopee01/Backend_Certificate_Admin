// src/sheets.js
const { parseFullRange } = require('./utils/helpers');

/**
 * ใช้ Google Sheets API (ต้องมี GOOGLE_API_KEY)
 */
async function listTabsByApiKey(sheetId) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY is required to list sheet tabs');
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets(properties(title))&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`listTabs error: ${await res.text()}`);
  const json = await res.json();
  const tabs = (json.sheets || []).map(s => s.properties && s.properties.title).filter(Boolean);
  return tabs;
}

/**
 * ดึงค่า cells ด้วย API key
 */
async function valuesByApiKey(sheetId, fullRange) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY missing');
  const enc = encodeURIComponent(fullRange);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${enc}?key=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`values error: ${await res.text()}`);
  const json = await res.json();
  return json.values || [];
}

/**
 * Fallback แบบ CSV (ต้อง public):
 * https://docs.google.com/spreadsheets/d/{id}/gviz/tq?tqx=out:csv&sheet={name}&range={a1}
 */
async function valuesByCsv(sheetId, fullRange) {
  const { sheet, a1 } = parseFullRange(fullRange);
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&range=${encodeURIComponent(a1)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`csv error: ${await res.text()}`);
  const text = await res.text();

  // parse CSV แบบง่าย (พอสำหรับชีตทั่วๆไป) — ถ้าต้องการแข็งแรงกว่านี้ใส่ papaparse ได้
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => {
    // รองรับค่าที่มีคอมม่าใน quote
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = '';
      } else {
        cur += c;
      }
    }
    out.push(cur);
    return out;
  });
  return rows;
}

function rowsToObjects(values) {
  const [hdrs = [], ...rest] = values;
  const headers = hdrs.map(h => String(h || '').trim());
  const items = rest.map(r => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] ?? ''; });
    return obj;
  });
  return { headers, rows: items };
}

exports.getSheetTabs = async (sheetId) => {
  try {
    return await listTabsByApiKey(sheetId);
  } catch (e) {
    // ไม่มี key -> แจ้งให้ตั้งค่า
    throw e;
  }
};

exports.getPreview = async (sheetId, fullRange) => {
  let values = [];
  if (process.env.GOOGLE_API_KEY) {
    values = await valuesByApiKey(sheetId, fullRange);
  } else {
    values = await valuesByCsv(sheetId, fullRange);
  }
  const { headers, rows } = rowsToObjects(values);
  return {
    headers,
    count: rows.length,
    sample: rows.slice(0, 10)
  };
};

exports.getAllRows = async (sheetId, fullRange) => {
  const values = process.env.GOOGLE_API_KEY
    ? await valuesByApiKey(sheetId, fullRange)
    : await valuesByCsv(sheetId, fullRange);

  const { headers, rows } = rowsToObjects(values);
  return { headers, rows };
};
