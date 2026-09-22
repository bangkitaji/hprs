const xlsx = require('xlsx');

/**
 * Normalisasi string header kolom: lowercase dan hanya karakter alfanumerik.
 * Contoh: "Passenger Name" -> "passengername", "Train No." -> "trainno"
 */
function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Sanitasi nilai string dan potong sesuai batas panjang kolom database.
 */
function cleanStr(val, maxLen = 255) {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  return maxLen ? s.slice(0, maxLen) : s;
}

/**
 * Perbaiki batas range sheet (!ref) jika generator Excel pihak ketiga memotong metadata !ref.
 * Memindai seluruh key koordinat cell untuk menemukan batas min/max sesungguhnya.
 */
function updateSheetRange(sheet) {
  if (!sheet) return;
  let minR = Infinity, maxR = -1, minC = Infinity, maxC = -1;
  for (const cell in sheet) {
    if (cell.charCodeAt(0) === 33) continue; // Lewati metadata berawalan '!'
    const coord = xlsx.utils.decode_cell(cell);
    if (coord.r < minR) minR = coord.r;
    if (coord.r > maxR) maxR = coord.r;
    if (coord.c < minC) minC = coord.c;
    if (coord.c > maxC) maxC = coord.c;
  }
  if (maxR !== -1) {
    sheet['!ref'] = xlsx.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
  }
}

/**
 * Deteksi otomatis tipe sheet (Sales, Refund, atau Occupancy) serta letak baris header dan datanya.
 * Memeriksa hingga 5 baris pertama untuk mengantisipasi judul laporan di baris atas.
 */
function detectSheetStructure(sheet) {
  if (!sheet || !sheet['!ref']) {
    return { sheetType: 'unknown', headerRowIdx: 2, dataStartRowIdx: 3, colMap: [] };
  }

  const range = xlsx.utils.decode_range(sheet['!ref']);
  const maxScanRow = Math.min(range.e.r, range.s.r + 4);

  for (let r = range.s.r; r <= maxScanRow; r++) {
    const rowHeaders = [];
    const colMap = [];

    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[xlsx.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        const raw = String(cell.v).trim();
        const norm = normalizeKey(raw);
        colMap.push({ colIdx: c, normKey: norm, rawHeader: raw });
        rowHeaders.push(norm);
      }
    }

    // Identifikasi Occupancy Report
    if (rowHeaders.includes('trainnumber') && (rowHeaders.includes('sumpsg') || rowHeaders.includes('capacityperclass') || rowHeaders.includes('totfare'))) {
      return { sheetType: 'occupancy', headerRowIdx: r, dataStartRowIdx: r + 1, colMap };
    }

    // Identifikasi Refund Report
    if (rowHeaders.includes('refunddate') && (rowHeaders.includes('refundamount') || rowHeaders.includes('refundcharge'))) {
      return { sheetType: 'refund', headerRowIdx: r, dataStartRowIdx: r + 1, colMap };
    }

    // Identifikasi Sales Report
    if (rowHeaders.includes('purchasedate') && rowHeaders.includes('ticketno')) {
      return { sheetType: 'sales', headerRowIdx: r, dataStartRowIdx: r + 1, colMap };
    }
  }

  return { sheetType: 'unknown', headerRowIdx: 2, dataStartRowIdx: 3, colMap: [] };
}

module.exports = {
  normalizeKey,
  cleanStr,
  updateSheetRange,
  detectSheetStructure,
};
