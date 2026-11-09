const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function runMigration11() {
  const sqlPath = path.join(__dirname, '..', 'database', '11_create_reconciliation_tables.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running 11_create_reconciliation_tables.sql...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Migration 11 completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration 11 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration11();

