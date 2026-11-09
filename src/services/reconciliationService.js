const { pool } = require('../config/database');

/**
 * Service Modul Rekonsiliasi Otomatis (Three-Way Reconciliation Hub)
 * Mengintegrasikan data dari:
 * 1. HRTS Ticketing Core
 * 2. Middleware Transaction Logging
 * 3. Payment Gateway Settlements (Xendit, Finnet, Doku QR, Doku All)
 */

/**
 * Menjalankan proses rekonsiliasi otomatis 3-arah untuk rentang tanggal tertentu.
 */
async function runReconciliationBatch({ startDate, endDate, providerFilter = 'ALL', createdBy = 'system' }) {
  const startTime = Date.now();
  const dateStr = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const batchNo = `REC-${dateStr}-${randomSuffix}`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Buat record batch baru dengan status RUNNING
    const batchInsertRes = await client.query(`
      INSERT INTO reconciliation_batches (
        batch_no, start_date, end_date, provider_filter, status, created_by
      ) VALUES ($1, $2, $3, $4, 'RUNNING', $5)
      RETURNING id, batch_no
    `, [batchNo, startDate, endDate, providerFilter, createdBy]);

    const batchId = batchInsertRes.rows[0].id;

    // 2. Query Data dari Layer 1: HRTS Ticketing Core
    const hrtsQuery = `
      SELECT 
        plat_trade_no as ref_id,
        MIN(order_no) as hrts_order_no,
        COUNT(*)::int as hrts_ticket_count,
        MIN(ticketing_station) as hrts_station,
        MIN(payment_gateway) as hrts_gateway,
        MIN(ticketing_channel) as hrts_channel,
        SUM(after_tax_price)::numeric as hrts_amount,
        MIN(purchase_date) as hrts_purchase_date,
        MIN(purchase_date || ' ' || COALESCE(purchase_time::text, '00:00:00'))::timestamp as hrts_trade_time
      FROM hrts_sales
      WHERE purchase_date >= $1 AND purchase_date <= $2
        AND plat_trade_no IS NOT NULL AND plat_trade_no != ''
      GROUP BY plat_trade_no
    `;
    const hrtsRes = await client.query(hrtsQuery, [startDate, endDate]);
    const hrtsMap = new Map();
    hrtsRes.rows.forEach(r => hrtsMap.set(r.ref_id, r));

    // 3. Query Data dari Layer 2: Middleware Transactions
    const mwQuery = `
      SELECT 
        business_serial_number as ref_id,
        middleware_serial_number as mw_order_id,
        COALESCE(payment_gateway, payment_channel) as mw_channel,
        transaction_amount::numeric as mw_amount,
        (processing_fee + additional_vat)::numeric as mw_fee,
        settlement_amount::numeric as mw_settlement_amount,
        middleware_transaction_time as mw_transaction_time,
        middleware_transaction_time::date as mw_date
      FROM middleware_transactions
      WHERE middleware_transaction_time >= $1::timestamp AND middleware_transaction_time <= ($2 || ' 23:59:59')::timestamp
        AND business_serial_number IS NOT NULL AND business_serial_number != ''
    `;
    const mwRes = await client.query(mwQuery, [startDate, endDate]);
    const mwMap = new Map();
    mwRes.rows.forEach(r => mwMap.set(r.ref_id, r));

    // 4. Query Data dari Layer 3: Payment Gateway Settlements
    const pgMap = new Map();
    const addPgRow = (row) => {
      if (row.ref_id && !pgMap.has(row.ref_id)) {
        pgMap.set(row.ref_id, row);
      }
    };

    // 4a. Xendit
    if (providerFilter === 'ALL' || providerFilter.toLowerCase() === 'xendit') {
      const xenditRes = await client.query(`
        SELECT 
          reference as ref_id,
          'Xendit' as provider,
          COALESCE(channel_name, channel, 'Virtual Account') as payment_channel,
          transaction_id as pg_trx_id,
          amount::numeric as pg_gross_amount,
          (total_fee + total_vat)::numeric as pg_fee_amount,
          net_amount::numeric as pg_net_amount,
          settlement_status as pg_settlement_status,
          payment_date as pg_payment_time,
          payment_date::date as pg_date
        FROM pg_xendit_settlements
        WHERE payment_date >= $1::timestamp AND payment_date <= ($2 || ' 23:59:59')::timestamp
          AND reference IS NOT NULL AND reference != ''
      `, [startDate, endDate]);
      for (let i = 0; i < xenditRes.rows.length; i++) {
        addPgRow(xenditRes.rows[i]);
      }
    }

    // 4b. Finnet
    if (providerFilter === 'ALL' || providerFilter.toLowerCase() === 'finnet') {
      const finnetRes = await client.query(`
        SELECT 
          trx_invoice as ref_id,
          'Finnet' as provider,
          COALESCE(payment_channel, sof_desc, 'Finpay') as payment_channel,
          trx_invoice as pg_trx_id,
          trx_amount::numeric as pg_gross_amount,
          (trx_amount - trx_amount_settle)::numeric as pg_fee_amount,
          trx_amount_settle::numeric as pg_net_amount,
          payment_status as pg_settlement_status,
          payment_at_dt as pg_payment_time,
          payment_at_dt::date as pg_date
        FROM pg_finnet_settlements
        WHERE payment_at_dt >= $1::timestamp AND payment_at_dt <= ($2 || ' 23:59:59')::timestamp
          AND trx_invoice IS NOT NULL AND trx_invoice != ''
      `, [startDate, endDate]);
      for (let i = 0; i < finnetRes.rows.length; i++) {
        addPgRow(finnetRes.rows[i]);
      }
    }

    // 4c. Doku QR
    if (providerFilter === 'ALL' || providerFilter.toLowerCase() === 'doku_qr' || providerFilter.toLowerCase() === 'doku qr') {
      const dokuQrRes = await client.query(`
        SELECT 
          COALESCE(NULLIF(qris_transaction_id, ''), transaction_id) as ref_id,
          'Doku QR' as provider,
          COALESCE(issuer_name, 'QRIS') as payment_channel,
          transaction_id as pg_trx_id,
          amount::numeric as pg_gross_amount,
          0::numeric as pg_fee_amount,
          amount::numeric as pg_net_amount,
          status as pg_settlement_status,
          transaction_date as pg_payment_time,
          transaction_date::date as pg_date
        FROM pg_doku_qr_settlements
        WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp
          AND COALESCE(NULLIF(qris_transaction_id, ''), transaction_id) IS NOT NULL
      `, [startDate, endDate]);
      for (let i = 0; i < dokuQrRes.rows.length; i++) {
        addPgRow(dokuQrRes.rows[i]);
      }
    }

    // 4d. Doku All
    if (providerFilter === 'ALL' || providerFilter.toLowerCase() === 'doku_all' || providerFilter.toLowerCase() === 'doku all') {
      const dokuAllRes = await client.query(`
        SELECT 
          invoice_number as ref_id,
          'Doku All' as provider,
          COALESCE(payment_method, payment_type, 'All Channels') as payment_channel,
          invoice_number as pg_trx_id,
          amount::numeric as pg_gross_amount,
          0::numeric as pg_fee_amount,
          amount::numeric as pg_net_amount,
          status as pg_settlement_status,
          transaction_date as pg_payment_time,
          transaction_date::date as pg_date
        FROM pg_doku_all_settlements
        WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp
          AND invoice_number IS NOT NULL AND invoice_number != ''
      `, [startDate, endDate]);
      for (let i = 0; i < dokuAllRes.rows.length; i++) {
        addPgRow(dokuAllRes.rows[i]);
      }
    }

    // 5. Kumpulkan Semua Golden Reference Identifier yang Unik
    const allRefIds = new Set();
    for (const k of hrtsMap.keys()) allRefIds.add(k);
    for (const k of mwMap.keys()) allRefIds.add(k);
    for (const k of pgMap.keys()) allRefIds.add(k);

    // 6. Jalankan Logika Klasifikasi Three-Way Matching
    let totalClean = 0;
    let totalPending = 0;
    let totalUnsettled = 0;
    let totalOrphanPaid = 0;
    let totalAmountMismatch = 0;
    let totalMwOrphan = 0;

    let sumHrts = 0;
    let sumMw = 0;
    let sumPgGross = 0;
    let sumPgNet = 0;
    let sumFee = 0;
    let sumVariance = 0;

    const itemsToInsert = [];

    for (const refId of allRefIds) {
      const hrts = hrtsMap.get(refId) || null;
      const mw = mwMap.get(refId) || null;
      const pg = pgMap.get(refId) || null;

      let status = '';
      const hasHrts = Boolean(hrts);
      const hasMw = Boolean(mw);
      const hasPg = Boolean(pg);

      const hrtsAmt = hrts ? parseFloat(hrts.hrts_amount || 0) : 0;
      const mwAmt = mw ? parseFloat(mw.mw_amount || 0) : 0;
      const mwFeeAmt = mw ? parseFloat(mw.mw_fee || 0) : 0;
      const mwSettleAmt = mw ? parseFloat(mw.mw_settlement_amount || 0) : 0;

      const pgGross = pg ? parseFloat(pg.pg_gross_amount || 0) : 0;
      const pgFee = pg ? parseFloat(pg.pg_fee_amount || 0) : 0;
      const pgNet = pg ? parseFloat(pg.pg_net_amount || 0) : 0;

      const provider = pg?.provider || mw?.mw_channel || hrts?.hrts_gateway || 'Unknown';
      const channel = pg?.payment_channel || mw?.mw_channel || hrts?.hrts_channel || '-';
      const trxDate = pg?.pg_date || mw?.mw_date || hrts?.hrts_purchase_date || startDate;

      sumHrts += hrtsAmt;
      sumMw += mwAmt;
      sumPgGross += pgGross;
      sumPgNet += pgNet;
      sumFee += pgFee > 0 ? pgFee : mwFeeAmt;

      // Hitung selisih nominal (variance)
      let variance = 0;
      if (hasHrts && hasPg) {
        variance = hrtsAmt - pgGross;
      } else if (hasHrts && !hasPg) {
        variance = hrtsAmt;
      } else if (!hasHrts && hasPg) {
        variance = -pgGross;
      }
      sumVariance += Math.abs(variance);

      // Cek Status Kliring PG
      const pgStatusRaw = (pg?.pg_settlement_status || '').toUpperCase();
      const isPgSettled = ['SETTLED', 'CAPTURED', 'PAID', 'SUCCESS'].includes(pgStatusRaw);

      if (hasHrts && hasPg) {
        if (isPgSettled) {
          if (Math.abs(hrtsAmt - pgGross) <= 100) {
            status = 'MATCH_CLEAN';
            totalClean++;
          } else {
            status = 'DISPUTE_AMOUNT_MISMATCH';
            totalAmountMismatch++;
          }
        } else {
          status = 'MATCH_PENDING';
          totalPending++;
        }
      } else if (hasHrts && !hasPg) {
        status = 'DISPUTE_UNSETTLED';
        totalUnsettled++;
      } else if (!hasHrts && hasPg) {
        status = 'DISPUTE_ORPHAN_PAID';
        totalOrphanPaid++;
      } else if (!hasHrts && !hasPg && hasMw) {
        status = 'MW_ORPHAN';
        totalMwOrphan++;
      } else {
        status = 'MW_ORPHAN';
        totalMwOrphan++;
      }

      itemsToInsert.push({
        batchId,
        refId,
        status,
        trxDate,
        provider,
        channel,
        hasHrts,
        hrtsOrderNo: hrts?.hrts_order_no || null,
        hrtsTicketCount: hrts?.hrts_ticket_count || 0,
        hrtsStation: hrts?.hrts_station || null,
        hrtsAmount: hrtsAmt,
        hrtsTradeTime: hrts?.hrts_trade_time || null,
        hasMw,
        mwOrderId: mw?.mw_order_id || null,
        mwChannel: mw?.mw_channel || null,
        mwAmount: mwAmt,
        mwFee: mwFeeAmt,
        mwSettlementAmount: mwSettleAmt,
        mwTransactionTime: mw?.mw_transaction_time || null,
        hasPg,
        pgTrxId: pg?.pg_trx_id || null,
        pgGrossAmount: pgGross,
        pgFeeAmount: pgFee,
        pgNetAmount: pgNet,
        pgSettlementStatus: pg?.pg_settlement_status || null,
        pgPaymentTime: pg?.pg_payment_time || null,
        variance,
      });
    }

    // 7. Bulk Insert Rekonsiliasi Items secara Berkelompok (Chunks)
    const CHUNK_SIZE = 500;
    for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
      const chunk = itemsToInsert.slice(i, i + CHUNK_SIZE);
      const values = [];
      const placeholders = [];

      chunk.forEach((item, idx) => {
        const offset = idx * 24;
        placeholders.push(`(
          $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6},
          $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12},
          $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19},
          $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24}
        )`);

        values.push(
          item.batchId,
          item.refId,
          item.status,
          item.trxDate,
          item.provider,
          item.channel,
          item.hasHrts,
          item.hrtsOrderNo,
          item.hrtsTicketCount,
          item.hrtsStation,
          item.hrtsAmount,
          item.hrtsTradeTime,
          item.hasMw,
          item.mwOrderId,
          item.mwChannel,
          item.mwAmount,
          item.mwFee,
          item.mwSettlementAmount,
          item.mwTransactionTime,
          item.hasPg,
          item.pgTrxId,
          item.pgGrossAmount,
          item.pgFeeAmount,
          item.pgNetAmount
        );
      });

      const insertChunkSql = `
        INSERT INTO reconciliation_items (
          batch_id, golden_reference, recon_status, transaction_date, provider, payment_channel,
          has_hrts, hrts_order_no, hrts_ticket_count, hrts_station, hrts_amount, hrts_trade_time,
          has_middleware, mw_order_id, mw_channel, mw_amount, mw_fee, mw_settlement_amount, mw_transaction_time,
          has_pg, pg_trx_id, pg_gross_amount, pg_fee_amount, pg_net_amount
        ) VALUES ${placeholders.join(', ')}
      `;
      await client.query(insertChunkSql, values);
    }

    const durationMs = Date.now() - startTime;

    // 8. Update Batch Summary dengan Total dan Status COMPLETED
    await client.query(`
      UPDATE reconciliation_batches SET
        total_transactions = $1,
        total_matched_clean = $2,
        total_matched_pending = $3,
        total_dispute_unsettled = $4,
        total_dispute_orphan_paid = $5,
        total_dispute_amount_mismatch = $6,
        total_mw_orphan = $7,
        total_hrts_amount = $8,
        total_mw_amount = $9,
        total_pg_gross_amount = $10,
        total_pg_net_amount = $11,
        total_fee_amount = $12,
        total_variance_amount = $13,
        execution_duration_ms = $14,
        status = 'COMPLETED'
      WHERE id = $15
    `, [
      allRefIds.size,
      totalClean,
      totalPending,
      totalUnsettled,
      totalOrphanPaid,
      totalAmountMismatch,
      totalMwOrphan,
      sumHrts,
      sumMw,
      sumPgGross,
      sumPgNet,
      sumFee,
      sumVariance,
      durationMs,
      batchId
    ]);

    await client.query('COMMIT');

    return {
      batchId,
      batchNo,
      durationMs,
      totalTransactions: allRefIds.size,
      totalClean,
      totalPending,
      totalUnsettled,
      totalOrphanPaid,
      totalAmountMismatch,
      totalMwOrphan,
      sumHrts,
      sumMw,
      sumPgGross,
      sumPgNet,
      sumFee,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mengambil Ringkasan Eksekutif Analitik Rekonsiliasi & Settlement
 */
async function getReconciliationSummary({ batchId, startDate, endDate }) {
  let targetBatchId = batchId;

  // Jika tidak menyertakan batchId, ambil batch terakhir
  if (!targetBatchId) {
    let query = 'SELECT id FROM reconciliation_batches WHERE status = $1';
    const params = ['COMPLETED'];
    if (startDate && endDate) {
      query += ' AND start_date >= $2 AND end_date <= $3';
      params.push(startDate, endDate);
    }
    query += ' ORDER BY created_at DESC LIMIT 1';
    const latestBatchRes = await pool.query(query, params);
    if (latestBatchRes.rows.length > 0) {
      targetBatchId = latestBatchRes.rows[0].id;
    }
  }

  if (!targetBatchId) {
    return {
      hasData: false,
      message: 'No reconciliation batches found for this period. Run a reconciliation batch first.',
      recentBatches: [],
    };
  }

  // 1. Ambil Batch Master Info
  const batchRes = await pool.query(`
    SELECT * FROM reconciliation_batches WHERE id = $1
  `, [targetBatchId]);
  const batch = batchRes.rows[0];

  // 2. Ambil Breakdown Per Status
  const statusRes = await pool.query(`
    SELECT 
      recon_status,
      COUNT(*)::int as count,
      COALESCE(SUM(hrts_amount), 0)::numeric as hrts_amount,
      COALESCE(SUM(pg_gross_amount), 0)::numeric as pg_gross_amount,
      COALESCE(SUM(pg_net_amount), 0)::numeric as pg_net_amount
    FROM reconciliation_items
    WHERE batch_id = $1
    GROUP BY recon_status
    ORDER BY count DESC
  `, [targetBatchId]);

  // 3. Ambil Breakdown Provider (Performa Settlement & Fee)
  const providerRes = await pool.query(`
    SELECT 
      provider,
      COUNT(*)::int as total_trx,
      COUNT(*) FILTER (WHERE recon_status = 'MATCH_CLEAN')::int as clean_trx,
      COUNT(*) FILTER (WHERE recon_status = 'MATCH_PENDING')::int as pending_trx,
      COUNT(*) FILTER (WHERE recon_status LIKE 'DISPUTE%')::int as dispute_trx,
      COALESCE(SUM(pg_gross_amount), 0)::numeric as gross_amount,
      COALESCE(SUM(pg_fee_amount), 0)::numeric as fee_amount,
      COALESCE(SUM(pg_net_amount), 0)::numeric as net_amount,
      CASE 
        WHEN SUM(pg_gross_amount) > 0 THEN ROUND((SUM(pg_fee_amount) / SUM(pg_gross_amount) * 100)::numeric, 2)
        ELSE 0 
      END as effective_fee_pct
    FROM reconciliation_items
    WHERE batch_id = $1
    GROUP BY provider
    ORDER BY total_trx DESC
  `, [targetBatchId]);

  // 4. Ambil Daftar 5 Batch Terakhir untuk Dropdown Pemilih
  const recentBatchesRes = await pool.query(`
    SELECT 
      id, batch_no, start_date, end_date, total_transactions, 
      total_matched_clean, status, created_at
    FROM reconciliation_batches
    ORDER BY created_at DESC
    LIMIT 10
  `);

  return {
    hasData: true,
    batch,
    statusBreakdown: statusRes.rows,
    providerBreakdown: providerRes.rows,
    recentBatches: recentBatchesRes.rows,
  };
}

/**
 * Mengambil Daftar Item Hasil Rekonsiliasi dengan Filter dan Pagination
 */
async function getReconciliationItems({
  batchId,
  reconStatus,
  provider,
  resolutionStatus,
  search,
  page = 1,
  limit = 25,
  sortBy = 'id',
  sortDir = 'DESC'
}) {
  let targetBatchId = batchId;
  if (!targetBatchId) {
    const latest = await pool.query('SELECT id FROM reconciliation_batches WHERE status = $1 ORDER BY created_at DESC LIMIT 1', ['COMPLETED']);
    if (latest.rows.length === 0) return { items: [], total: 0, page, totalPages: 0 };
    targetBatchId = latest.rows[0].id;
  }

  const offset = (page - 1) * limit;
  const conditions = ['batch_id = $1'];
  const params = [targetBatchId];
  let paramIdx = 2;

  if (reconStatus) {
    conditions.push(`recon_status = $${paramIdx}`);
    params.push(reconStatus);
    paramIdx++;
  }

  if (provider && provider !== 'ALL') {
    conditions.push(`provider = $${paramIdx}`);
    params.push(provider);
    paramIdx++;
  }

  if (resolutionStatus) {
    conditions.push(`resolution_status = $${paramIdx}`);
    params.push(resolutionStatus);
    paramIdx++;
  }

  if (search) {
    conditions.push(`(
      golden_reference ILIKE $${paramIdx} OR 
      hrts_order_no ILIKE $${paramIdx} OR 
      mw_order_id ILIKE $${paramIdx} OR 
      pg_trx_id ILIKE $${paramIdx}
    )`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Validasi sort field untuk mencegah SQL injection
  const allowedSortCols = ['id', 'golden_reference', 'recon_status', 'transaction_date', 'provider', 'hrts_amount', 'pg_gross_amount', 'pg_net_amount', 'created_at'];
  const safeSortCol = allowedSortCols.includes(sortBy) ? sortBy : 'id';
  const safeSortDir = sortDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  // Total Count Query
  const countRes = await pool.query(`
    SELECT COUNT(*)::int as total FROM reconciliation_items ${whereClause}
  `, params);
  const total = countRes.rows[0].total;

  // Data Query
  params.push(limit, offset);
  const dataRes = await pool.query(`
    SELECT 
      id, batch_id, golden_reference, recon_status, to_char(transaction_date, 'YYYY-MM-DD') as transaction_date,
      provider, payment_channel,
      has_hrts, hrts_order_no, hrts_ticket_count, hrts_station, hrts_amount,
      has_middleware, mw_order_id, mw_channel, mw_amount, mw_fee, mw_settlement_amount,
      has_pg, pg_trx_id, pg_gross_amount, pg_fee_amount, pg_net_amount, pg_settlement_status,
      amount_variance, resolution_status, resolution_notes, resolved_by, resolved_at, created_at
    FROM reconciliation_items
    ${whereClause}
    ORDER BY ${safeSortCol} ${safeSortDir}
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `, params);

  return {
    items: dataRes.rows,
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Mengambil Rincian Lengkap Sebuah Item (Side-by-Side 3-Way Detail)
 */
async function getReconciliationItemDetail(itemId) {
  const res = await pool.query(`
    SELECT * FROM reconciliation_items WHERE id = $1
  `, [itemId]);
  return res.rows[0] || null;
}

/**
 * Memperbarui Status Resolusi Dispute (Actionable Resolution & Audit Trail)
 */
async function updateItemResolution({ itemId, resolutionStatus, resolutionNotes, user }) {
  const res = await pool.query(`
    UPDATE reconciliation_items SET
      resolution_status = $1,
      resolution_notes = $2,
      resolved_by = $3,
      resolved_at = CURRENT_TIMESTAMP
    WHERE id = $4
    RETURNING id, golden_reference, resolution_status, resolution_notes, resolved_by, resolved_at
  `, [resolutionStatus, resolutionNotes, user, itemId]);

  return res.rows[0] || null;
}

/**
 * Mengambil Data Format CSV untuk Ekspor Laporan Dispute/Rekonsiliasi
 */
async function exportReconciliationItemsCsv({ batchId, reconStatus, provider, resolutionStatus }) {
  let targetBatchId = batchId;
  if (!targetBatchId) {
    const latest = await pool.query('SELECT id FROM reconciliation_batches WHERE status = $1 ORDER BY created_at DESC LIMIT 1', ['COMPLETED']);
    if (latest.rows.length === 0) return '';
    targetBatchId = latest.rows[0].id;
  }

  const conditions = ['batch_id = $1'];
  const params = [targetBatchId];
  let paramIdx = 2;

  if (reconStatus) {
    conditions.push(`recon_status = $${paramIdx}`);
    params.push(reconStatus);
    paramIdx++;
  }

  if (provider && provider !== 'ALL') {
    conditions.push(`provider = $${paramIdx}`);
    params.push(provider);
    paramIdx++;
  }

  if (resolutionStatus) {
    conditions.push(`resolution_status = $${paramIdx}`);
    params.push(resolutionStatus);
    paramIdx++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const res = await pool.query(`
    SELECT 
      golden_reference,
      recon_status,
      to_char(transaction_date, 'YYYY-MM-DD') as trx_date,
      provider,
      payment_channel,
      has_hrts,
      COALESCE(hrts_order_no, '') as hrts_order_no,
      COALESCE(hrts_station, '') as hrts_station,
      hrts_amount,
      has_middleware,
      COALESCE(mw_order_id, '') as mw_order_id,
      mw_amount,
      mw_fee,
      mw_settlement_amount,
      has_pg,
      COALESCE(pg_trx_id, '') as pg_trx_id,
      pg_gross_amount,
      pg_fee_amount,
      pg_net_amount,
      COALESCE(pg_settlement_status, '') as pg_settlement_status,
      amount_variance,
      resolution_status,
      COALESCE(resolution_notes, '') as resolution_notes
    FROM reconciliation_items
    ${whereClause}
    ORDER BY id ASC
  `, params);

  // Buat CSV Header
  const headers = [
    'Golden Reference ID',
    'Recon Status',
    'Date',
    'Provider',
    'Channel',
    'Has HRTS',
    'HRTS Order No',
    'HRTS Station',
    'HRTS Fare Amount (IDR)',
    'Has Middleware',
    'MW Order ID',
    'MW Gross Amount (IDR)',
    'MW Fee (IDR)',
    'MW Settlement (IDR)',
    'Has PG',
    'PG Trx ID',
    'PG Gross Amount (IDR)',
    'PG Fee Amount (IDR)',
    'PG Net Settled (IDR)',
    'PG Status',
    'Variance Amount (IDR)',
    'Resolution Status',
    'Resolution Notes'
  ];

  const rows = res.rows.map(r => [
    `"${r.golden_reference}"`,
    `"${r.recon_status}"`,
    `"${r.trx_date}"`,
    `"${r.provider}"`,
    `"${r.payment_channel}"`,
    r.has_hrts ? 'TRUE' : 'FALSE',
    `"${r.hrts_order_no}"`,
    `"${r.hrts_station}"`,
    r.hrts_amount,
    r.has_middleware ? 'TRUE' : 'FALSE',
    `"${r.mw_order_id}"`,
    r.mw_amount,
    r.mw_fee,
    r.mw_settlement_amount,
    r.has_pg ? 'TRUE' : 'FALSE',
    `"${r.pg_trx_id}"`,
    r.pg_gross_amount,
    r.pg_fee_amount,
    r.pg_net_amount,
    `"${r.pg_settlement_status}"`,
    r.amount_variance,
    `"${r.resolution_status}"`,
    `"${(r.resolution_notes || '').replace(/"/g, '""')}"`
  ].join(','));

  return [headers.join(','), ...rows].join('\r\n');
}

module.exports = {
  runReconciliationBatch,
  getReconciliationSummary,
  getReconciliationItems,
  getReconciliationItemDetail,
  updateItemResolution,
  exportReconciliationItemsCsv,
};
