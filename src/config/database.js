const { Pool } = require('pg');

/**
 * Konfigurasi Connection Pool PostgreSQL
 * Nilai kredensial dimuat secara aman melalui Environment Variables (.env)
 */
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'hpr_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'Sukma@123098!@',
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

if (process.env.DB_SSL === 'true') {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
