const xlsx = require('xlsx');
const fs = require('fs');
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
} = require('../constants/fieldMaps');
const { logUploadHistory } = require('./historyService');
const { invalidateStatsCache } = require('./statsService');

const BATCH_SIZE = 1000;

/**
 * Membaca berkas Excel dan menghasilkan preview ringkas lembar kerja serta 5 baris pertama data.
 */
async function generateExcelPreview(filePath, originalName, fileSize) {
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
        if (normKey.includes('date')) {
          val = parseExcelDate(val) || val;
        } else if (normKey.includes('time') && !normKey.includes('timestamp')) {
          val = parseExcelTime(val) || val;
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
 * Memproses dan menginjeksi data Excel ke database PostgreSQL dengan batching dan upsert.
 */
async function processExcelIngestion({ tempFilePath, originalName, fileSize, selectedSheets }) {
  const startTime = Date.now();
  const results = {
    fileName: originalName,
    sheetsProcessed: [],
    totalSalesInserted: 0,
    totalRefundInserted: 0,
    totalOccupancyInserted: 0,
    durationMs: 0,
    affectedDates: [],
  };

  const client = await pool.connect();

  try {
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
        console.warn(`Skipping sheet "${sheetName}": report type not recognized.`);
        continue;
      }

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
        }
      }

      // Sinkronisasi Data Mart Harian
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
    }

    results.durationMs = Date.now() - startTime;
    const totalAllInserted = results.totalSalesInserted + results.totalRefundInserted + results.totalOccupancyInserted;

    // Catat log sukses ke upload_history
    await logUploadHistory({
      fileName: originalName,
      fileSize: fileSize || 0,
      sheetName: results.sheetsProcessed.map((s) => s.sheetName).join(', '),
      targetDate: results.affectedDates[0] || null,
      totalRows: totalAllInserted,
      insertedRows: totalAllInserted,
      status: 'success',
      durationMs: results.durationMs,
    });

    invalidateStatsCache();

    return results;
  } catch (err) {
    console.error('Error during batch ingestion:', err);

    // Catat kegagalan ke upload_history
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
    // Pastikan berkas sementara selalu dihapus
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
