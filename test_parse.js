const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const filePath = 'C:\\Users\\aji.nugroho\\Downloads\\20251201 - SALES & REFUND.xlsx';
console.log('Reading file:', filePath);

const startTime = Date.now();
const workbook = xlsx.readFile(filePath, { cellDates: false });
console.log('Workbook parsed in', Date.now() - startTime, 'ms');
console.log('Sheet names:', workbook.SheetNames);

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName];
  // Convert sheet to JSON starting from row 3 (0-indexed 2)
  const range = xlsx.utils.decode_range(sheet['!ref']);
  console.log(`\n--- Sheet: ${sheetName} (range: ${sheet['!ref']}) ---`);
  
  // Header row is row 3 (0-indexed 2)
  const headerRowIdx = 2; // row 3
  const headers = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddr = xlsx.utils.encode_cell({ r: headerRowIdx, c: c });
    const cell = sheet[cellAddr];
    headers.push(cell ? String(cell.v).trim() : `Col_${c}`);
  }
  console.log('Headers count:', headers.length);
  console.log('Sample Headers:', headers.slice(0, 10));

  // Read row 4 (0-indexed 3)
  const firstDataRowIdx = 3;
  const sampleRow = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cellAddr = xlsx.utils.encode_cell({ r: firstDataRowIdx, c: c });
    const cell = sheet[cellAddr];
    sampleRow[headers[c]] = cell ? cell.v : null;
  }
  console.log('Sample Data Row 4 (first 6 fields):');
  for (const k of headers.slice(0, 6)) {
    console.log(`  ${k}:`, sampleRow[k]);
  }
  
  const totalDataRows = range.e.r - firstDataRowIdx + 1;
  console.log(`Total Data Rows in sheet ${sheetName}:`, totalDataRows);
}
