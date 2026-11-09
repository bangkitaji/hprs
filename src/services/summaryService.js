const { pool } = require('../config/database');

/**
 * Service untuk menyajikan data agregat data mart (sales, occupancy, middleware, dan payment gateways).
 */
async function getSummaryReport(startDate, endDate) {
  let salesFilterClause = '';
  const salesParams = [];

  let dateStart = startDate;
  let dateEnd = endDate;

  if (startDate && endDate) {
    salesParams.push(startDate, endDate);
    salesFilterClause = 'WHERE summary_date >= $1 AND summary_date <= $2';
  } else {
    // Default: 60 hari terakhir dari data sales terbaru
    salesFilterClause = `WHERE summary_date >= (SELECT MAX(summary_date) - INTERVAL '60 days' FROM hrts_daily_sales_summary)`;
  }

  // 1. Ticketing Data Mart Queries
  const [dailyTrends, stationBreakdown, paymentBreakdown, occupancySummary] = await Promise.all([
    pool.query(`
      SELECT 
        to_char(summary_date, 'YYYY-MM-DD') as date,
        SUM(total_tickets) as tickets,
        SUM(total_gross_amount) as gross_revenue,
        SUM(total_net_amount) as net_revenue
      FROM hrts_daily_sales_summary
      ${salesFilterClause}
      GROUP BY summary_date
      ORDER BY summary_date ASC
    `, salesParams),

    pool.query(`
      SELECT 
        COALESCE(NULLIF(ticketing_station, ''), 'Online/Lainnya') as station,
        SUM(total_tickets) as tickets,
        SUM(total_net_amount) as revenue
      FROM hrts_daily_sales_summary
      ${salesFilterClause}
      GROUP BY ticketing_station
      ORDER BY revenue DESC
      LIMIT 6
    `, salesParams),

    pool.query(`
      SELECT 
        COALESCE(NULLIF(payment_gateway, ''), NULLIF(ticketing_channel, ''), 'Lainnya') as channel,
        SUM(total_tickets) as tickets,
        SUM(total_net_amount) as revenue
      FROM hrts_daily_sales_summary
      ${salesFilterClause}
      GROUP BY 1
      ORDER BY revenue DESC
      LIMIT 6
    `, salesParams),

    pool.query(`
      SELECT 
        to_char(summary_date, 'YYYY-MM-DD') as date,
        SUM(total_capacity) as total_capacity,
        SUM(total_passengers) as total_passengers,
        ROUND(AVG(avg_occupancy_rate) * 100, 1) as avg_occupancy_pct,
        SUM(total_fare) as total_fare
      FROM hrts_daily_occupancy_summary
      ${salesFilterClause}
      GROUP BY summary_date
      ORDER BY summary_date ASC
    `, salesParams).catch(() => ({ rows: [] })),
  ]);

  // 2. Payment Gateway & Middleware Queries
  // Filter tanggal untuk Payment Gateways & Middleware
  let pgFilterClauseXendit = '';
  let pgFilterClauseFinnet = '';
  let pgFilterClauseDokuQr = '';
  let pgFilterClauseDokuAll = '';
  let pgFilterClauseMw = '';
  const pgParams = [];

  if (dateStart && dateEnd) {
    pgParams.push(dateStart, dateEnd);
    pgFilterClauseXendit = `WHERE payment_date >= $1::timestamp AND payment_date <= ($2 || ' 23:59:59')::timestamp`;
    pgFilterClauseFinnet = `WHERE payment_at_dt >= $1::timestamp AND payment_at_dt <= ($2 || ' 23:59:59')::timestamp`;
    pgFilterClauseDokuQr = `WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp`;
    pgFilterClauseDokuAll = `WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp`;
    pgFilterClauseMw = `WHERE middleware_transaction_time >= $1::timestamp AND middleware_transaction_time <= ($2 || ' 23:59:59')::timestamp`;
  }

  const [xenditRes, finnetRes, dokuQrRes, dokuAllRes, mwRes] = await Promise.all([
    pool.query(`
      SELECT 
        'Xendit' as provider,
        'Virtual Account & Disbursement' as channel_desc,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        COALESCE(SUM(total_fee + total_vat), 0)::numeric as fee_amount,
        COALESCE(SUM(net_amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE settlement_status = 'SETTLED')::int as settled_count,
        COUNT(*) FILTER (WHERE settlement_status != 'SETTLED' OR settlement_status IS NULL)::int as pending_count
      FROM pg_xendit_settlements
      ${pgFilterClauseXendit}
    `, pgParams).catch(() => ({ rows: [{ provider: 'Xendit', count: 0, gross_amount: 0, fee_amount: 0, net_amount: 0, settled_count: 0, pending_count: 0 }] })),

    pool.query(`
      SELECT 
        'Finnet' as provider,
        'CC / Debit & Finpay' as channel_desc,
        COUNT(*)::int as count,
        COALESCE(SUM(trx_amount), 0)::numeric as gross_amount,
        COALESCE(SUM(trx_amount - trx_amount_settle), 0)::numeric as fee_amount,
        COALESCE(SUM(trx_amount_settle), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE payment_status IN ('CAPTURED', 'PAID'))::int as settled_count,
        COUNT(*) FILTER (WHERE payment_status NOT IN ('CAPTURED', 'PAID') OR payment_status IS NULL)::int as pending_count
      FROM pg_finnet_settlements
      ${pgFilterClauseFinnet}
    `, pgParams).catch(() => ({ rows: [{ provider: 'Finnet', count: 0, gross_amount: 0, fee_amount: 0, net_amount: 0, settled_count: 0, pending_count: 0 }] })),

    pool.query(`
      SELECT 
        'Doku QR' as provider,
        'QRIS Aggregator' as channel_desc,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        0::numeric as fee_amount,
        COALESCE(SUM(amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE status = 'Success')::int as settled_count,
        COUNT(*) FILTER (WHERE status != 'Success' OR status IS NULL)::int as pending_count
      FROM pg_doku_qr_settlements
      ${pgFilterClauseDokuQr}
    `, pgParams).catch(() => ({ rows: [{ provider: 'Doku QR', count: 0, gross_amount: 0, fee_amount: 0, net_amount: 0, settled_count: 0, pending_count: 0 }] })),

    pool.query(`
      SELECT 
        'Doku All' as provider,
        'All Channels (VA, CC, QR)' as channel_desc,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        0::numeric as fee_amount,
        COALESCE(SUM(amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE status IN ('SUCCESS', 'Payment'))::int as settled_count,
        COUNT(*) FILTER (WHERE status NOT IN ('SUCCESS', 'Payment') OR status IS NULL)::int as pending_count
      FROM pg_doku_all_settlements
      ${pgFilterClauseDokuAll}
    `, pgParams).catch(() => ({ rows: [{ provider: 'Doku All', count: 0, gross_amount: 0, fee_amount: 0, net_amount: 0, settled_count: 0, pending_count: 0 }] })),

    pool.query(`
      SELECT 
        'Middleware' as provider,
        'Transaction Logging Service' as channel_desc,
        COUNT(*)::int as count,
        COALESCE(SUM(transaction_amount), 0)::numeric as gross_amount,
        COALESCE(SUM(processing_fee + additional_vat), 0)::numeric as fee_amount,
        COALESCE(SUM(settlement_amount), 0)::numeric as net_amount,
        COUNT(*)::int as settled_count,
        0::int as pending_count
      FROM middleware_transactions
      ${pgFilterClauseMw}
    `, pgParams).catch(() => ({ rows: [{ provider: 'Middleware', count: 0, gross_amount: 0, fee_amount: 0, net_amount: 0, settled_count: 0, pending_count: 0 }] })),
  ]);

  const xData = xenditRes.rows[0];
  const fData = finnetRes.rows[0];
  const qrData = dokuQrRes.rows[0];
  const allData = dokuAllRes.rows[0];
  const mwData = mwRes.rows[0];

  const pgProviders = [xData, fData, qrData, allData];

  let totalPgGross = 0;
  let totalPgNet = 0;
  let totalPgFee = 0;
  let totalPgCount = 0;
  let totalPgSettledCount = 0;

  pgProviders.forEach((p) => {
    totalPgGross += parseFloat(p.gross_amount || 0);
    totalPgNet += parseFloat(p.net_amount || 0);
    totalPgFee += parseFloat(p.fee_amount || 0);
    totalPgCount += parseInt(p.count || 0, 10);
    totalPgSettledCount += parseInt(p.settled_count || 0, 10);
  });

  const gatewaySummary = {
    providers: pgProviders,
    middleware: mwData,
    totalGrossAmount: totalPgGross,
    totalNetAmount: totalPgNet,
    totalFeeAmount: totalPgFee,
    totalTransactions: totalPgCount,
    totalSettledTransactions: totalPgSettledCount,
  };

  return {
    dailyTrends: dailyTrends.rows,
    stationBreakdown: stationBreakdown.rows,
    paymentBreakdown: paymentBreakdown.rows,
    occupancySummary: occupancySummary.rows,
    gatewaySummary,
  };
}

module.exports = {
  getSummaryReport,
};
