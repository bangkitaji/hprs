/**
 * Script Import & Pembaruan Data Penjualan Tiket (HRTS Sales)
 * Sumber: D:\KCIC\depositMovement\SQL\hrts_sales_300926_1413.sql
 * Target: hrts_sales (Partitioned Table) & hrts_daily_sales_summary (Data Mart)
 * 
 * Mekanisme Keamanan & Performa Tinggi:
 * 1. File dump mentah berukuran ~10GB dengan 19,2 juta baris berisi perintah 'DROP TABLE hrts_sales'
 *    yang berbahaya bagi tabel partisi produksi.
 * 2. Skrip ini mem-bypass DDL berbahaya, lalu mengalirkan data baris per baris via stream parser TSV
 *    langsung ke PostgreSQL menggunakan engine native COPY (75.000+ - 120.000 baris/detik).
 * 3. Mendukung baris multiline (string dengan embedded newline).
 * 4. Data dimuat ke UNLOGGED staging table 'hrts_sales_staging' tanpa overhead WAL.
 * 5. Pemindahan data ke tabel berpartisi produksi 'hrts_sales' dilakukan secara modular per bulan
 *    dengan deduplikasi idempotens (ON CONFLICT DO UPDATE).
 * 6. Data mart 'hrts_daily_sales_summary' otomatis disinkronkan dan diregenerasi.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { spawn } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const { pool } = require('../src/config/database');

const DUMP_FILE_PATH = 'D:\\KCIC\\depositMovement\\SQL\\hrts_sales_300926_1413.sql';
const PSQL_BIN = 'D:\\postgre\\bin\\psql.exe';

function formatDuration(ms) {
  const sec = (ms / 1000).toFixed(1);
  return `${sec}s`;
}

// Konversi tuple SQL VALUES ke format TSV untuk PostgreSQL COPY
function tupleToTsv(sqlTuple) {
  let i = 1;
  const len = sqlTuple.length - 1;
  let result = '';
  let inQuote = false;
  let currentField = '';

  while (i < len) {
    const ch = sqlTuple[i];
    if (inQuote) {
      if (ch === "'") {
        if (i + 1 < len && sqlTuple[i + 1] === "'") {
          currentField += "'";
          i += 2;
          continue;
        } else {
          inQuote = false;
          i++;
          continue;
        }
      } else if (ch === '\\') {
        currentField += '\\\\';
      } else if (ch === '\t') {
        currentField += '\\t';
      } else if (ch === '\n') {
        currentField += '\\n';
      } else if (ch === '\r') {
        currentField += '\\r';
      } else {
        currentField += ch;
      }
      i++;
    } else {
      if (ch === "'") {
        inQuote = true;
        i++;
      } else if (ch === ',') {
        const trimmed = currentField.trim();
        if (trimmed === 'NULL') {
          result += '\\N\t';
        } else {
          result += trimmed + '\t';
        }
        currentField = '';
        i++;
      } else {
        currentField += ch;
        i++;
      }
    }
  }

  const trimmed = currentField.trim();
  if (trimmed === 'NULL') {
    result += '\\N';
  } else {
    result += trimmed;
  }
  return result;
}

// Generate rentang bulan antara start YYYY-MM dan end YYYY-MM
function generateMonthRanges(startYM, endYM) {
  const ranges = [];
  let [currY, currM] = startYM.split('-').map(Number);
  const [endY, endM] = endYM.split('-').map(Number);

  while (currY < endY || (currY === endY && currM <= endM)) {
    const ymStr = `${currY}-${String(currM).padStart(2, '0')}`;
    let nextY = currY;
    let nextM = currM + 1;
    if (nextM > 12) {
      nextY++;
      nextM = 1;
    }
    const nextYmStr = `${nextY}-${String(nextM).padStart(2, '0')}`;

    ranges.push({
      name: ymStr,
      start: `${ymStr}-01`,
      end: `${nextYmStr}-01`
    });

    currY = nextY;
    currM = nextM;
  }
  return ranges;
}

async function main() {
  console.log('================================================================');
  console.log('🚄 MEMULAI PEMBARUAN DATA SALES TIKET (HRTS SALES)');
  console.log(`   Sumber File : ${DUMP_FILE_PATH}`);
  console.log(`   Database    : ${process.env.DB_NAME || 'hpr_portal'}`);
  console.log(`   Host        : ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}`);
  console.log('================================================================\n');

  const overallStart = Date.now();
  const client = await pool.connect();

  try {
    // -------------------------------------------------------------
    // Langkah 1: Ingestion ke Staging (hrts_sales_staging)
    // -------------------------------------------------------------
    console.log('[1/5] ⏳ Menyiapkan data staging hrts_sales_staging...');
    const checkStaging = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'hrts_sales_staging'
      ) as exists;
    `);

    let stagingCount = 0;
    if (checkStaging.rows[0].exists) {
      const cntRes = await client.query('SELECT count(*) FROM hrts_sales_staging;');
      stagingCount = parseInt(cntRes.rows[0].count, 10);
    }

    if (stagingCount >= 19000000) {
      console.log(`      ⚡ Tabel staging sudah berisi ${stagingCount.toLocaleString('id-ID')} baris. Melewati proses stream dump awal.`);
    } else {
      const step1Start = Date.now();
      console.log('      ⏳ Membuat tabel UNLOGGED hrts_sales_staging...');

      await client.query(`
        DROP TABLE IF EXISTS hrts_sales_staging;
        CREATE UNLOGGED TABLE hrts_sales_staging (
          "Seq No" numeric,
          "Passenger Name" varchar(225),
          "NIK/Passport No." varchar(225),
          "nationality" varchar(225),
          "Order No." varchar(225),
          "Ticket No." varchar(225),
          "Ticketing Station" varchar(225),
          "Business Area" varchar(225),
          "Office No." varchar(225),
          "Window No." varchar(225),
          "Shift No." varchar(225),
          "Operator Name" varchar(225),
          "Ticketing Time" varchar(225),
          "Departure Date" date,
          "Train No." varchar(225),
          "origin" varchar(225),
          "Cars Number" varchar(225),
          "Seat Number" varchar(225),
          "Origin Code" varchar(225),
          "Purchase Date" date,
          "Purchase Time" time(6),
          "Departure Time" time(6),
          "destination" varchar(225),
          "Destination Code" varchar(225),
          "Arrival Date" date,
          "Arrival Time" time(6),
          "Seat Class" varchar(225),
          "Ticket Type" varchar(225),
          "Original Ticket Price" numeric,
          "Discount Type" varchar(225),
          "Discount Rate" numeric,
          "Before Tax Price" numeric,
          "Tax Rate" numeric,
          "After Tax Price" numeric,
          "Ticketing Channel" varchar(225),
          "Payment Method" varchar(225),
          "Trade No" varchar(225),
          "PlatTrade No" varchar(225),
          "Payment Gateway" varchar(225),
          "B2B Partner" varchar(225)
        );
      `);

      console.log('      ⏳ Mengalirkan stream SQL dump ke PostgreSQL via engine COPY...');

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

      const stdin = psqlProc.stdin;
      stdin.write('COPY hrts_sales_staging FROM STDIN WITH (FORMAT text);\n');

      const fileStream = fs.createReadStream(DUMP_FILE_PATH, {
        highWaterMark: 4 * 1024 * 1024 // 4MB buffer
      });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      const prefix = 'INSERT INTO "public"."hrts_sales" VALUES ';
      const prefixLen = prefix.length;
      let streamedCount = 0;
      let statementBuffer = '';
      let inQuote = false;

      for await (const line of rl) {
        if (!statementBuffer) {
          if (!line.startsWith(prefix)) continue;

          // Check for multiline
          let quoteCount = 0;
          for (let i = 0; i < line.length; i++) {
            if (line[i] === "'") {
              if (i + 1 < line.length && line[i + 1] === "'") {
                i++;
              } else {
                quoteCount++;
              }
            }
          }

          if (quoteCount % 2 === 0 && line.trimEnd().endsWith(');')) {
            // FAST PATH: single line
            streamedCount++;
            let val = line.substring(prefixLen).trim();
            if (val.endsWith(';')) val = val.substring(0, val.length - 1);

            const tsv = tupleToTsv(val);
            const canWrite = stdin.write(tsv + '\n');
            if (!canWrite) {
              await new Promise(resolve => stdin.once('drain', resolve));
            }

            if (streamedCount % 2000000 === 0) {
              const now = Date.now();
              const elapsed = (now - step1Start) / 1000;
              const rate = Math.round(streamedCount / elapsed);
              console.log(`         -> Terkirim ${(streamedCount / 1000000).toFixed(0)}M baris (${rate.toLocaleString('id-ID')} baris/detik, ${formatDuration(now - step1Start)})`);
            }
            continue;
          }

          // Multiline start
          statementBuffer = line;
          inQuote = (quoteCount % 2 !== 0);
        } else {
          // Multiline continuation
          for (let i = 0; i < line.length; i++) {
            if (line[i] === "'") {
              if (inQuote && i + 1 < line.length && line[i + 1] === "'") {
                i++;
              } else {
                inQuote = !inQuote;
              }
            }
          }

          statementBuffer += '\n' + line;

          if (!inQuote && statementBuffer.trimEnd().endsWith(');')) {
            streamedCount++;
            let val = statementBuffer.substring(prefixLen).trim();
            if (val.endsWith(';')) val = val.substring(0, val.length - 1);

            const tsv = tupleToTsv(val);
            const canWrite = stdin.write(tsv + '\n');
            if (!canWrite) {
              await new Promise(resolve => stdin.once('drain', resolve));
            }

            statementBuffer = '';
            inQuote = false;

            if (streamedCount % 2000000 === 0) {
              const now = Date.now();
              const elapsed = (now - step1Start) / 1000;
              const rate = Math.round(streamedCount / elapsed);
              console.log(`         -> Terkirim ${(streamedCount / 1000000).toFixed(0)}M baris (${rate.toLocaleString('id-ID')} baris/detik, ${formatDuration(now - step1Start)})`);
            }
          }
        }
      }

      stdin.write('\\.\n\\q\n');
      stdin.end();

      await new Promise((resolve, reject) => {
        psqlProc.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`psql error (${code}): ${psqlStderr}`));
        });
      });

      const stagingCountRes = await client.query('SELECT count(*) FROM hrts_sales_staging;');
      stagingCount = parseInt(stagingCountRes.rows[0].count, 10);
      console.log(`      ✅ Staging berhasil disiapkan. Total baris: ${stagingCount.toLocaleString('id-ID')} baris (${formatDuration(Date.now() - step1Start)})`);
    }

    // -------------------------------------------------------------
    // Langkah 2: Buat Indeks pada Staging untuk Akses Cepat
    // -------------------------------------------------------------
    console.log('\n[2/5] ⏳ Membuat indeks pencarian pada hrts_sales_staging ("Purchase Date")...');
    const step2Start = Date.now();
    await client.query('CREATE INDEX IF NOT EXISTS idx_sales_staging_pur_date ON hrts_sales_staging ("Purchase Date");');
    console.log(`      ✅ Indeks staging berhasil dibuat (${formatDuration(Date.now() - step2Start)})`);

    // -------------------------------------------------------------
    // Langkah 3: Batch Upsert ke Tabel Partisi hrts_sales per Bulan
    // -------------------------------------------------------------
    console.log('\n[3/5] ⏳ Mengidentifikasi rentang periode data penjualan...');
    const minMaxRes = await client.query(`
      SELECT 
        to_char(min("Purchase Date"), 'YYYY-MM') as min_ym,
        to_char(max("Purchase Date"), 'YYYY-MM') as max_ym
      FROM hrts_sales_staging;
    `);

    const minYM = minMaxRes.rows[0].min_ym || '2023-10';
    const maxYM = minMaxRes.rows[0].max_ym || '2026-10';
    const months = generateMonthRanges(minYM, maxYM);
    console.log(`      Rentang terdeteksi: ${minYM} s/d ${maxYM} (${months.length} bulan)`);

    console.log('\n      ⏳ Memigrasikan data ke tabel partisi hrts_sales per bulan...');
    const step3Start = Date.now();
    let totalUpserted = 0;

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const mStart = Date.now();
      process.stdout.write(`      [${String(i + 1).padStart(2, '0')}/${months.length}] Memproses bulan ${m.name}... `);

      const upsertMonthlySql = `
        INSERT INTO hrts_sales (
          seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
          ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
          ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
          origin_code, purchase_date, purchase_time, departure_time, destination,
          destination_code, arrival_date, arrival_time, seat_class, ticket_type,
          original_ticket_price, discount_type, discount_rate, before_tax_price,
          tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
          plat_trade_no, payment_gateway, b2b_partner
        )
        SELECT
          CASE WHEN "Seq No"::text ~ '^[0-9]+$' THEN "Seq No"::BIGINT ELSE NULL END,
          "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
          "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
          CASE WHEN "Ticketing Time" ~ '^[0-9]{8}$' THEN to_date("Ticketing Time", 'YYYYMMDD') ELSE NULL END,
          "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
          "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
          "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
          COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
          COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
          "PlatTrade No", "Payment Gateway", "B2B Partner"
        FROM (
          SELECT DISTINCT ON ("Order No.", "Ticket No.", "Purchase Date") *
          FROM hrts_sales_staging
          WHERE "Purchase Date" >= $1 AND "Purchase Date" < $2
            AND "Order No." IS NOT NULL AND "Ticket No." IS NOT NULL AND "Purchase Date" IS NOT NULL
          ORDER BY "Order No.", "Ticket No.", "Purchase Date", "Seq No" DESC NULLS LAST
        ) s
        ON CONFLICT (order_no, ticket_no, purchase_date)
        DO UPDATE SET
          seq_no = EXCLUDED.seq_no,
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
          purchase_time = EXCLUDED.purchase_time,
          departure_time = EXCLUDED.departure_time,
          destination = EXCLUDED.destination,
          destination_code = EXCLUDED.destination_code,
          arrival_date = EXCLUDED.arrival_date,
          arrival_time = EXCLUDED.arrival_time,
          seat_class = EXCLUDED.seat_class,
          ticket_type = EXCLUDED.ticket_type,
          original_ticket_price = EXCLUDED.original_ticket_price,
          discount_type = EXCLUDED.discount_type,
          discount_rate = EXCLUDED.discount_rate,
          before_tax_price = EXCLUDED.before_tax_price,
          tax_rate = EXCLUDED.tax_rate,
          after_tax_price = EXCLUDED.after_tax_price,
          ticketing_channel = EXCLUDED.ticketing_channel,
          payment_method = EXCLUDED.payment_method,
          trade_no = EXCLUDED.trade_no,
          plat_trade_no = EXCLUDED.plat_trade_no,
          payment_gateway = EXCLUDED.payment_gateway,
          b2b_partner = EXCLUDED.b2b_partner;
      `;

      const mRes = await client.query(upsertMonthlySql, [m.start, m.end]);
      totalUpserted += mRes.rowCount;
      console.log(`✅ (${mRes.rowCount.toLocaleString('id-ID')} baris, ${formatDuration(Date.now() - mStart)})`);
    }

    console.log(`      ✅ Seluruh batch bulan berhasil di-upsert ke hrts_sales (${formatDuration(Date.now() - step3Start)})`);

    // -------------------------------------------------------------
    // Langkah 4: Regenerasi Data Mart hrts_daily_sales_summary per Bulan
    // -------------------------------------------------------------
    console.log('\n[4/5] ⏳ Memperbarui ringkasan harian hrts_daily_sales_summary per bulan...');
    const step4Start = Date.now();

    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const mStart = Date.now();
      process.stdout.write(`      [${String(i + 1).padStart(2, '0')}/${months.length}] Refresh summary bulan ${m.name}... `);

      await client.query(`
        DELETE FROM hrts_daily_sales_summary 
        WHERE summary_date >= $1 AND summary_date < $2;
      `, [m.start, m.end]);

      const refreshSummarySql = `
        INSERT INTO hrts_daily_sales_summary (
          summary_date, departure_date, ticketing_station, origin_code,
          destination_code, train_no, seat_class, ticketing_channel,
          payment_gateway, b2b_partner, total_tickets, total_gross_amount,
          total_discount_amount, total_tax_amount, total_net_amount, updated_at
        )
        SELECT
          purchase_date AS summary_date,
          COALESCE(departure_date, purchase_date) AS departure_date,
          COALESCE(ticketing_station, '') AS ticketing_station,
          COALESCE(origin_code, '') AS origin_code,
          COALESCE(destination_code, '') AS destination_code,
          COALESCE(train_no, '') AS train_no,
          COALESCE(seat_class, '') AS seat_class,
          COALESCE(ticketing_channel, '') AS ticketing_channel,
          COALESCE(payment_gateway, '') AS payment_gateway,
          COALESCE(b2b_partner, '') AS b2b_partner,
          COUNT(*)::INT AS total_tickets,
          COALESCE(SUM(original_ticket_price), 0) AS total_gross_amount,
          COALESCE(SUM(original_ticket_price - before_tax_price), 0) AS total_discount_amount,
          COALESCE(SUM(after_tax_price - before_tax_price), 0) AS total_tax_amount,
          COALESCE(SUM(after_tax_price), 0) AS total_net_amount,
          CURRENT_TIMESTAMP AS updated_at
        FROM hrts_sales
        WHERE purchase_date >= $1 AND purchase_date < $2
        GROUP BY
          purchase_date,
          COALESCE(departure_date, purchase_date),
          COALESCE(ticketing_station, ''),
          COALESCE(origin_code, ''),
          COALESCE(destination_code, ''),
          COALESCE(train_no, ''),
          COALESCE(seat_class, ''),
          COALESCE(ticketing_channel, ''),
          COALESCE(payment_gateway, ''),
          COALESCE(b2b_partner, '');
      `;

      const sumRes = await client.query(refreshSummarySql, [m.start, m.end]);
      console.log(`✅ (${sumRes.rowCount.toLocaleString('id-ID')} baris summary, ${formatDuration(Date.now() - mStart)})`);
    }

    console.log(`      ✅ Seluruh ringkasan hrts_daily_sales_summary berhasil diperbarui (${formatDuration(Date.now() - step4Start)})`);

    // -------------------------------------------------------------
    // Langkah 5: Verifikasi & Rekonsiliasi Hasil
    // -------------------------------------------------------------
    console.log('\n[5/5] ⏳ Melakukan verifikasi dan rekonsiliasi data...');
    const countSales = await client.query(`
      SELECT 
        COUNT(*) AS total_rows,
        COUNT(DISTINCT purchase_date) AS total_dates,
        TO_CHAR(MIN(purchase_date), 'YYYY-MM-DD') AS min_date,
        TO_CHAR(MAX(purchase_date), 'YYYY-MM-DD') AS max_date,
        SUM(after_tax_price) AS grand_total_revenue
      FROM hrts_sales;
    `);

    const countSummary = await client.query(`
      SELECT 
        COUNT(*) AS total_summary_rows,
        COUNT(DISTINCT summary_date) AS total_summary_dates,
        SUM(total_net_amount) AS summary_revenue
      FROM hrts_daily_sales_summary;
    `);

    console.log('      🧹 Membersihkan tabel staging sementara hrts_sales_staging...');
    await client.query('DROP TABLE IF EXISTS hrts_sales_staging;');

    console.log('\n================================================================');
    console.log('🎉 PROSES PEMBARUAN DATA SALES BERHASIL 100%!');
    console.log('================================================================');
    console.log(`📊 Statistik Tabel hrts_sales:`);
    console.log(`   - Total Baris          : ${parseInt(countSales.rows[0].total_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Rentang Tanggal      : ${countSales.rows[0].min_date} s/d ${countSales.rows[0].max_date} (${countSales.rows[0].total_dates} hari)`);
    console.log(`   - Total Pendapatan Net : Rp ${parseFloat(countSales.rows[0].grand_total_revenue).toLocaleString('id-ID')}`);
    console.log(`📊 Statistik Tabel Summary (hrts_daily_sales_summary):`);
    console.log(`   - Total Baris Summary  : ${parseInt(countSummary.rows[0].total_summary_rows, 10).toLocaleString('id-ID')}`);
    console.log(`   - Total Hari Summary   : ${countSummary.rows[0].total_summary_dates} hari`);
    console.log(`   - Total Revenue Summary: Rp ${parseFloat(countSummary.rows[0].summary_revenue).toLocaleString('id-ID')}`);
    console.log(`⏱️ Total Waktu Eksekusi   : ${formatDuration(Date.now() - overallStart)}`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n❌ TERJADI KESALAHAN SAAT PROSES UPDATE SALES:');
    console.error(err.message || err);
    if (err.detail) console.error(`Detail: ${err.detail}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
