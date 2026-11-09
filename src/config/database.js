const { Pool } = require('pg');
const { loadEnvironmentConfig } = require('./envLoader');

// Muat variabel lingkungan secara andal
const { dbConfig } = loadEnvironmentConfig();

/**
 * Konfigurasi Connection Pool PostgreSQL
 * Nilai kredensial dimuat secara aman melalui Environment Variables (.env)
 */
const poolConfig = {
  host: dbConfig.host,
  port: dbConfig.port,
  database: dbConfig.database,
  user: dbConfig.user,
  password: dbConfig.password,
  max: parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

if (dbConfig.ssl) {
  poolConfig.ssl = { rejectUnauthorized: false };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
});

module.exports = {
  pool,
  dbConfig,
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
};
