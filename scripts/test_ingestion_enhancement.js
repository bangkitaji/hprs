require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const ingestionService = require('../src/services/ingestionService');

async function testIngestion() {
  console.log('=======================================================');
  console.log('🧪 INTEGRATION TEST: INGESTION ENHANCEMENT');
  console.log('=======================================================\n');

  const sampleFiles = [
    {
      label: 'Middleware',
      source: 'd:/KCIC/depositMovement/datasource/2026 - 10 - Middleware/MW_20261001.txt',
      targetTable: 'middleware_transactions',
      countQuery: 'SELECT count(*)::int AS cnt FROM middleware_transactions',
    },
    {
      label: 'Doku All Data',
      source: 'd:/KCIC/depositMovement/datasource/2026 - 10 - Doku All Data/Export_Doku.csv',
      targetTable: 'pg_doku_all_settlements',
      countQuery: 'SELECT count(*)::int AS cnt FROM pg_doku_all_settlements',
    },
    {
      label: 'Doku QR',
      source: 'd:/KCIC/depositMovement/datasource/2026 - 10 - Doku QR/202610 - Report Doku QRIS Compile_sample.xlsx',
      targetTable: 'pg_doku_qr_settlements',
      countQuery: 'SELECT count(*)::int AS cnt FROM pg_doku_qr_settlements',
    },
    {
      label: 'Finnet',
      source: 'd:/KCIC/depositMovement/datasource/2026 - 10 - Finnet/Transaksi KCIC Periode 1-31 Oktober 2026.xlsx',
      targetTable: 'pg_finnet_settlements',
      countQuery: 'SELECT count(*)::int AS cnt FROM pg_finnet_settlements',
    },
    {
      label: 'Xendit',
      source: 'd:/KCIC/depositMovement/datasource/2026 - 10 - Xendit/202610 - Report Xendit ALL_TRANSACTIONS_REPORT_20261001_20261031_1793503617386.csv',
      targetTable: 'pg_xendit_settlements',
      countQuery: 'SELECT count(*)::int AS cnt FROM pg_xendit_settlements',
    },
  ];

  const uploadsDir = path.resolve(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  for (const item of sampleFiles) {
    console.log(`\n▶️ Testing Ingestion: ${item.label}...`);
    const fileName = path.basename(item.source);
    const tempCopy = path.join(uploadsDir, `test-${Date.now()}-${fileName}`);

    fs.copyFileSync(item.source, tempCopy);
    const stat = fs.statSync(tempCopy);

    try {
      const results = await ingestionService.processExcelIngestion({
        tempFilePath: tempCopy,
        originalName: fileName,
        fileSize: stat.size,
      });

      console.log(`   ✅ Ingestion completed in ${(results.durationMs / 1000).toFixed(2)}s`);
      console.log(`   Sheets processed:`, results.sheetsProcessed.map((s) => `${s.sheetName} (${s.insertedRows} rows)`));

      // Query database table count
      const res = await pool.query(item.countQuery);
      console.log(`   📊 ${item.targetTable} total rows in DB:`, res.rows[0].cnt);
    } catch (err) {
      console.error(`   ❌ Ingestion failed for ${item.label}:`, err.message);
      if (fs.existsSync(tempCopy)) fs.unlinkSync(tempCopy);
    }
  }

  // Check upload_history
  console.log('\n▶️ Checking upload_history log:');
  const hist = await pool.query('SELECT id, file_name, source_type, provider, total_rows, inserted_rows, status FROM upload_history ORDER BY id DESC LIMIT 5');
  console.table(hist.rows);

  await pool.end();
  console.log('\n🎉 ALL TESTS COMPLETED!');
}

testIngestion();

