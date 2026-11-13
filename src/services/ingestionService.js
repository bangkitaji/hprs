const xlsx = require('xlsx');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { pool } = require('../config/database');
const { updateSheetRange, detectSheetStructure, cleanStr } = require('../utils/excel');
const {
  parseExcelDate,
  parseExcelTime,
  parseExcelTimestamp,
  parseRate,
  parseNumeric,
  parseBigInt,
} = require('../utils/formatters');
const {
  SALES_DB_FIELDS,
  REFUND_DB_FIELDS,
  OCCUPANCY_DB_FIELDS,
  MIDDLEWARE_DB_FIELDS,
  XENDIT_DB_FIELDS,
  FINNET_DB_FIELDS,
  DOKU_QR_DB_FIELDS,
  DOKU_ALL_DB_FIELDS,
  MIDDLEWARE_DEFAULT_HEADERS,
} = require('../constants/fieldMaps');
const { logUploadHistory } = require('./historyService');
const { invalidateStatsCache } = require('./statsService');

const BATCH_SIZE = 1000;

/**
 * Memeriksa apakah berkas berupa teks Middleware (.txt atau CSV dengan pemisah ||).
 * Hanya mendeteksi sebagai middleware jika:
 *   - Ekstensi .txt, ATAU
 *   - Ekstensi .csv DAN baris pertama menggunakan || sebagai delimiter (bukan sekadar
 *     mengandung || di tengah konten — harus ada minimal 3 kolom yang dipisahkan ||).
 * File .xlsx/.xls selalu ditangani oleh sheetjs dan TIDAK dianggap middleware.
 */
async function checkIsMiddlewareTxt(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();

    // .xlsx dan .xls selalu bukan middleware text
    if (ext === '.xlsx' || ext === '.xls') return false;

    // .txt selalu dianggap middleware
    if (ext === '.txt') return true;

    // Untuk .csv: baca baris pertama dan cek apakah delimiter utamanya adalah ||
    if (ext === '.csv') {
      const stream = fs.createReadStream(filePath, { encoding: 'utf-8', start: 0, end: 2048 });
      let firstChunk = '';
      for await (const chunk of stream) {
        firstChunk += chunk;
        break;
      }
      // Ambil baris pertama saja
      const firstLine = firstChunk.split(/\r?\n/)[0] || '';
      // Hitung jumlah kolom yang terpisahkan oleh ||
      const pipeColumns = firstLine.split('||').length;
      // Harus ada minimal 5 kolom yang dipisah || untuk dianggap middleware
      // (middleware format: bsn||mw_sn||pg_sn||time||... minimal 5 field)
      return pipeColumns >= 5;
    }

    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Preview khusus untuk berkas Middleware Text (.txt)
 */
async function generateMiddlewareTxtPreview(filePath, originalName, fileSize) {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineIndex = 0;
  let hasHeader = false;
  let rawHeaders = MIDDLEWARE_DEFAULT_HEADERS;
  const previewRows = [];

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    const parts = line.split('||').map((p) => p.trim());

    if (lineIndex === 0) {
      // Periksa apakah baris pertama adalah judul kolom
      if (parts[0].toLowerCase().includes('business') || parts[0].toLowerCase().includes('serial')) {
        hasHeader = true;
        rawHeaders = parts;
        lineIndex++;
        continue;
      } else {
        hasHeader = false;
        rawHeaders = MIDDLEWARE_DEFAULT_HEADERS;
      }
    }

    if (previewRows.length < 5) {
      const rowObj = {};
      rawHeaders.forEach((h, idx) => {
        rowObj[h] = parts[idx] || '';
      });
      previewRows.push(rowObj);
    }

    lineIndex++;
  }

  const totalRecords = hasHeader ? lineIndex - 1 : lineIndex;

  return {
    fileName: originalName,
    tempFilePath: filePath,
    fileSize,
    sheets: [
      {
        sheetName: 'Middleware Transactions',
        totalRows: Math.max(0, totalRecords),
        detectedType: 'middleware',
        hasHeader,
        headers: rawHeaders,
        previewRows,
      },
    ],
  };
}

/**
 * Membaca berkas Excel, CSV, atau TXT dan menghasilkan preview ringkas lembar kerja serta 5 baris pertama data.
 */
async function generateExcelPreview(filePath, originalName, fileSize) {
  // 1. Cek apakah file Middleware format teks (||)
  const isMw = await checkIsMiddlewareTxt(filePath);
  if (isMw) {
    return await generateMiddlewareTxtPreview(filePath, originalName, fileSize);
  }

  // 2. Berkas Excel / CSV dengan sheetjs
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetsInfo = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    updateSheetRange(sheet);
    if (!sheet['!ref']) continue;

    const range = xlsx.utils.decode_range(sheet['!ref']);
    const struct = detectSheetStructure(sheet);
    const dataStartRowIdx = struct.dataStartRowIdx;
    const detectedType = struct.sheetType;
    const headers = struct.colMap.map((c) => c.rawHeader);

    // Ambil maksimal 5 baris data untuk preview
    const previewRows = [];
    const maxPreview = Math.min(range.e.r, dataStartRowIdx + 4);

    for (let r = dataStartRowIdx; r <= maxPreview; r++) {
      const rowData = {};
      for (const col of struct.colMap) {
        const cell = sheet[xlsx.utils.encode_cell({ r, c: col.colIdx })];
        const headerName = col.rawHeader;
        let val = cell ? cell.v : '';

        // Format tanggal / waktu untuk preview UI
        const normKey = col.normKey;
        if (normKey.includes('date') || normKey.includes('time') || normKey.includes('created') || normKey.includes('paymentat')) {
          val = parseExcelTimestamp(val) || parseExcelDate(val) || val;
        }
        rowData[headerName] = val;
      }
      previewRows.push(rowData);
    }

    sheetsInfo.push({
      sheetName,
      totalRows: Math.max(0, range.e.r - dataStartRowIdx + 1),
      detectedType,
      headers,
      previewRows,
    });
  }

  return {
    fileName: originalName,
    tempFilePath: filePath,
    fileSize,
    sheets: sheetsInfo,
  };
}

/**
 * Ingestion untuk berkas Middleware Text (pemisah ||)
 */
async function processMiddlewareIngestion(client, tempFilePath, originalName) {
  const fileStream = fs.createReadStream(tempFilePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let lineIndex = 0;
  let hasHeader = false;
  let batch = [];
  let totalInserted = 0;

  for await (const line of rl) {
    if (!line || !line.trim()) continue;
    const parts = line.split('||').map((p) => p.trim());

    if (lineIndex === 0) {
      if (parts[0].toLowerCase().includes('business') || parts[0].toLowerCase().includes('serial')) {
        hasHeader = true;
        lineIndex++;
        continue;
      }
    }

    const bsn = cleanStr(parts[0], 64);
    if (!bsn) continue;

    const rowObj = {
      business_serial_number: bsn,
      middleware_serial_number: cleanStr(parts[1], 64),
      pg_serial_number: cleanStr(parts[2], 100),
      middleware_transaction_time: parseExcelTimestamp(parts[3]),
      pg_transaction_time: parseExcelTimestamp(parts[4]),
      transaction_currency: cleanStr(parts[5], 10) || 'IDR',
      processing_fee: parseNumeric(parts[6], 0),
      transaction_amount: parseNumeric(parts[7], 0),
      settlement_amount: parseNumeric(parts[8], 0),
      payment_gateway: cleanStr(parts[9], 50),
      payment_method: cleanStr(parts[10], 50),
      payment_channel: cleanStr(parts[11], 50),
      ticket_sales_channel: cleanStr(parts[12], 50),
      transaction_type: cleanStr(parts[13], 50),
      payment_bank: cleanStr(parts[14], 100),
      settlement_date: parseExcelTimestamp(parts[15]),
      merchant_name: cleanStr(parts[16], 100),
      merchant_id: cleanStr(parts[17], 100),
      promotion_amount: parseNumeric(parts[18], 0),
      consumer_id: cleanStr(parts[19], 64),
      passenger_name: cleanStr(parts[20], 255),
      himbara_fee: parseNumeric(parts[21], 0),
      additional_vat: parseNumeric(parts[22], 0),
      source_file: path.basename(originalName),
    };

    batch.push(rowObj);
    lineIndex++;

    if (batch.length >= BATCH_SIZE) {
      await insertMiddlewareBatch(client, batch);
      totalInserted += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await insertMiddlewareBatch(client, batch);
    totalInserted += batch.length;
  }

  return totalInserted;
}

async function insertMiddlewareBatch(client, batch) {
  const fields = [...MIDDLEWARE_DB_FIELDS, 'source_file'];
  const values = [];
  const placeholders = [];

  batch.forEach((row) => {
    const rowPlaceholders = [];
    fields.forEach((f) => {
      values.push(row[f] ?? null);
      rowPlaceholders.push(`$${values.length}`);
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const sql = `
    INSERT INTO middleware_transactions (${fields.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (business_serial_number)
    DO UPDATE SET
      pg_serial_number = EXCLUDED.pg_serial_number,
      settlement_amount = EXCLUDED.settlement_amount,
      payment_gateway = EXCLUDED.payment_gateway,
      payment_method = EXCLUDED.payment_method,
      settlement_date = EXCLUDED.settlement_date,
      passenger_name = EXCLUDED.passenger_name,
      processing_fee = EXCLUDED.processing_fee,
      additional_vat = EXCLUDED.additional_vat,
      source_file = EXCLUDED.source_file
  `;
  await client.query(sql, values);
}

/**
 * Ingestion untuk berkas Xendit CSV
 */
async function insertXenditBatch(client, batch) {
  const fields = [...XENDIT_DB_FIELDS, 'source_file'];
  const values = [];
  const placeholders = [];

  batch.forEach((row) => {
    const rowPlaceholders = [];
    fields.forEach((f) => {
      values.push(row[f] ?? null);
      rowPlaceholders.push(`$${values.length}`);
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const sql = `
    INSERT INTO pg_xendit_settlements (${fields.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (transaction_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      settlement_status = EXCLUDED.settlement_status,
      actual_settlement_time = EXCLUDED.actual_settlement_time,
      net_amount = EXCLUDED.net_amount,
      total_fee = EXCLUDED.total_fee,
      total_vat = EXCLUDED.total_vat,
      source_file = EXCLUDED.source_file
  `;
  await client.query(sql, values);
}

/**
 * Ingestion untuk berkas Finnet Excel
 */
async function insertFinnetBatch(client, batch) {
  const fields = [...FINNET_DB_FIELDS, 'source_file'];
  const values = [];
  const placeholders = [];

  batch.forEach((row) => {
    const rowPlaceholders = [];
    fields.forEach((f) => {
      values.push(row[f] ?? null);
      rowPlaceholders.push(`$${values.length}`);
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const sql = `
    INSERT INTO pg_finnet_settlements (${fields.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (trx_invoice)
    DO UPDATE SET
      payment_status = EXCLUDED.payment_status,
      trx_amount_settle = EXCLUDED.trx_amount_settle,
      ref_no = EXCLUDED.ref_no,
      payment_at_dt = EXCLUDED.payment_at_dt,
      source_file = EXCLUDED.source_file
  `;
  await client.query(sql, values);
}

/**
 * Ingestion untuk berkas Doku QR Excel
 */
async function insertDokuQrBatch(client, batch) {
  const fields = [...DOKU_QR_DB_FIELDS, 'source_file'];
  const values = [];
  const placeholders = [];

  batch.forEach((row) => {
    const rowPlaceholders = [];
    fields.forEach((f) => {
      values.push(row[f] ?? null);
      rowPlaceholders.push(`$${values.length}`);
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const sql = `
    INSERT INTO pg_doku_qr_settlements (${fields.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (transaction_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      reference_number = EXCLUDED.reference_number,
      qris_transaction_id = EXCLUDED.qris_transaction_id,
      source_file = EXCLUDED.source_file
  `;
  await client.query(sql, values);
}

/**
 * Ingestion untuk berkas Doku All CSV
 */
async function insertDokuAllBatch(client, batch) {
  const fields = [...DOKU_ALL_DB_FIELDS, 'source_file'];
  const values = [];
  const placeholders = [];

  batch.forEach((row) => {
    const rowPlaceholders = [];
    fields.forEach((f) => {
      values.push(row[f] ?? null);
      rowPlaceholders.push(`$${values.length}`);
    });
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  });

  const sql = `
    INSERT INTO pg_doku_all_settlements (${fields.join(', ')})
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (invoice_number)
    DO UPDATE SET
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      paid_amount = EXCLUDED.paid_amount,
      payment_method = EXCLUDED.payment_method,
      response_message = EXCLUDED.response_message,
      source_file = EXCLUDED.source_file
  `;
  await client.query(sql, values);
}

/**
 * Memproses dan menginjeksi data Excel / CSV / TXT ke database PostgreSQL dengan batching dan upsert.
 */
async function processExcelIngestion({ tempFilePath, originalName, fileSize, selectedSheets }) {
  const startTime = Date.now();
  const results = {
    fileName: originalName,
    sheetsProcessed: [],
    totalSalesInserted: 0,
    totalRefundInserted: 0,
    totalOccupancyInserted: 0,
    totalMiddlewareInserted: 0,
    totalXenditInserted: 0,
    totalFinnetInserted: 0,
    totalDokuQrInserted: 0,
    totalDokuAllInserted: 0,
    durationMs: 0,
    affectedDates: [],
  };

  const client = await pool.connect();

  try {
    // 1. Cek jika berkas adalah Middleware TXT
    const isMw = await checkIsMiddlewareTxt(tempFilePath);
    console.log(`[Ingestion] File: "${originalName}", ext=${path.extname(tempFilePath).toLowerCase()}, detectedMiddleware=${isMw}`);

    if (isMw) {
      console.log(`Ingesting Middleware text file: ${originalName}...`);
      const insertedCount = await processMiddlewareIngestion(client, tempFilePath, originalName);
      results.totalMiddlewareInserted = insertedCount;
      results.sheetsProcessed.push({
        sheetName: 'Middleware Transactions',
        sheetType: 'middleware',
        totalRows: insertedCount,
        insertedRows: insertedCount,
        distinctDates: [],
      });

      results.durationMs = Date.now() - startTime;

      await logUploadHistory({
        fileName: originalName,
        fileSize: fileSize || 0,
        sheetName: 'Middleware Transactions',
        targetDate: null,
        totalRows: insertedCount,
        insertedRows: insertedCount,
        status: 'success',
        durationMs: results.durationMs,
        sourceType: 'middleware',
        provider: 'middleware',
      });

      return results;
    }

    // 2. Berkas Excel / CSV dengan sheetjs
    const workbook = xlsx.readFile(tempFilePath, { cellDates: false });

    for (const sheetName of workbook.SheetNames) {
      if (selectedSheets && selectedSheets.length > 0 && !selectedSheets.includes(sheetName)) {
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      updateSheetRange(sheet);
      if (!sheet['!ref']) continue;

      const range = xlsx.utils.decode_range(sheet['!ref']);
      const struct = detectSheetStructure(sheet);
      const sheetType = struct.sheetType;
      const colMap = struct.colMap;

      if (sheetType === 'unknown') {
        console.warn(`Skipping sheet "${sheetName}": report type not recognized. Headers: ${struct.colMap.map(c => c.rawHeader).slice(0, 8).join(', ')}`);
        continue;
      }

      console.log(`[Ingestion] Sheet "${sheetName}" detected as: ${sheetType} (${struct.colMap.length} columns, data starts at row ${struct.dataStartRowIdx})`);

      const dataRows = [];
      const distinctDates = new Set();

      // Ekstraksi data baris per baris
      for (let r = struct.dataStartRowIdx; r <= range.e.r; r++) {
        const rowObj = {};
        for (const col of colMap) {
          const cell = sheet[xlsx.utils.encode_cell({ r, c: col.colIdx })];
          rowObj[col.normKey] = cell ? cell.v : null;
        }

        if (sheetType === 'sales') {
          const orderNo = cleanStr(rowObj.orderno, 50);
          const ticketNo = cleanStr(rowObj.ticketno, 50);
          const purchaseDate = parseExcelDate(rowObj.purchasedate);
          if (!orderNo || !ticketNo || !purchaseDate) continue;
          distinctDates.add(purchaseDate);

          dataRows.push({
            seq_no: parseBigInt(rowObj.seqno),
            passenger_name: cleanStr(rowObj.passengername, 150),
            nik_passport_no: cleanStr(rowObj.nikpassportno, 50),
            nationality: cleanStr(rowObj.nationality, 50),
            order_no: orderNo,
            ticket_no: ticketNo,
            ticketing_station: cleanStr(rowObj.ticketingstation, 100),
            business_area: cleanStr(rowObj.businessarea, 100),
            office_no: cleanStr(rowObj.officeno, 50),
            window_no: cleanStr(rowObj.windowno, 50),
            shift_no: cleanStr(rowObj.shiftno, 50),
            operator_name: cleanStr(rowObj.operatorname, 100),
            ticketing_time: parseExcelDate(rowObj.ticketingtime),
            departure_date: parseExcelDate(rowObj.departuredate),
            train_no: cleanStr(rowObj.trainno, 50),
            origin: cleanStr(rowObj.origin, 100),
            cars_number: cleanStr(rowObj.carsnumber, 20),
            seat_number: cleanStr(rowObj.seatnumber, 20),
            origin_code: cleanStr(rowObj.origincode, 20),
            purchase_date: purchaseDate,
            purchase_time: parseExcelTime(rowObj.purchasetime),
            departure_time: parseExcelTime(rowObj.departuretime),
            destination: cleanStr(rowObj.destination, 100),
            destination_code: cleanStr(rowObj.destinationcode, 20),
            arrival_date: parseExcelDate(rowObj.arrivaldate),
            arrival_time: parseExcelTime(rowObj.arrivaltime),
            seat_class: cleanStr(rowObj.seatclass, 50),
            ticket_type: cleanStr(rowObj.tickettype, 50),
            original_ticket_price: parseNumeric(rowObj.originalticketprice, 0),
            discount_type: cleanStr(rowObj.discounttype, 50),
            discount_rate: parseRate(rowObj.discountrate, 1),
            before_tax_price: parseNumeric(rowObj.beforetaxprice, 0),
            tax_rate: parseRate(rowObj.taxrate, 0),
            after_tax_price: parseNumeric(rowObj.aftertaxprice, 0),
            ticketing_channel: cleanStr(rowObj.ticketingchannel, 50),
            payment_method: cleanStr(rowObj.paymentmethod, 50),
            trade_no: cleanStr(rowObj.tradeno, 100),
            plat_trade_no: cleanStr(rowObj.plattradeno, 100),
            payment_gateway: cleanStr(rowObj.paymentgateway, 50),
            b2b_partner: cleanStr(rowObj.b2bpartner, 50),
            add_sales_status_ticket: cleanStr(rowObj.addsalesstatusticket, 100),
          });
        } else if (sheetType === 'refund') {
          const orderNo = cleanStr(rowObj.orderno, 50);
          const ticketNo = cleanStr(rowObj.ticketno, 50);
          const refundDate = parseExcelDate(rowObj.refunddate);
          if (!orderNo || !ticketNo || !refundDate) continue;
          distinctDates.add(refundDate);

          dataRows.push({
            seq_no: parseBigInt(rowObj.seqno),
            refund_date: refundDate,
            cancelation_time: parseExcelTimestamp(rowObj.cancelationtime),
            refund_type: cleanStr(rowObj.refundtype, 100),
            refund_person: cleanStr(rowObj.refundperson, 150),
            refund_charge_rate: parseRate(rowObj.refundchargerate, 0),
            refund_charge: parseNumeric(rowObj.refundcharge, 0),
            refund_amount: parseNumeric(rowObj.refundamount, 0),
            refund_trade_no: cleanStr(rowObj.refundtradeno, 100),
            plat_trade_no: cleanStr(rowObj.plattradeno, 100),
            refund_bank_code: cleanStr(rowObj.refundbankcode, 50),
            refund_bank_name: cleanStr(rowObj.refundbankname, 100),
            refund_method: cleanStr(rowObj.refundmethod, 50),
            refund_state: cleanStr(rowObj.refundstate, 50),
            refund_account: cleanStr(rowObj.refundaccount, 100),
            refund_account_name: cleanStr(rowObj.refundaccountname, 150),
            actual_refund_amount: parseNumeric(rowObj.actualrefundamount, 0),
            passenger_name: cleanStr(rowObj.passengername, 150),
            nik_passport_no: cleanStr(rowObj.nikpassportno, 50),
            nationality: cleanStr(rowObj.nationality, 50),
            order_no: orderNo,
            ticket_no: ticketNo,
            ticketing_station: cleanStr(rowObj.ticketingstation, 100),
            business_area: cleanStr(rowObj.businessarea, 100),
            office_no: cleanStr(rowObj.officeno, 50),
            window_no: cleanStr(rowObj.windowno, 50),
            shift_no: cleanStr(rowObj.shiftno, 50),
            operator_name: cleanStr(rowObj.operatorname, 100),
            ticketing_time: parseExcelDate(rowObj.ticketingtime),
            departure_date: parseExcelDate(rowObj.departuredate),
            train_no: cleanStr(rowObj.trainno, 50),
            origin: cleanStr(rowObj.origin, 100),
            cars_number: cleanStr(rowObj.carsnumber, 20),
            seat_number: cleanStr(rowObj.seatnumber, 20),
            origin_code: cleanStr(rowObj.origincode, 20),
            purchase_date: parseExcelDate(rowObj.purchasedate),
            purchase_time: parseExcelTime(rowObj.purchasetime),
            departure_time: parseExcelTime(rowObj.departuretime),
            destination: cleanStr(rowObj.destination, 100),
            destination_code: cleanStr(rowObj.destinationcode, 20),
            arrival_date: parseExcelDate(rowObj.arrivaldate),
            arrival_time: parseExcelTime(rowObj.arrivaltime),
            seat_class: cleanStr(rowObj.seatclass, 50),
            ticket_type: cleanStr(rowObj.tickettype, 50),
            original_ticket_price: parseNumeric(rowObj.originalticketprice, 0),
            add_refund_status_ticket: cleanStr(rowObj.addrefundstatusticket, 100),
          });
        } else if (sheetType === 'occupancy') {
          const trainNo = cleanStr(rowObj.trainnumber, 50);
          const origin = cleanStr(rowObj.origin, 100);
          const destination = cleanStr(rowObj.destination, 100);
          const trainDate = parseExcelDate(rowObj.traindate);
          const seatClass = cleanStr(rowObj.class, 50);
          if (!trainNo || !origin || !destination || !trainDate || !seatClass) continue;
          distinctDates.add(trainDate);

          dataRows.push({
            train_no: trainNo,
            origin,
            destination,
            train_date: trainDate,
            departure_time: parseExcelTime(rowObj.departure),
            seat_class: seatClass,
            capacity_per_class: parseInt(parseNumeric(rowObj.capacityperclass, 0), 10),
            occupancy_rate: parseRate(rowObj.occupancy, 0),
            sum_passengers: parseInt(parseNumeric(rowObj.sumpsg, 0), 10),
            total_fare: parseNumeric(rowObj.totfare, 0),
            fare: parseNumeric(rowObj.fare, 0),
          });
        } else if (sheetType === 'pg_xendit') {
          const txId = cleanStr(rowObj.transactionid, 64);
          if (!txId) continue;
          dataRows.push({
            transaction_id: txId,
            reference: cleanStr(rowObj.reference, 64),
            status: cleanStr(rowObj.status, 50),
            type: cleanStr(rowObj.type, 50),
            channel: cleanStr(rowObj.channel, 50),
            channel_name: cleanStr(rowObj.channelname, 100),
            account_number: cleanStr(rowObj.accountnumber, 100),
            currency: cleanStr(rowObj.currency, 10) || 'IDR',
            amount: parseNumeric(rowObj.amount, 0),
            net_amount: parseNumeric(rowObj.netamount, 0),
            invoice_id: cleanStr(rowObj.invoiceid, 100),
            batch_id: cleanStr(rowObj.batchid, 100),
            payment_date: parseExcelTimestamp(rowObj.paymentdate),
            created_timestamp: parseExcelTimestamp(rowObj.timestampcreated),
            updated_timestamp: parseExcelTimestamp(rowObj.timestampupdated),
            timezone: cleanStr(rowObj.timezone, 50),
            description: cleanStr(rowObj.description, 500),
            channel_reference: cleanStr(rowObj.channelreference, 100),
            settlement_status: cleanStr(rowObj.settlementstatus, 50),
            actual_settlement_time: parseExcelTimestamp(rowObj.actualsettlementtime),
            estimated_settlement_time: parseExcelTimestamp(rowObj.estimatedsettlementtime),
            product_id: cleanStr(rowObj.productid, 100),
            total_fee: parseNumeric(rowObj.totalfee, 0),
            total_vat: parseNumeric(rowObj.totalvat, 0),
            source_file: path.basename(originalName),
          });
        } else if (sheetType === 'pg_finnet') {
          const inv = cleanStr(rowObj.trxinvoice, 64);
          if (!inv) continue;
          dataRows.push({
            trx_invoice: inv,
            created_at_dt: parseExcelTimestamp(rowObj.createdat),
            updated_at_dt: parseExcelTimestamp(rowObj.updatedat),
            expired_at_dt: parseExcelTimestamp(rowObj.expiredat),
            payment_at_dt: parseExcelTimestamp(rowObj.paymentat),
            merchant_id: cleanStr(rowObj.merchantid, 100),
            sof_desc: cleanStr(rowObj.sofdesc, 100),
            trx_currency: cleanStr(rowObj.trxcurrency, 10) || 'IDR',
            trx_amount: parseNumeric(rowObj.trxamount, 0),
            trx_amount_payment: parseNumeric(rowObj.trxamountpayment, 0),
            trx_amount_settle: parseNumeric(rowObj.trxamountsettle, 0),
            total_capture_amount: parseNumeric(rowObj.totalcaptureamount, 0),
            trx_desc: cleanStr(rowObj.trxdesc, 500),
            payment_status: cleanStr(rowObj.paymentstatus, 50),
            external_trx_id: cleanStr(rowObj.externaltrxid, 100),
            external_order_id: cleanStr(rowObj.externalorderid, 100),
            external_account_id: cleanStr(rowObj.externalaccountid, 100),
            trigger_by: cleanStr(rowObj.triggerby, 50),
            transaction_mode: cleanStr(rowObj.transactionmode, 50),
            payment_code: cleanStr(rowObj.paymentcode, 100),
            payment_channel: cleanStr(rowObj.paymentchannel, 50),
            ref_no: cleanStr(rowObj.refno, 100),
            meta_data: cleanStr(rowObj.metadata, 1000),
            session_data: cleanStr(rowObj.sessiondata, 1000),
            source_file: path.basename(originalName),
          });
        } else if (sheetType === 'pg_doku_qr') {
          const txId = cleanStr(rowObj.transactionid, 100);
          if (!txId) continue;
          dataRows.push({
            transaction_id: txId,
            qris_transaction_id: cleanStr(rowObj.qristransactionid, 64),
            reference_number: cleanStr(rowObj.referencenumber, 100),
            merchant_name: cleanStr(rowObj.merchantname, 100),
            issuer_name: cleanStr(rowObj.issuername, 100),
            transaction_date: parseExcelTimestamp(rowObj.transactiondate),
            amount: parseNumeric(rowObj.amount, 0),
            status: cleanStr(rowObj.status, 50),
            customer_pan: cleanStr(rowObj.customerpan, 100),
            customer_name: cleanStr(rowObj.customername, 255),
            invoice_acquirer: cleanStr(rowObj.invoiceacquirer, 100),
            invoice_number: cleanStr(rowObj.invoicenumber, 100),
            terminal_id: cleanStr(rowObj.terminalid, 50),
            source_file: path.basename(originalName),
          });
        } else if (sheetType === 'pg_doku_all') {
          const inv = cleanStr(rowObj.invoicenumber, 64);
          if (!inv) continue;
          dataRows.push({
            invoice_number: inv,
            transaction_date: parseExcelTimestamp(rowObj.date),
            amount: parseNumeric(rowObj.amount, 0),
            payment_method: cleanStr(rowObj.paymentmethod, 100),
            status: cleanStr(rowObj.status, 50),
            activity: cleanStr(rowObj.activity, 50),
            payment_type: cleanStr(rowObj.paymenttype, 100),
            customer_name: cleanStr(rowObj.customername, 255),
            customer_email: cleanStr(rowObj.customeremail, 255),
            brand_id: cleanStr(rowObj.brandid, 100),
            acquirer_name: cleanStr(rowObj.acquirername, 100),
            mid: cleanStr(rowObj.mid, 100),
            tid: cleanStr(rowObj.tid, 100),
            tenor: cleanStr(rowObj.tenor, 50),
            issuing_bank: cleanStr(rowObj.issuingbank, 100),
            approval_code: cleanStr(rowObj.approvalcode, 100),
            order_number: cleanStr(rowObj.ordernumber, 100),
            card_masked: cleanStr(rowObj.cardmasked, 50),
            bank_batch_number: cleanStr(rowObj.bankbatchnumber, 100),
            bank_settlement_date: cleanStr(rowObj.banksettlementdate, 100),
            payment_number: cleanStr(rowObj.paymentnumber, 100),
            response_code: cleanStr(rowObj.responsecode, 50),
            response_message: cleanStr(rowObj.responsemessage, 255),
            additional_info: cleanStr(rowObj.additionalinfo, 4000),
            request_id: cleanStr(rowObj.requestid, 100),
            card_expiry_date: cleanStr(rowObj.cardexpirydate, 50),
            billing_number: cleanStr(rowObj.billingnumber, 100),
            brand_name: cleanStr(rowObj.brandname, 100),
            promo_code: cleanStr(rowObj.promocode, 100),
            total_amount: parseNumeric(rowObj.totalamount, 0),
            discount_amount: parseNumeric(rowObj.discountamount, 0),
            paid_amount: parseNumeric(rowObj.paidamount, 0),
            card_holder_name: cleanStr(rowObj.cardholdername, 255),
            reference_number: cleanStr(rowObj.referencenumber, 100),
            cashback_amount: parseNumeric(rowObj.cashbackamount, 0),
            source_file: path.basename(originalName),
          });
        }
      }

      console.log(`Sheet "${sheetName}" (${sheetType}): Ingesting ${dataRows.length} records...`);

      // Injeksi dalam batch
      let insertedCount = 0;
      for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
        const batch = dataRows.slice(i, i + BATCH_SIZE);

        if (sheetType === 'sales') {
          const fields = SALES_DB_FIELDS;
          const values = [];
          const placeholders = [];
          batch.forEach((row) => {
            const rowPlaceholders = [];
            fields.forEach((f) => {
              values.push(row[f]);
              rowPlaceholders.push(`$${values.length}`);
            });
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
          });
          const sql = `
            INSERT INTO hrts_sales (${fields.join(', ')})
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (order_no, ticket_no, purchase_date)
            DO UPDATE SET
              passenger_name = EXCLUDED.passenger_name,
              after_tax_price = EXCLUDED.after_tax_price,
              payment_method = EXCLUDED.payment_method,
              payment_gateway = EXCLUDED.payment_gateway,
              ticketing_channel = EXCLUDED.ticketing_channel,
              add_sales_status_ticket = EXCLUDED.add_sales_status_ticket
          `;
          await client.query(sql, values);
          insertedCount += batch.length;
        } else if (sheetType === 'refund') {
          const fields = REFUND_DB_FIELDS;
          const values = [];
          const placeholders = [];
          batch.forEach((row) => {
            const rowPlaceholders = [];
            fields.forEach((f) => {
              values.push(row[f]);
              rowPlaceholders.push(`$${values.length}`);
            });
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
          });
          const sql = `
            INSERT INTO hrts_refund (${fields.join(', ')})
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (order_no, ticket_no, refund_date)
            DO UPDATE SET
              refund_charge = EXCLUDED.refund_charge,
              actual_refund_amount = EXCLUDED.actual_refund_amount,
              refund_state = EXCLUDED.refund_state,
              refund_method = EXCLUDED.refund_method,
              add_refund_status_ticket = EXCLUDED.add_refund_status_ticket
          `;
          await client.query(sql, values);
          insertedCount += batch.length;
        } else if (sheetType === 'occupancy') {
          const fields = OCCUPANCY_DB_FIELDS;
          const values = [];
          const placeholders = [];
          batch.forEach((row) => {
            const rowPlaceholders = [];
            fields.forEach((f) => {
              values.push(row[f]);
              rowPlaceholders.push(`$${values.length}`);
            });
            placeholders.push(`(${rowPlaceholders.join(', ')})`);
          });
          const sql = `
            INSERT INTO hrts_occupancy (${fields.join(', ')})
            VALUES ${placeholders.join(', ')}
            ON CONFLICT (train_no, train_date, origin, destination, seat_class)
            DO UPDATE SET
              departure_time = EXCLUDED.departure_time,
              capacity_per_class = EXCLUDED.capacity_per_class,
              occupancy_rate = EXCLUDED.occupancy_rate,
              sum_passengers = EXCLUDED.sum_passengers,
              total_fare = EXCLUDED.total_fare,
              fare = EXCLUDED.fare,
              updated_at = CURRENT_TIMESTAMP
          `;
          await client.query(sql, values);
          insertedCount += batch.length;
        } else if (sheetType === 'pg_xendit') {
          await insertXenditBatch(client, batch);
          insertedCount += batch.length;
        } else if (sheetType === 'pg_finnet') {
          await insertFinnetBatch(client, batch);
          insertedCount += batch.length;
        } else if (sheetType === 'pg_doku_qr') {
          await insertDokuQrBatch(client, batch);
          insertedCount += batch.length;
        } else if (sheetType === 'pg_doku_all') {
          await insertDokuAllBatch(client, batch);
          insertedCount += batch.length;
        }
      }

      // Sinkronisasi Data Mart Harian jika ada sales/refund/occupancy
      for (const d of distinctDates) {
        results.affectedDates.push(d);
        try {
          await client.query('CALL sp_refresh_daily_summary($1)', [d]);
        } catch (procErr) {
          console.error(`Failed to refresh summary for date ${d}:`, procErr.message);
        }
      }

      results.sheetsProcessed.push({
        sheetName,
        sheetType,
        totalRows: dataRows.length,
        insertedRows: insertedCount,
        distinctDates: Array.from(distinctDates),
      });

      if (sheetType === 'sales') results.totalSalesInserted += insertedCount;
      if (sheetType === 'refund') results.totalRefundInserted += insertedCount;
      if (sheetType === 'occupancy') results.totalOccupancyInserted += insertedCount;
      if (sheetType === 'pg_xendit') results.totalXenditInserted += insertedCount;
      if (sheetType === 'pg_finnet') results.totalFinnetInserted += insertedCount;
      if (sheetType === 'pg_doku_qr') results.totalDokuQrInserted += insertedCount;
      if (sheetType === 'pg_doku_all') results.totalDokuAllInserted += insertedCount;
    }

    results.durationMs = Date.now() - startTime;
    const totalAllInserted =
      results.totalSalesInserted +
      results.totalRefundInserted +
      results.totalOccupancyInserted +
      results.totalXenditInserted +
      results.totalFinnetInserted +
      results.totalDokuQrInserted +
      results.totalDokuAllInserted;

    // Jika tidak ada sheet yang berhasil diproses, lempar error deskriptif
    if (results.sheetsProcessed.length === 0) {
      const sheetNames = workbook.SheetNames.join(', ');
      throw new Error(
        `No recognizable data structure found in file "${originalName}". ` +
        `Sheets scanned: [${sheetNames}]. ` +
        `Supported structures: Sales, Refund, Occupancy, Xendit, Finnet, Doku QR, Doku All. ` +
        `Please verify the file format and column headers.`
      );
    }

    if (totalAllInserted === 0) {
      console.warn(`[Ingestion] File "${originalName}" processed ${results.sheetsProcessed.length} sheets but 0 records were inserted.`);
    }

    // Tentukan kategori dan provider untuk audit history
    let primarySourceType = 'hrts';
    let primaryProvider = 'ticketing';

    if (results.sheetsProcessed.length > 0) {
      const firstType = results.sheetsProcessed[0].sheetType;
      if (firstType.startsWith('pg_')) {
        primarySourceType = 'payment_gateway';
        primaryProvider = firstType.replace('pg_', '');
      } else if (firstType === 'middleware') {
        primarySourceType = 'middleware';
        primaryProvider = 'middleware';
      } else {
        primarySourceType = 'hrts';
        primaryProvider = firstType;
      }
    }

    await logUploadHistory({
      fileName: originalName,
      fileSize: fileSize || 0,
      sheetName: results.sheetsProcessed.map((s) => s.sheetName).join(', '),
      targetDate: results.affectedDates[0] || null,
      totalRows: totalAllInserted,
      insertedRows: totalAllInserted,
      status: 'success',
      durationMs: results.durationMs,
      sourceType: primarySourceType,
      provider: primaryProvider,
    });

    invalidateStatsCache();

    return results;
  } catch (err) {
    console.error('Error during batch ingestion:', err);
    try {
      await logUploadHistory({
        fileName: originalName,
        fileSize: fileSize || 0,
        status: 'failed',
        errorMessage: err.message,
        durationMs: Date.now() - startTime,
      });
    } catch (_) {}

    throw err;
  } finally {
    client.release();
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_) {}
    }
  }
}

module.exports = {
  generateExcelPreview,
  processExcelIngestion,
};
