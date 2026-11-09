const { pool } = require('../src/config/database');

async function check() {
  const r1 = await pool.query(`
    SELECT 
      MIN(purchase_date) as min_date, 
      MAX(purchase_date) as max_date, 
      COUNT(*)::int as total 
    FROM hrts_sales
  `);
  console.log('All HRTS Sales:', r1.rows[0]);

  const r2 = await pool.query(`
    SELECT 
      purchase_date, 
      COUNT(*)::int as cnt 
    FROM hrts_sales 
    WHERE purchase_date >= '2026-09-01'
    GROUP BY purchase_date 
    ORDER BY purchase_date DESC 
    LIMIT 10
  `);
  console.log('Latest HRTS Sales dates:', r2.rows);

  // Check some plat_trade_no from Xendit and see if they exist in hrts_sales
  const r3 = await pool.query(`
    SELECT reference FROM pg_xendit_settlements LIMIT 5
  `);
  const refs = r3.rows.map(x => x.reference);
  console.log('Sample Xendit refs:', refs);

  if (refs.length > 0) {
    const r4 = await pool.query(`
      SELECT plat_trade_no, order_no, purchase_date, after_tax_price 
      FROM hrts_sales 
      WHERE plat_trade_no = ANY($1)
    `, [refs]);
    console.log('Matches in hrts_sales:', r4.rows);
  }

  await pool.end();
}

check();

