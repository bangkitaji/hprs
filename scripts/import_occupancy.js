/**
 * Script Import & Migrasi Data Okupansi Kereta (HRTS Occupancy)
 * Dari: D:\KCIC\depositMovement\SQL\hrts_occupancy_system300926_1415.sql
 * Ke Tabel Target: hrts_occupancy & hrts_daily_occupancy_summary
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { spawn } = require('child_process');
const { pool } = require('../src/config/database');

const DUMP_FILE_PATH = 'D:\\KCIC\\depositMovement\\SQL\\hrts_occupancy_system300926_1415.sql';
const PSQL_BIN = 'D:\\postgre\\bin\\psql.exe';

function formatDuration(ms) {
  const sec = (ms / 1000).toFixed(1);
  return `${sec}s`;
}

async function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { env: { ...process.env, ...env } });
    let stderr = '';

    proc.stdout.on('data', (data) => {
      // Supress millions of INSERT 0 1 prints to avoid flooding logs
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Process exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('================================================================');
  console.log('🚀 MEMULAI IMPORT DATA OKUPANSI (HRTS OCCUPANCY)');
  console.log(`   Sumber File : ${DUMP_FILE_PATH}`);
  console.log(`   Database    : ${process.env.DB_NAME || 'hpr_portal'}`);
  console.log(`   Host        : ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
  console.log('================================================================\n');

  const overallStart = Date.now();
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------
    // Langkah 1: Cek / Eksekusi SQL Dump ke Staging (hrts_occupancy_system)
    // -------------------------------------------------------------
    console.log('[1/4] ⏳ Menyiapkan data staging hrts_occupancy_system...');
    const checkStaging = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'hrts_occupancy_system'
      ) as exists;
    `);

    let stagingCount = 0;
    if (checkStaging.rows[0].exists) {
      const cntRes = await client.query('SELECT count(*) FROM hrts_occupancy_system;');
      stagingCount = parseInt(cntRes.rows[0].count, 10);
    }

    if (stagingCount >= 480000) {
      console.log(`      ⚡ Tabel staging sudah berisi ${stagingCount.toLocaleString()} baris. Melewati proses import dump awal.`);
    } else {
      const step1Start = Date.now();
      console.log('      ⏳ Menjalankan import dump SQL via psql...');
      await runCommand(
        PSQL_BIN,
        [
          '-h', process.env.DB_HOST || 'localhost',
          '-p', String(process.env.DB_PORT || 5432),
          '-U', process.env.DB_USER || 'postgres',
          '-d', process.env.DB_NAME || 'hpr_portal',
          '-q',
          '-f', DUMP_FILE_PATH
        ],
        { PGPASSWORD: process.env.DB_PASSWORD || 'Sukma@123098!@' }
      );

      const stagingCountRes = await client.query('SELECT count(*) FROM hrts_occupancy_system;');
      stagingCount = parseInt(stagingCountRes.rows[0].count, 10);
      console.log(`      ✅ Staging berhasil dibuat. Total baris diimpor: ${stagingCount.toLocaleString()} baris (${formatDuration(Date.now() - step1Start)})`);
    }

    // -------------------------------------------------------------
    // Langkah 2: Upsert dari staging ke tabel utama hrts_occupancy
    // Normalisasi: occupancy > 1 dibagi 100 agar sesuai format rasio desimal 0.0000 - 1.0000
    // -------------------------------------------------------------
    console.log('\n[2/4] ⏳ Memigrasikan & menyelaraskan data ke tabel hrts_occupancy...');
    const step2Start = Date.now();

    const upsertSql = `
      INSERT INTO hrts_occupancy (
        train_no,
        origin,
        destination,
        train_date,
        departure_time,
        seat_class,
        capacity_per_class,
        occupancy_rate,
        sum_passengers,
        total_fare,
        fare,
        created_at,
        updated_at
      )
      SELECT 
        train_number AS train_no,
        origin,
        destination,
        train_date,
        departure AS departure_time,
        class AS seat_class,
        COALESCE(capacity_per_class::int, 0) AS capacity_per_class,
        CASE 
          WHEN occupancy > 1.0 THEN ROUND(occupancy / 100.0, 4)
          ELSE ROUND(COALESCE(occupancy, 0), 4)
        END::numeric(6, 4) AS occupancy_rate,
        COALESCE(sumpsg::int, 0) AS sum_passengers,
        COALESCE(totfare, 0)::numeric(14, 2) AS total_fare,
        COALESCE(NULLIF(fare, '')::numeric, 0)::numeric(14, 2) AS fare,
        CURRENT_TIMESTAMP AS created_at,
        CURRENT_TIMESTAMP AS updated_at
      FROM hrts_occupancy_system
      ON CONFLICT (train_no, train_date, origin, destination, seat_class)
      DO UPDATE SET
        departure_time = EXCLUDED.departure_time,
        capacity_per_class = EXCLUDED.capacity_per_class,
        occupancy_rate = EXCLUDED.occupancy_rate,
        sum_passengers = EXCLUDED.sum_passengers,
        total_fare = EXCLUDED.total_fare,
        fare = EXCLUDED.fare,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await client.query(upsertSql);
    console.log(`      ✅ Data berhasil di-upsert ke hrts_occupancy (${formatDuration(Date.now() - step2Start)})`);

    // -------------------------------------------------------------
    // Langkah 3: Regenerasi Data Mart hrts_daily_occupancy_summary
    // -------------------------------------------------------------
    console.log('\n[3/4] ⏳ Memperbarui ringkasan harian hrts_daily_occupancy_summary...');
    const step3Start = Date.now();

    const refreshSummarySql = `
      INSERT INTO hrts_daily_occupancy_summary (
        summary_date,
        train_no,
        origin,
        destination,
        seat_class,
        total_capacity,
        total_passengers,
        avg_occupancy_rate,
        total_fare,
        updated_at
      )
      SELECT
        train_date AS summary_date,
        train_no,
        origin,
        destination,
        seat_class,
        COALESCE(SUM(capacity_per_class), 0)::INT AS total_capacity,
        COALESCE(SUM(sum_passengers), 0)::INT AS total_passengers,
        COALESCE(AVG(occupancy_rate), 0)::NUMERIC(6, 4) AS avg_occupancy_rate,
        COALESCE(SUM(total_fare), 0)::NUMERIC(14, 2) AS total_fare,
        CURRENT_TIMESTAMP AS updated_at
      FROM hrts_occupancy
      GROUP BY
        train_date,
        train_no,
        origin,
        destination,
        seat_class
      ON CONFLICT (summary_date, train_no, origin, destination, seat_class)
      DO UPDATE SET
        total_capacity = EXCLUDED.total_capacity,
        total_passengers = EXCLUDED.total_passengers,
        avg_occupancy_rate = EXCLUDED.avg_occupancy_rate,
        total_fare = EXCLUDED.total_fare,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await client.query(refreshSummarySql);
    console.log(`      ✅ Ringkasan hrts_daily_occupancy_summary berhasil diperbarui (${formatDuration(Date.now() - step3Start)})`);

    // -------------------------------------------------------------
    // Langkah 4: Verifikasi & Rekonsiliasi Hasil
    // -------------------------------------------------------------
    console.log('\n[4/4] ⏳ Melakukan verifikasi dan rekonsiliasi data...');
    const countOccupancy = await client.query(`
      SELECT 
        COUNT(*) AS total_rows,
        COUNT(DISTINCT train_date) AS total_dates,
        TO_CHAR(MIN(train_date), 'YYYY-MM-DD') AS min_date,
        TO_CHAR(MAX(train_date), 'YYYY-MM-DD') AS max_date,
        SUM(sum_passengers) AS grand_total_passengers,
        SUM(total_fare) AS grand_total_fare
      FROM hrts_occupancy;
    `);

    const countSummary = await client.query(`
      SELECT 
        COUNT(*) AS total_summary_rows,
        COUNT(DISTINCT summary_date) AS total_summary_dates
      FROM hrts_daily_occupancy_summary;
    `);

    // Cleanup staging table
    console.log('      🧹 Membersihkan tabel staging sementara hrts_occupancy_system...');
    await client.query('DROP TABLE IF EXISTS hrts_occupancy_system;');

    console.log('\n================================================================');
    console.log('🎉 PROSES IMPORT & MIGRASI DATA OKUPANSI BERHASIL!');
    console.log('================================================================');
    console.log(`📊 Statistik Tabel hrts_occupancy:`);
    console.log(`   - Total Baris          : ${parseInt(countOccupancy.rows[0].total_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Rentang Tanggal      : ${countOccupancy.rows[0].min_date} s/d ${countOccupancy.rows[0].max_date} (${countOccupancy.rows[0].total_dates} hari)`);
    console.log(`   - Total Penumpang      : ${parseInt(countOccupancy.rows[0].grand_total_passengers, 10).toLocaleString('id-ID')}`);
    console.log(`   - Total Pendapatan     : Rp ${parseFloat(countOccupancy.rows[0].grand_total_fare).toLocaleString('id-ID')}`);
    console.log(`📊 Statistik Tabel Summary:`);
    console.log(`   - Total Baris Summary  : ${parseInt(countSummary.rows[0].total_summary_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Total Hari Summary   : ${countSummary.rows[0].total_summary_dates} hari`);
    console.log(`⏱️ Total Waktu Eksekusi   : ${formatDuration(Date.now() - overallStart)}`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ TERJADI KESALAHAN SAAT PROSES IMPORT:');
    console.error(err.message || err);
    if (err.detail) console.error(`Detail: ${err.detail}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
