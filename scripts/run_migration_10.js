require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');

async function run() {
  console.log('Running Migration 10: Middleware & Payment Gateway Tables...');
  const sqlFile = path.resolve(__dirname, '../database/10_create_middleware_and_pg_tables.sql');
  const sql = fs.readFileSync(sqlFile, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('✅ Migration 10 applied successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

run();

