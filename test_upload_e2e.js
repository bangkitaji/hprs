const fs = require('fs');
const http = require('http');

async function testUpload() {
  const filePath = 'C:\\Users\\aji.nugroho\\Downloads\\20251201 - SALES & REFUND.xlsx';
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const fileData = fs.readFileSync(filePath);

  const postDataStart = Buffer.from(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="file"; filename="20251201 - SALES & REFUND.xlsx"\r\n' +
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
  );
  const postDataEnd = Buffer.from('\r\n--' + boundary + '--\r\n');
  const body = Buffer.concat([postDataStart, fileData, postDataEnd]);

  console.log('1. Mengirim berkas Excel (5MB) ke endpoint /api/upload/preview...');
  const req = http.request({
    hostname: 'localhost',
    port: 3000,
    path: '/api/upload/preview',
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
      'Content-Length': body.length,
    }
  }, (res) => {
    let respData = '';
    res.on('data', chunk => respData += chunk);
    res.on('end', async () => {
      console.log('   Preview Status:', res.statusCode);
      const json = JSON.parse(respData);
      console.log('   Hasil Deteksi:', json.fileName, '| Lembar Kerja:', json.sheets.map(s => `${s.sheetName} (${s.detectedType}: ${s.totalRows} baris)`).join(', '));

      // Injeksi
      console.log('\n2. Mengirim request ke /api/upload/process untuk batch ingestion...');
      const processReq = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/upload/process',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      }, (pRes) => {
        let pData = '';
        pRes.on('data', c => pData += c);
        pRes.on('end', () => {
          console.log('   Process Status:', pRes.statusCode);
          console.log('   Output Injeksi:', JSON.parse(pData));
        });
      });

      processReq.write(JSON.stringify({
        tempFilePath: json.tempFilePath,
        originalName: json.fileName,
        fileSize: json.fileSize,
        selectedSheets: ['Sales', 'Refund']
      }));
      processReq.end();
    });
  });

  req.write(body);
  req.end();
}

testUpload();
