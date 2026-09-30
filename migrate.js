/**
 * Database Migration Runner
 * FAREBOX DATA MANAGEMENT — Whoosh High Speed Railway
 * 
 * Menjalankan skrip inisialisasi skema partisi, data mart, RBAC, dan audit log
 * menggunakan konfigurasi kredensial dari file .env.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

const DB_DIR = path.resolve(__dirname, 'database');

function readSqlFile(fileName) {
  const filePath = path.join(DB_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File SQL tidak ditemukan: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

async function runMigration() {
  console.log('=======================================================');
  console.log('🚄 MEMULAI MIGRASI DATABASE FAREBOX DATA MANAGEMENT');
  console.log(`   Host     : ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
  console.log(`   Database : ${process.env.DB_NAME || 'hpr_portal'}`);
  console.log(`   User     : ${process.env.DB_USER || 'postgres'}`);
  console.log('=======================================================\n');

  const client = await pool.connect();

  try {
    // 1. Verifikasi Koneksi
    const resVer = await client.query('SELECT version(), current_database(), current_user;');
    console.log(`[1/7] ✅ Terhubung ke PostgreSQL: ${resVer.rows[0].current_database} (User: ${resVer.rows[0].current_user})`);

    // 2. Skrip 01: Tabel Master & Partisi hrts_sales_p
    console.log('\n[2/7] ⏳ Menyiapkan tabel partisi penjualan (hrts_sales_p)...');
    const sqlSales = readSqlFile('01_create_partitioned_sales.sql');
    await client.query(sqlSales);
    console.log('      ✅ Skema hrts_sales_p dan partisi bulanan 2023-2027 berhasil dibuat.');

    // 3. Skrip 02: Tabel Master & Partisi hrts_refund_p
    console.log('\n[3/7] ⏳ Menyiapkan tabel partisi refund (hrts_refund_p)...');
    const sqlRefund = readSqlFile('02_create_partitioned_refund.sql');
    await client.query(sqlRefund);
    console.log('      ✅ Skema hrts_refund_p dan partisi bulanan 2023-2027 berhasil dibuat.');

    // 4. Skrip 03: Data Mart Summary Harian
    console.log('\n[4/7] ⏳ Menyiapkan tabel data mart summary (hrts_daily_sales_summary & hrts_daily_refund_summary)...');
    const sqlSummary = readSqlFile('03_create_summary_tables.sql');
    await client.query(sqlSummary);
    console.log('      ✅ Tabel data mart harian berhasil disiapkan.');

    // 5. Penyelarasan Nama Tabel (Table Switching)
    console.log('\n[5/7] ⏳ Menyelaraskan nama tabel utama (hrts_sales & hrts_refund)...');
    
    // Cek apakah tabel hrts_sales_p masih ada (perlu di-rename ke hrts_sales)
    const checkP = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('hrts_sales_p', 'hrts_sales', 'hrts_refund_p', 'hrts_refund')
    `);
    const tables = checkP.rows.map(r => r.table_name);

    if (tables.includes('hrts_sales_p')) {
      // Jika hrts_sales lama sudah ada dan BUKAN partisi, amankan ke hrts_sales_legacy
      if (tables.includes('hrts_sales')) {
        const checkPart = await client.query(`
          SELECT count(*) AS is_part FROM pg_partitioned_table 
          WHERE partrelid = 'hrts_sales'::regclass;
        `).catch(() => ({ rows: [{ is_part: '0' }] }));

        if (parseInt(checkPart.rows[0].is_part, 10) === 0) {
          console.log('      📦 Mengarsipkan tabel lama: hrts_sales -> hrts_sales_legacy');
          await client.query('ALTER TABLE IF EXISTS hrts_sales RENAME TO hrts_sales_legacy;');
        }
      }
      await client.query('ALTER TABLE IF EXISTS hrts_sales_p RENAME TO hrts_sales;');
      console.log('      ✅ Tabel partisi hrts_sales_p aktif sebagai hrts_sales.');
    }

    if (tables.includes('hrts_refund_p')) {
      if (tables.includes('hrts_refund')) {
        const checkPart = await client.query(`
          SELECT count(*) AS is_part FROM pg_partitioned_table 
          WHERE partrelid = 'hrts_refund'::regclass;
        `).catch(() => ({ rows: [{ is_part: '0' }] }));

        if (parseInt(checkPart.rows[0].is_part, 10) === 0) {
          console.log('      📦 Mengarsipkan tabel lama: hrts_refund -> hrts_refund_legacy');
          await client.query('ALTER TABLE IF EXISTS hrts_refund RENAME TO hrts_refund_legacy;');
        }
      }
      await client.query('ALTER TABLE IF EXISTS hrts_refund_p RENAME TO hrts_refund;');
      console.log('      ✅ Tabel partisi hrts_refund_p aktif sebagai hrts_refund.');
    }

    // 6. Skrip 07 & 08: Views Kompatibilitas, Okupansi & Stored Procedure
    console.log('\n[6/7] ⏳ Menyiapkan view kompatibilitas, skema okupansi, dan stored procedure agregasi...');
    const sqlCompat = readSqlFile('07_create_views_compatibility.sql');
    await client.query(sqlCompat);

    const sqlOccupancy = readSqlFile('08_create_occupancy_tables.sql');
    await client.query(sqlOccupancy);
    console.log('      ✅ View kompatibilitas, modul okupansi kereta, dan stored procedure sp_refresh_daily_summary berhasil dipasang.');

    // 7. Skrip 09: Pengguna RBAC & Audit Upload History
    console.log('\n[7/7] ⏳ Menyiapkan tabel pengguna RBAC dan riwayat audit upload...');
    const sqlUsers = readSqlFile('09_create_users_table.sql');
    await client.query(sqlUsers);
    console.log('      ✅ Tabel users, akun default (admin & operator), dan tabel upload_history berhasil disiapkan.');

    console.log('\n=======================================================');
    console.log('🎉 MIGRASI DATABASE BERHASIL 100%!');
    console.log('   - Akun Admin: username "admin", password "Admin@123"');
    console.log('   - Akun User : username "operator", password "User@123"');
    console.log('=======================================================');

  } catch (err) {
    console.error('\n❌ GAGAL MENJALANKAN MIGRASI DATABASE:');
    console.error(err.message || err);
    if (err.detail) console.error(`Detail: ${err.detail}`);
    if (err.hint) console.error(`Hint  : ${err.hint}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
