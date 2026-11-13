/**
 * System & Database Diagnostic Doctor
 * FAREBOX DATA MANAGEMENT — Whoosh High Speed Railway
 * 
 * Perintah:
 *   node doctor.js         -> Diagnosa koneksi, tabel, kolom, & direktori upload
 *   node doctor.js --fix   -> Otomatis memperbaiki tabel/kolom yang belum dibuat
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { loadEnvironmentConfig } = require('./src/config/envLoader');

const { loadedPath, parsedKeys, dbConfig } = loadEnvironmentConfig();
const { pool } = require('./src/config/database');
const { UPLOAD_DIR } = require('./src/config/upload');

const autoFix = process.argv.includes('--fix');

async function runDoctor() {
  const targetPort = parseInt(process.env.PORT || '3000', 10);

  console.log('=======================================================');
  console.log('🩺 FAREBOX SYSTEM & DATABASE DOCTOR');
  console.log('=======================================================');
  console.log(`📁 Config File : ${loadedPath || '⚠️ TIDAK DITEMUKAN'}`);
  console.log(`🌐 HTTP Port   : ${targetPort}`);
  console.log(`🔌 DB Target   : ${dbConfig.host}:${dbConfig.port} (${dbConfig.database})`);
  console.log(`👤 DB User     : ${dbConfig.user}`);
  console.log(`🔒 SSL Mode    : ${dbConfig.ssl ? 'Enabled' : 'Disabled'}`);
  console.log(`📂 Upload Dir  : ${UPLOAD_DIR}`);
  console.log('-------------------------------------------------------\n');

  let hasError = false;

  // 1. Uji Ketersediaan Port HTTP
  const isPortFree = await new Promise((resolve) => {
    const s = net.createServer()
      .once('error', (e) => resolve(e.code !== 'EADDRINUSE'))
      .once('listening', () => s.once('close', () => resolve(true)).close())
      .listen(targetPort);
  });

  if (!isPortFree) {
    console.warn(`⚠️ [1/5] Port HTTP (${targetPort}) : SEDANG DIGUNAKAN (EADDRINUSE)!`);
    console.warn(`      Ada proses lain (seperti dhrts-backend) yang sedang berjalan di port ${targetPort}.`);
    console.warn(`      Solusi jika port 3000 dipakai app lain:`);
    console.warn(`      Ganti PORT=3001 di .env & ecosystem.config.js, serta sesuaikan nginx.`);
  } else {
    console.log(`✅ [1/5] Port HTTP (${targetPort}) : TERSEDIA`);
  }

  // 2. Uji Tulis Direktori Uploads
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    const testFile = path.join(UPLOAD_DIR, `.write_test_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('✅ [2/5] Direktori Uploads : DAPAT DITULIS (Writable)');
  } catch (err) {
    hasError = true;
    console.error('❌ [2/5] Direktori Uploads : GAGAL DITULIS!');
    console.error(`      Detail : ${err.message}`);
    console.error('      Solusi : Jalankan di server: chmod -R 775 uploads && chown -R www-data:www-data uploads');
  }

  // 3. Uji Koneksi Database
  let client;
  try {
    client = await pool.connect();
    const ver = await client.query('SELECT version(), current_database();');
    console.log(`✅ [3/5] Koneksi Database : BERHASIL terhubung ke "${ver.rows[0].current_database}"`);
  } catch (err) {
    hasError = true;
    console.error('❌ [3/5] Koneksi Database : GAGAL!');
    console.error(`      Detail : ${err.message}`);
    console.error('      Solusi : Periksa file .env pada server ini (DB_HOST, DB_PASSWORD, DB_PORT, dll)');
    await pool.end();
    process.exit(1);
  }

  // 4. Verifikasi Tabel-tabel yang Diperlukan
  const requiredTables = [
    { name: 'hrts_sales', category: 'Ticketing' },
    { name: 'hrts_refund', category: 'Ticketing' },
    { name: 'hrts_occupancy', category: 'Ticketing' },
    { name: 'users', category: 'RBAC' },
    { name: 'upload_history', category: 'Audit' },
    { name: 'middleware_transactions', category: 'Middleware' },
    { name: 'pg_xendit_settlements', category: 'Payment Gateway' },
    { name: 'pg_finnet_settlements', category: 'Payment Gateway' },
    { name: 'pg_doku_qr_settlements', category: 'Payment Gateway' },
    { name: 'pg_doku_all_settlements', category: 'Payment Gateway' },
    { name: 'reconciliation_batches', category: 'Reconciliation' },
    { name: 'reconciliation_items', category: 'Reconciliation' },
  ];

  console.log('\n⏳ [4/5] Memeriksa keberadaan tabel-tabel database...');
  const missingTables = [];

  for (const t of requiredTables) {
    const res = await client.query(`SELECT to_regclass('public.${t.name}') AS tbl;`);
    if (res.rows[0].tbl) {
      console.log(`   ✅ Tabel "${t.name}" [${t.category}] : ADA`);
    } else {
      missingTables.push(t.name);
      console.log(`   ❌ Tabel "${t.name}" [${t.category}] : BELUM ADA!`);
    }
  }

  // 5. Verifikasi Kolom upload_history (source_type & provider)
  console.log('\n⏳ [5/5] Memeriksa kolom upload_history (source_type, provider)...');
  const colRes = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'upload_history' 
      AND column_name IN ('source_type', 'provider');
  `);
  const foundCols = colRes.rows.map(r => r.column_name);
  const missingCols = [];
  if (!foundCols.includes('source_type')) missingCols.push('source_type');
  if (!foundCols.includes('provider')) missingCols.push('provider');

  if (missingCols.length === 0) {
    console.log('   ✅ Kolom "source_type" & "provider" : ADA');
  } else {
    console.log(`   ❌ Kolom berikut belum ada di upload_history: ${missingCols.join(', ')}`);
  }

  // Opsi Perbaikan Otomatis (--fix)
  if (missingTables.length > 0 || missingCols.length > 0) {
    hasError = true;
    console.log('\n-------------------------------------------------------');
    if (autoFix) {
      console.log('🛠️ MENJALANKAN PERBAIKAN OTOMATIS (--fix)...');
      try {
        const DB_DIR = path.resolve(__dirname, 'database');
        
        // Jalankan DDL 10 jika ada tabel PG/Middleware atau kolom yang kurang
        const needSql10 = missingTables.some(t => t.startsWith('middleware') || t.startsWith('pg_')) || missingCols.length > 0;
        if (needSql10) {
          console.log('   ⏳ Mengaplikasikan 10_create_middleware_and_pg_tables.sql...');
          const sql10 = fs.readFileSync(path.join(DB_DIR, '10_create_middleware_and_pg_tables.sql'), 'utf-8');
          await client.query(sql10);
          console.log('   ✅ Tabel Middleware, PG, & kolom upload_history berhasil dibuat!');
        }

        // Jalankan DDL 11 jika tabel rekonsiliasi belum ada
        const needSql11 = missingTables.some(t => t.startsWith('reconciliation'));
        if (needSql11) {
          console.log('   ⏳ Mengaplikasikan 11_create_reconciliation_tables.sql...');
          const sql11 = fs.readFileSync(path.join(DB_DIR, '11_create_reconciliation_tables.sql'), 'utf-8');
          await client.query(sql11);
          console.log('   ✅ Tabel Reconciliation Batches & Items berhasil dibuat!');
        }

        console.log('\n🎉 PERBAIKAN SELESAI DENGAN SUKSES! Silakan upload kembali.');
        hasError = false;
      } catch (fixErr) {
        console.error('❌ Gagal mengaplikasikan perbaikan:', fixErr.message);
      }
    } else {
      console.log('⚠️ TERDAPAT SKEMA YANG BELUM LENGKAP!');
      console.log('   Penyebab utama upload gagal di production: tabel/kolom di atas belum dibuat di database.');
      console.log('\n👉 CARA MEMPERBAIKI DENGAN 1 PERINTAH:');
      console.log('   node doctor.js --fix');
      console.log('   atau jalankan: node migrate.js');
    }
  } else {
    console.log('\n🎉 SEMUA PEMERIKSAAN LULUS (100% OK)!');
    console.log('   Sistem siap menerima upload HRTS, Middleware, dan Payment Gateway.');
  }

  client.release();
  await pool.end();
  process.exit(hasError ? 1 : 0);
}

runDoctor();

