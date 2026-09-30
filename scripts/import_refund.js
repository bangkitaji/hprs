/**
 * Script Import & Pembaruan Data Refund (HRTS Refund)
 * Sumber: D:\KCIC\depositMovement\SQL\hrts_refund_300926_1355.sql
 * Target: hrts_refund (Partitioned Table) & hrts_daily_refund_summary
 * 
 * Mekanisme Keamanan:
 * File dump berisi 'DROP TABLE hrts_refund' yang dapat merusak tabel partisi produksi.
 * Skrip ini secara aman melakukan stream-replacement mengubah target menjadi 'hrts_refund_staging',
 * lalu memindahkan data ke tabel partisi utama via batch upsert (ON CONFLICT DO UPDATE).
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { spawn } = require('child_process');
const { Transform, pipeline } = require('stream');
const fs = require('fs');
const { pool } = require('../src/config/database');

const DUMP_FILE_PATH = 'D:\\KCIC\\depositMovement\\SQL\\hrts_refund_300926_1355.sql';
const PSQL_BIN = 'D:\\postgre\\bin\\psql.exe';

function formatDuration(ms) {
  const sec = (ms / 1000).toFixed(1);
  return `${sec}s`;
}

// Transform stream untuk mengalihkan tabel target dari 'hrts_refund' ke 'hrts_refund_staging'
class SafeStagingTransform extends Transform {
  constructor() {
    super();
    this._buffer = '';
    this.indexSkipped = false;
  }

  _transform(chunk, encoding, callback) {
    this._buffer += chunk.toString();
    const lines = this._buffer.split('\n');
    this._buffer = lines.pop();

    let output = '';
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Lewati pembuatan index di staging untuk mempercepat proses ingestion
      if (line.includes('CREATE INDEX') && line.includes('master_hrts_refund_nik_passport_no__idx')) {
        this.indexSkipped = true;
        continue;
      }
      if (this.indexSkipped) {
        if (line.trim().endsWith(');')) {
          this.indexSkipped = false;
        }
        continue;
      }

      // Alihkan target tabel ke staging
      if (line.includes('"public"."hrts_refund"')) {
        line = line.split('"public"."hrts_refund"').join('"public"."hrts_refund_staging"');
      }
      output += line + '\n';
    }
    this.push(output);
    callback();
  }

  _flush(callback) {
    if (this._buffer) {
      let line = this._buffer;
      if (line.includes('"public"."hrts_refund"')) {
        line = line.split('"public"."hrts_refund"').join('"public"."hrts_refund_staging"');
      }
      this.push(line);
    }
    callback();
  }
}

async function main() {
  console.log('================================================================');
  console.log('🚄 MEMULAI PEMBARUAN DATA REFUND (HRTS REFUND)');
  console.log(`   Sumber File : ${DUMP_FILE_PATH}`);
  console.log(`   Database    : ${process.env.DB_NAME || 'hpr_portal'}`);
  console.log(`   Host        : ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
  console.log('================================================================\n');

  const overallStart = Date.now();
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------
    // Langkah 1: Ingestion ke Staging (hrts_refund_staging)
    // -------------------------------------------------------------
    console.log('[1/4] ⏳ Menyiapkan data staging hrts_refund_staging...');
    const checkStaging = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'hrts_refund_staging'
      ) as exists;
    `);

    let stagingCount = 0;
    if (checkStaging.rows[0].exists) {
      const cntRes = await client.query('SELECT count(*) FROM hrts_refund_staging;');
      stagingCount = parseInt(cntRes.rows[0].count, 10);
    }

    if (stagingCount >= 1150000) {
      console.log(`      ⚡ Tabel staging sudah berisi ${stagingCount.toLocaleString('id-ID')} baris. Melewati proses stream dump awal.`);
    } else {
      const step1Start = Date.now();
      console.log('      ⏳ Menjalankan safe streaming pipe dump SQL ke psql...');

      const psqlProc = spawn(
        PSQL_BIN,
        [
          '-h', process.env.DB_HOST || 'localhost',
          '-p', String(process.env.DB_PORT || 5432),
          '-U', process.env.DB_USER || 'postgres',
          '-d', process.env.DB_NAME || 'hpr_portal',
          '-q',
          '-v', 'ON_ERROR_STOP=1'
        ],
        { env: { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'Sukma@123098!@' } }
      );

      let psqlStderr = '';
      psqlProc.stderr.on('data', d => { psqlStderr += d.toString(); });

      const readStream = fs.createReadStream(DUMP_FILE_PATH, {
        encoding: 'utf-8',
        highWaterMark: 1024 * 1024 // 1MB buffer
      });

      const transform = new SafeStagingTransform();

      await new Promise((resolve, reject) => {
        pipeline(readStream, transform, psqlProc.stdin, (err) => {
          if (err) reject(err);
        });

        psqlProc.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`psql error (${code}): ${psqlStderr}`));
        });
      });

      const stagingCountRes = await client.query('SELECT count(*) FROM hrts_refund_staging;');
      stagingCount = parseInt(stagingCountRes.rows[0].count, 10);
      console.log(`      ✅ Staging berhasil disiapkan. Total baris: ${stagingCount.toLocaleString('id-ID')} baris (${formatDuration(Date.now() - step1Start)})`);
    }

    // -------------------------------------------------------------
    // Langkah 2: Batch Upsert ke Tabel Partisi hrts_refund
    // -------------------------------------------------------------
    console.log('\n[2/4] ⏳ Memigrasikan data ke tabel partisi hrts_refund per periode...');
    const step2Start = Date.now();

    const batches = [
      { name: 'Tahun 2023 (Okt - Des)', filter: `"Refund date" < '20240101'` },
      { name: 'Tahun 2024 S1 (Jan - Jun)', filter: `"Refund date" >= '20240101' AND "Refund date" < '20240701'` },
      { name: 'Tahun 2024 S2 (Jul - Des)', filter: `"Refund date" >= '20240701' AND "Refund date" < '20250101'` },
      { name: 'Tahun 2025 S1 (Jan - Jun)', filter: `"Refund date" >= '20250101' AND "Refund date" < '20250701'` },
      { name: 'Tahun 2025 S2 (Jul - Des)', filter: `"Refund date" >= '20250701' AND "Refund date" < '20260101'` },
      { name: 'Tahun 2026 (Jan - Sep)', filter: `"Refund date" >= '20260101'` },
    ];

    let totalUpserted = 0;
    for (let i = 0; i < batches.length; i++) {
      const b = batches[i];
      const bStart = Date.now();
      process.stdout.write(`      [${i+1}/${batches.length}] Memproses ${b.name}... `);

      const upsertBatchSql = `
        INSERT INTO hrts_refund (
          seq_no, refund_date, cancelation_time, refund_type, refund_person,
          refund_charge_rate, refund_charge, refund_amount, refund_trade_no, plat_trade_no,
          refund_bank_code, refund_bank_name, refund_method, refund_state, refund_account,
          refund_account_name, actual_refund_amount, passenger_name, nik_passport_no,
          nationality, order_no, ticket_no, ticketing_station, business_area, office_no,
          window_no, shift_no, operator_name, ticketing_time, departure_date, train_no,
          origin, cars_number, seat_number, origin_code, purchase_date, purchase_time,
          departure_time, destination, destination_code, arrival_date, arrival_time,
          seat_class, ticket_type, original_ticket_price, created_at
        )
        SELECT
          CASE WHEN "Seq No" ~ '^[0-9]+$' THEN "Seq No"::BIGINT ELSE NULL END,
          to_date("Refund date", 'YYYYMMDD'),
          to_timestamp(NULLIF("Cancelation Time", ''), 'YYYY/MM/DD HH24:MI:SS'),
          "Refund Type", "Refund Person",
          COALESCE("Refund charge rate", 0), COALESCE("Refund Charge", 0), COALESCE("Refund Amount", 0),
          "refundtradeno", "plattradeno", "Refund Bank Code", "Refund Bank Name",
          "refundmethod", "refundstate", "Refund Account", "Refund Account Name",
          COALESCE("Actual Refund Amount", 0), "Passenger Name", "NIK/Passport No.",
          "nationality", "Order No.", "Ticket No.", "Ticketing Station", "Business Area",
          "Office No.", "Window No.", "Shift No.", "Operator Name", "Ticketing Time",
          "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
          "Origin Code", "Purchase Date", "Purchase Time", "Departure Time",
          "destination", "Destination Code", "Arrival Date", "Arrival Time",
          "Seat Class", "Ticket Type", COALESCE("Original Ticket Price", 0),
          CURRENT_TIMESTAMP
        FROM hrts_refund_staging
        WHERE ${b.filter}
        ON CONFLICT (order_no, ticket_no, refund_date)
        DO UPDATE SET
          seq_no = EXCLUDED.seq_no,
          cancelation_time = EXCLUDED.cancelation_time,
          refund_type = EXCLUDED.refund_type,
          refund_person = EXCLUDED.refund_person,
          refund_charge_rate = EXCLUDED.refund_charge_rate,
          refund_charge = EXCLUDED.refund_charge,
          refund_amount = EXCLUDED.refund_amount,
          refund_trade_no = EXCLUDED.refund_trade_no,
          plat_trade_no = EXCLUDED.plat_trade_no,
          refund_bank_code = EXCLUDED.refund_bank_code,
          refund_bank_name = EXCLUDED.refund_bank_name,
          refund_method = EXCLUDED.refund_method,
          refund_state = EXCLUDED.refund_state,
          refund_account = EXCLUDED.refund_account,
          refund_account_name = EXCLUDED.refund_account_name,
          actual_refund_amount = EXCLUDED.actual_refund_amount,
          passenger_name = EXCLUDED.passenger_name,
          nik_passport_no = EXCLUDED.nik_passport_no,
          nationality = EXCLUDED.nationality,
          ticketing_station = EXCLUDED.ticketing_station,
          business_area = EXCLUDED.business_area,
          office_no = EXCLUDED.office_no,
          window_no = EXCLUDED.window_no,
          shift_no = EXCLUDED.shift_no,
          operator_name = EXCLUDED.operator_name,
          ticketing_time = EXCLUDED.ticketing_time,
          departure_date = EXCLUDED.departure_date,
          train_no = EXCLUDED.train_no,
          origin = EXCLUDED.origin,
          cars_number = EXCLUDED.cars_number,
          seat_number = EXCLUDED.seat_number,
          origin_code = EXCLUDED.origin_code,
          purchase_date = EXCLUDED.purchase_date,
          purchase_time = EXCLUDED.purchase_time,
          departure_time = EXCLUDED.departure_time,
          destination = EXCLUDED.destination,
          destination_code = EXCLUDED.destination_code,
          arrival_date = EXCLUDED.arrival_date,
          arrival_time = EXCLUDED.arrival_time,
          seat_class = EXCLUDED.seat_class,
          ticket_type = EXCLUDED.ticket_type,
          original_ticket_price = EXCLUDED.original_ticket_price;
      `;

      const bRes = await client.query(upsertBatchSql);
      totalUpserted += bRes.rowCount;
      console.log(`✅ (${bRes.rowCount.toLocaleString('id-ID')} baris, ${formatDuration(Date.now() - bStart)})`);
    }

    console.log(`      ✅ Seluruh batch berhasil di-upsert ke hrts_refund (${formatDuration(Date.now() - step2Start)})`);

    // -------------------------------------------------------------
    // Langkah 3: Regenerasi Data Mart hrts_daily_refund_summary
    // -------------------------------------------------------------
    console.log('\n[3/4] ⏳ Memperbarui ringkasan harian hrts_daily_refund_summary...');
    const step3Start = Date.now();

    const refreshSummarySql = `
      INSERT INTO hrts_daily_refund_summary (
        summary_date, departure_date, refund_type,
        ticketing_station, refund_method, refund_state,
        total_refund_tickets, total_refund_amount,
        total_refund_charge, total_actual_refund, updated_at
      )
      SELECT
        refund_date AS summary_date,
        COALESCE(departure_date, refund_date) AS departure_date,
        COALESCE(refund_type, '') AS refund_type,
        COALESCE(ticketing_station, '') AS ticketing_station,
        COALESCE(refund_method, '') AS refund_method,
        COALESCE(refund_state, '') AS refund_state,
        COUNT(*)::INT AS total_refund_tickets,
        COALESCE(SUM(refund_amount), 0) AS total_refund_amount,
        COALESCE(SUM(refund_charge), 0) AS total_refund_charge,
        COALESCE(SUM(actual_refund_amount), 0) AS total_actual_refund,
        CURRENT_TIMESTAMP AS updated_at
      FROM hrts_refund
      GROUP BY
        refund_date,
        COALESCE(departure_date, refund_date),
        COALESCE(refund_type, ''),
        COALESCE(ticketing_station, ''),
        COALESCE(refund_method, ''),
        COALESCE(refund_state, '')
      ON CONFLICT (summary_date, departure_date, refund_type, ticketing_station, refund_method, refund_state)
      DO UPDATE SET
        total_refund_tickets = EXCLUDED.total_refund_tickets,
        total_refund_amount = EXCLUDED.total_refund_amount,
        total_refund_charge = EXCLUDED.total_refund_charge,
        total_actual_refund = EXCLUDED.total_actual_refund,
        updated_at = CURRENT_TIMESTAMP;
    `;

    await client.query(refreshSummarySql);
    console.log(`      ✅ Ringkasan hrts_daily_refund_summary berhasil diperbarui (${formatDuration(Date.now() - step3Start)})`);

    // -------------------------------------------------------------
    // Langkah 4: Verifikasi & Cleanup
    // -------------------------------------------------------------
    console.log('\n[4/4] ⏳ Melakukan verifikasi dan rekonsiliasi data...');
    const countRefund = await client.query(`
      SELECT 
        COUNT(*) AS total_rows,
        COUNT(DISTINCT refund_date) AS total_dates,
        TO_CHAR(MIN(refund_date), 'YYYY-MM-DD') AS min_date,
        TO_CHAR(MAX(refund_date), 'YYYY-MM-DD') AS max_date,
        SUM(actual_refund_amount) AS grand_total_actual_refund,
        SUM(refund_charge) AS grand_total_refund_charge
      FROM hrts_refund;
    `);

    const countSummary = await client.query(`
      SELECT 
        COUNT(*) AS total_summary_rows,
        COUNT(DISTINCT summary_date) AS total_summary_dates
      FROM hrts_daily_refund_summary;
    `);

    console.log('      🧹 Membersihkan tabel staging sementara hrts_refund_staging...');
    await client.query('DROP TABLE IF EXISTS hrts_refund_staging;');

    console.log('\n================================================================');
    console.log('🎉 PROSES PEMBARUAN DATA REFUND BERHASIL 100%!');
    console.log('================================================================');
    console.log(`📊 Statistik Tabel hrts_refund:`);
    console.log(`   - Total Baris          : ${parseInt(countRefund.rows[0].total_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Rentang Tanggal      : ${countRefund.rows[0].min_date} s/d ${countRefund.rows[0].max_date} (${countRefund.rows[0].total_dates} hari)`);
    console.log(`   - Total Pengembalian   : Rp ${parseFloat(countRefund.rows[0].grand_total_actual_refund).toLocaleString('id-ID')}`);
    console.log(`   - Total Biaya Batal    : Rp ${parseFloat(countRefund.rows[0].grand_total_refund_charge).toLocaleString('id-ID')}`);
    console.log(`📊 Statistik Tabel Summary:`);
    console.log(`   - Total Baris Summary  : ${parseInt(countSummary.rows[0].total_summary_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Total Hari Summary   : ${countSummary.rows[0].total_summary_dates} hari`);
    console.log(`⏱️ Total Waktu Eksekusi   : ${formatDuration(Date.now() - overallStart)}`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ TERJADI KESALAHAN SAAT PROSES UPDATE REFUND:');
    console.error(err.message || err);
    if (err.detail) console.error(`Detail: ${err.detail}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
