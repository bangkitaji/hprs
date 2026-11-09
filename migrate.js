/**
 * Database Migration Runner
 * FAREBOX DATA MANAGEMENT — Whoosh High Speed Railway
 * 
 * Menjalankan skrip inisialisasi skema partisi, data mart, RBAC, dan audit log
 * menggunakan konfigurasi kredensial dari file .env.
 */

const fs = require('fs');
const path = require('path');
const { loadEnvironmentConfig } = require('./src/config/envLoader');

// 1. Muat konfigurasi .env dengan engine universal
const { loadedPath, parsedKeys, dbConfig } = loadEnvironmentConfig();

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
  const detectedKeys = Object.keys(parsedKeys);
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(dbConfig.host.toLowerCase());

  console.log('=======================================================');
  console.log('🚄 MEMULAI MIGRASI DATABASE FAREBOX DATA MANAGEMENT');
  console.log(`   Config File : ${loadedPath ? loadedPath : '⚠️ TIDAK DITEMUKAN (Menggunakan default)'}`);
  console.log(`   Detected Env: ${detectedKeys.length > 0 ? detectedKeys.join(', ') : 'None'}`);
  console.log(`   Target Host : ${dbConfig.host}:${dbConfig.port}`);
  console.log(`   Database    : ${dbConfig.database}`);
  console.log(`   DB User     : ${dbConfig.user}`);
  console.log(`   SSL Mode    : ${dbConfig.ssl ? 'Enabled' : 'Disabled'}`);
  if (isLocalhost) {
    console.log(`   ℹ️ Catatan   : Target saat ini adalah LOCALHOST.`);
    console.log(`                 Jika DB Anda di server lain, pastikan 'DB_HOST=<IP_DB>'`);
    console.log(`                 tertera di file .env atau jalankan: DB_HOST=<IP> node migrate.js`);
  }
  console.log('=======================================================\n');

  let client;
  try {
    client = await pool.connect();
  } catch (connErr) {
    console.error('❌ GAGAL MEMBUAT KONEKSI KE DATABASE POSTGRESQL:');
    console.error(`   Target host: ${dbConfig.host}:${dbConfig.port}`);
    console.error(`   Pesan Error: ${connErr.message}`);
    console.error('\n🔍 PETUNJUK TROUBLESHOOTING:');
    if (isLocalhost) {
      console.error('   1. Anda mengarahkan koneksi ke LOCALHOST (127.0.0.1).');
      console.error('      Jika database PostgreSQL Anda berada di server/VM lain, ubah DB_HOST di .env:');
      console.error('      Contoh: DB_HOST=10.20.x.x');
      console.error('      Atau jalankan langsung:');
      console.error(`      DB_HOST=<IP_SERVER_DB> DB_PASSWORD=<PASSWORD> node migrate.js\n`);
    } else {
      console.error(`   1. Pastikan server ${dbConfig.host} dapat di-ping dari server ini.`);
      console.error(`   2. Periksa firewall/Security Group agar port ${dbConfig.port} dibuka.`);
      console.error(`   3. Periksa file pg_hba.conf dan listen_addresses = '*' di server database.`);
    }
    process.exit(1);
  }

  try {
    // 1. Verifikasi Koneksi
    const resVer = await client.query('SELECT version(), current_database(), current_user;');
    console.log(`[1/9] ✅ Terhubung ke PostgreSQL: ${resVer.rows[0].current_database} (User: ${resVer.rows[0].current_user})`);

    // 2. Skrip 01: Tabel Master & Partisi hrts_sales_p
    const checkSales = await client.query(`
      SELECT to_regclass('public.hrts_sales') AS sales_table,
             to_regclass('public.hrts_sales_p') AS sales_p_table;
    `);
    const hasSales = Boolean(checkSales.rows[0].sales_table || checkSales.rows[0].sales_p_table);

    if (!hasSales) {
      console.log('\n[2/9] ⏳ Menyiapkan tabel partisi penjualan (hrts_sales_p)...');
      const sqlSales = readSqlFile('01_create_partitioned_sales.sql');
      await client.query(sqlSales);
      console.log('      ✅ Skema hrts_sales_p dan partisi bulanan 2023-2027 berhasil dibuat.');
    } else {
      console.log('\n[2/9] ℹ️ Tabel partisi penjualan (hrts_sales) sudah ada, melewati pembuatan ulang skema.');
    }

    // 3. Skrip 02: Tabel Master & Partisi hrts_refund_p
    const checkRefund = await client.query(`
      SELECT to_regclass('public.hrts_refund') AS refund_table,
             to_regclass('public.hrts_refund_p') AS refund_p_table;
    `);
    const hasRefund = Boolean(checkRefund.rows[0].refund_table || checkRefund.rows[0].refund_p_table);

    if (!hasRefund) {
      console.log('\n[3/9] ⏳ Menyiapkan tabel partisi refund (hrts_refund_p)...');
      const sqlRefund = readSqlFile('02_create_partitioned_refund.sql');
      await client.query(sqlRefund);
      console.log('      ✅ Skema hrts_refund_p dan partisi bulanan 2023-2027 berhasil dibuat.');
    } else {
      console.log('\n[3/9] ℹ️ Tabel partisi refund (hrts_refund) sudah ada, melewati pembuatan ulang skema.');
    }

    // 4. Skrip 03: Data Mart Summary Harian
    console.log('\n[4/9] ⏳ Menyiapkan tabel data mart summary (hrts_daily_sales_summary & hrts_daily_refund_summary)...');
    const sqlSummary = readSqlFile('03_create_summary_tables.sql');
    await client.query(sqlSummary);
    console.log('      ✅ Tabel data mart harian berhasil disiapkan.');

    // 5. Penyelarasan Nama Tabel (Table Switching)
    console.log('\n[5/9] ⏳ Menyelaraskan nama tabel utama (hrts_sales & hrts_refund)...');
    
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

    // Pastikan kolom penyesuaian status tiket selalu tersedia di hrts_sales & hrts_refund
    await client.query('ALTER TABLE IF EXISTS hrts_sales ADD COLUMN IF NOT EXISTS add_sales_status_ticket VARCHAR(100);');
    await client.query('ALTER TABLE IF EXISTS hrts_refund ADD COLUMN IF NOT EXISTS add_refund_status_ticket VARCHAR(100);');
    console.log('      ✅ Verifikasi kolom status tiket (add_sales_status_ticket & add_refund_status_ticket) selesai.');

    // 6. Skrip 07 & 08: Views Kompatibilitas, Okupansi & Stored Procedure
    console.log('\n[6/9] ⏳ Menyiapkan view kompatibilitas, skema okupansi, dan stored procedure agregasi...');
    const sqlCompat = readSqlFile('07_create_views_compatibility.sql');
    await client.query(sqlCompat);

    const sqlOccupancy = readSqlFile('08_create_occupancy_tables.sql');
    await client.query(sqlOccupancy);
    console.log('      ✅ View kompatibilitas, modul okupansi kereta, dan stored procedure sp_refresh_daily_summary berhasil dipasang.');

    // 7. Skrip 09: Pengguna RBAC & Audit Upload History
    console.log('\n[7/9] ⏳ Menyiapkan tabel pengguna RBAC dan riwayat audit upload...');
    const sqlUsers = readSqlFile('09_create_users_table.sql');
    await client.query(sqlUsers);
    console.log('      ✅ Tabel users, akun default (admin & operator), dan tabel upload_history berhasil disiapkan.');

    // 8. Skrip 10: Middleware & Payment Gateway Tables
    console.log('\n[8/9] ⏳ Menyiapkan tabel Middleware & Payment Gateway (Xendit, Finnet, Doku)...');
    const sqlPg = readSqlFile('10_create_middleware_and_pg_tables.sql');
    await client.query(sqlPg);
    console.log('      ✅ Tabel middleware_transactions, pg_xendit_settlements, pg_finnet_settlements, pg_doku_qr_settlements, pg_doku_all_settlements berhasil disiapkan.');

    // 9. Skrip 11: Modul Rekonsiliasi Otomatis (reconciliation_batches & reconciliation_items)
    console.log('\n[9/9] ⏳ Menyiapkan tabel Rekonsiliasi Otomatis (reconciliation_batches & reconciliation_items)...');
    const sqlRecon = readSqlFile('11_create_reconciliation_tables.sql');
    await client.query(sqlRecon);
    console.log('      ✅ Tabel reconciliation_batches dan reconciliation_items berhasil disiapkan.');

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
    if (client) client.release();
    await pool.end();
  }
}

runMigration();
