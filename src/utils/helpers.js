// src/utils/helpers.js
exports.hexToRgb01 = (hex) => {
  const m = String(hex || '#000').replace('#','').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  const h = m ? m[1] : '000';
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0,2), 16) / 255;
  const g = parseInt(full.slice(2,4), 16) / 255;
  const b = parseInt(full.slice(4,6), 16) / 255;
  return { r, g, b };
};

exports.slug = (s) => {
  return (String(s || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_') || 'noname');
};

exports.parseFullRange = (fullRange) => {
  // "Sheet1!A1:Z100" -> { sheet: "Sheet1", a1: "A1:Z100" }
  const m = String(fullRange || 'Sheet1!A:Z').match(/^([^!]+)!(.+)$/);
  if (m) return { sheet: m[1], a1: m[2] };
  return { sheet: 'Sheet1', a1: fullRange || 'A:Z' };
};
