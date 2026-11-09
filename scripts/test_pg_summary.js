const { pool } = require('../src/config/database');

async function testPgQuery() {
  const s = '2026-10-01';
  const e = '2026-10-31';

  const [xendit, finnet, dokuQr, dokuAll, mw] = await Promise.all([
    pool.query(`
      SELECT 
        'Xendit' as provider,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        COALESCE(SUM(total_fee + total_vat), 0)::numeric as fee_amount,
        COALESCE(SUM(net_amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE settlement_status = 'SETTLED')::int as settled_count,
        COUNT(*) FILTER (WHERE settlement_status != 'SETTLED' OR settlement_status IS NULL)::int as pending_count
      FROM pg_xendit_settlements
      WHERE payment_date >= $1::timestamp AND payment_date <= ($2 || ' 23:59:59')::timestamp
    `, [s, e]),

    pool.query(`
      SELECT 
        'Finnet' as provider,
        COUNT(*)::int as count,
        COALESCE(SUM(trx_amount), 0)::numeric as gross_amount,
        COALESCE(SUM(trx_amount - trx_amount_settle), 0)::numeric as fee_amount,
        COALESCE(SUM(trx_amount_settle), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE payment_status IN ('CAPTURED', 'PAID'))::int as settled_count,
        COUNT(*) FILTER (WHERE payment_status NOT IN ('CAPTURED', 'PAID') OR payment_status IS NULL)::int as pending_count
      FROM pg_finnet_settlements
      WHERE payment_at_dt >= $1::timestamp AND payment_at_dt <= ($2 || ' 23:59:59')::timestamp
    `, [s, e]),

    pool.query(`
      SELECT 
        'Doku QR' as provider,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        0::numeric as fee_amount,
        COALESCE(SUM(amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE status = 'Success')::int as settled_count,
        COUNT(*) FILTER (WHERE status != 'Success' OR status IS NULL)::int as pending_count
      FROM pg_doku_qr_settlements
      WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp
    `, [s, e]),

    pool.query(`
      SELECT 
        'Doku All' as provider,
        COUNT(*)::int as count,
        COALESCE(SUM(amount), 0)::numeric as gross_amount,
        0::numeric as fee_amount,
        COALESCE(SUM(amount), 0)::numeric as net_amount,
        COUNT(*) FILTER (WHERE status IN ('SUCCESS', 'Payment'))::int as settled_count,
        COUNT(*) FILTER (WHERE status NOT IN ('SUCCESS', 'Payment') OR status IS NULL)::int as pending_count
      FROM pg_doku_all_settlements
      WHERE transaction_date >= $1::timestamp AND transaction_date <= ($2 || ' 23:59:59')::timestamp
    `, [s, e]),

    pool.query(`
      SELECT 
        'Middleware' as provider,
        COUNT(*)::int as count,
        COALESCE(SUM(transaction_amount), 0)::numeric as gross_amount,
        COALESCE(SUM(processing_fee + additional_vat), 0)::numeric as fee_amount,
        COALESCE(SUM(settlement_amount), 0)::numeric as net_amount
      FROM middleware_transactions
      WHERE middleware_transaction_time >= $1::timestamp AND middleware_transaction_time <= ($2 || ' 23:59:59')::timestamp
    `, [s, e]),
  ]);

  console.log('Result:');
  console.log('Xendit:', xendit.rows[0]);
  console.log('Finnet:', finnet.rows[0]);
  console.log('Doku QR:', dokuQr.rows[0]);
  console.log('Doku All:', dokuAll.rows[0]);
  console.log('Middleware:', mw.rows[0]);
  await pool.end();
}

testPgQuery();

