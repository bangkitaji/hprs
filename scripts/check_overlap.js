const { pool } = require('../src/config/database');

async function checkOverlap() {
  const mwRefs = await pool.query(`SELECT business_serial_number FROM middleware_transactions LIMIT 20`);
  console.log('Sample MW refs:', mwRefs.rows.map(r => r.business_serial_number));

  const xRefs = await pool.query(`SELECT reference FROM pg_xendit_settlements LIMIT 20`);
  console.log('Sample Xendit refs:', xRefs.rows.map(r => r.reference));

  const finRefs = await pool.query(`SELECT trx_invoice FROM pg_finnet_settlements LIMIT 20`);
  console.log('Sample Finnet refs:', finRefs.rows.map(r => r.trx_invoice));

  // Check overlap between MW and Xendit / Finnet
  const mwVsXendit = await pool.query(`
    SELECT count(*) 
    FROM middleware_transactions m
    JOIN pg_xendit_settlements x ON m.business_serial_number = x.reference
  `);
  console.log('Overlap MW vs Xendit:', mwVsXendit.rows[0]);

  const mwVsFinnet = await pool.query(`
    SELECT count(*) 
    FROM middleware_transactions m
    JOIN pg_finnet_settlements f ON m.business_serial_number = f.trx_invoice
  `);
  console.log('Overlap MW vs Finnet:', mwVsFinnet.rows[0]);

  // Check sample hrts_sales plat_trade_no
  const hrtsRefs = await pool.query(`
    SELECT plat_trade_no, purchase_date 
    FROM hrts_sales 
    WHERE plat_trade_no IS NOT NULL AND plat_trade_no != '' 
    ORDER BY purchase_date DESC 
    LIMIT 10
  `);
  console.log('Sample latest HRTS plat_trade_no:', hrtsRefs.rows);

  await pool.end();
}

checkOverlap();

