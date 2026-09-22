/**
 * Utilitas Parser & Formatter Data Excel
 * Menangani serial number Excel, pecahan waktu, format tanggal lokal, persentase, dan angka.
 */

/**
 * Konversi tanggal dari berbagai format Excel menjadi format standar SQL (YYYY-MM-DD).
 */
function parseExcelDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    return val.toISOString().split('T')[0];
  }
  if (typeof val === 'number') {
    // Serial date Excel (epoch 1899-12-30)
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Format YYYYMMDD (contoh: 20260920)
    if (/^\d{8}$/.test(trimmed)) {
      return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
    }
    // Format YYYY-MM-DD atau YYYY/MM/DD
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed)) {
      const parts = trimmed.split(/[-/]/);
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].slice(0, 2).padStart(2, '0')}`;
    }
    // Format DD/MM/YYYY atau DD-MM-YYYY (contoh: 20/09/2026)
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(trimmed)) {
      const parts = trimmed.split(/[-/]/);
      return `${parts[2].slice(0, 4)}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  }
  return null;
}

/**
 * Konversi waktu dari pecahan hari Excel atau format string menjadi standar SQL TIME (HH:mm:ss).
 */
function parseExcelTime(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') {
    // Pecahan hari (0.0 s.d. 1.0)
    const totalSeconds = Math.round(val * 86400);
    const hours = Math.floor(totalSeconds / 3600) % 24;
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?/.test(trimmed)) {
      const parts = trimmed.split(':');
      const h = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      const s = (parts[2] ? parts[2].slice(0, 2) : '00').padStart(2, '0');
      return `${h}:${m}:${s}`;
    }
  }
  return null;
}

/**
 * Konversi timestamp lengkap (YYYY-MM-DD HH:mm:ss).
 */
function parseExcelTimestamp(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    return val.toISOString().replace('T', ' ').slice(0, 19);
  }
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date.getTime())) {
      return date.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    // Format DD/MM/YYYY HH:mm:ss atau DD-MM-YYYY HH:mm:ss
    const matchDMY = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (matchDMY) {
      const d = matchDMY[1].padStart(2, '0');
      const m = matchDMY[2].padStart(2, '0');
      const y = matchDMY[3];
      const time = matchDMY[4] ? (matchDMY[4].length === 5 ? matchDMY[4] + ':00' : matchDMY[4]) : '00:00:00';
      return `${y}-${m}-${d} ${time}`;
    }
    // Format YYYY/MM/DD atau YYYY-MM-DD
    const matchYMD = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}:\d{2}(?::\d{2})?))?/);
    if (matchYMD) {
      const y = matchYMD[1];
      const m = matchYMD[2].padStart(2, '0');
      const d = matchYMD[3].padStart(2, '0');
      const time = matchYMD[4] ? (matchYMD[4].length === 5 ? matchYMD[4] + ':00' : matchYMD[4]) : '00:00:00';
      return `${y}-${m}-${d} ${time}`;
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  return null;
}

/**
 * Normalisasi nilai rasio / persentase menjadi desimal 0.0000 s.d. 1.0000.
 * Contoh: "100%" -> 1.0, 25 -> 0.25, "5.5%" -> 0.055
 */
function parseRate(val, defaultVal = 0) {
  if (val === null || val === undefined || val === '') return defaultVal;
  const str = String(val).trim();
  if (str.endsWith('%')) {
    const num = parseFloat(str.replace(/%/g, ''));
    return isNaN(num) ? defaultVal : num / 100;
  }
  const num = parseFloat(str);
  if (isNaN(num)) return defaultVal;
  if (num > 1.0) return num / 100;
  return num;
}

/**
 * Parsing angka desimal/uang, menghapus karakter koma pemisah ribuan.
 */
function parseNumeric(val, defaultVal = 0) {
  if (val === null || val === undefined || val === '') return defaultVal;
  const num = parseFloat(String(val).replace(/,/g, ''));
  return isNaN(num) ? defaultVal : num;
}

/**
 * Parsing integer besar (seperti seq_no).
 */
function parseBigInt(val) {
  if (val === null || val === undefined || val === '') return null;
  const cleaned = String(val).replace(/[^0-9]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

module.exports = {
  parseExcelDate,
  parseExcelTime,
  parseExcelTimestamp,
  parseRate,
  parseNumeric,
  parseBigInt,
};
