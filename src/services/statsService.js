const { pool } = require('../config/database');

let cachedStats = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 30 * 1000; // 30 detik

/**
 * Mengambil perkiraan cepat jumlah baris tabel partisi dari metadata PostgreSQL
 */
async function getFastRowCount(tableName) {
  try {
    const res = await pool.query(`
      SELECT COALESCE(SUM(c.reltuples)::bigint, 0) AS estimated_count
      FROM pg_inherits i
      JOIN pg_class p ON i.inhparent = p.oid
      JOIN pg_class c ON i.inhrelid = c.oid
      WHERE p.relname = $1;
    `, [tableName]);
    const estimated = parseInt(res.rows[0]?.estimated_count || 0, 10);
    if (estimated > 0) return estimated;
  } catch (_) {}

  const countRes = await pool.query(`SELECT count(*) FROM ${tableName}`);
  return parseInt(countRes.rows[0]?.count || 0, 10);
}

/**
 * Service untuk mengambil statistik sistem dan KPI real-time database.
 * Dilengkapi in-memory caching untuk mencegah CPU exhaustion pada tabel multi-juta baris.
 */
async function getSystemStats(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedStats && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedStats;
  }

  const [salesCount, refundCount, occupancyCount, summaryStats, recentHistory] = await Promise.all([
    getFastRowCount('hrts_sales'),
    getFastRowCount('hrts_refund'),
    pool.query('SELECT count(*) FROM hrts_occupancy').catch(() => ({ rows: [{ count: 0 }] })),
    pool.query(`
      SELECT 
        MAX(summary_date) as last_date,
        SUM(total_tickets) as total_tickets_today,
        SUM(total_net_amount) as total_revenue_today
      FROM hrts_daily_sales_summary
      WHERE summary_date = (SELECT MAX(summary_date) FROM hrts_daily_sales_summary)
    `),
    pool.query('SELECT * FROM upload_history ORDER BY id DESC LIMIT 5'),
  ]);

  cachedStats = {
    total_sales: salesCount,
    total_refund: refundCount,
    total_occupancy: parseInt(occupancyCount.rows[0]?.count || 0, 10),
    latest_summary: summaryStats.rows[0] || null,
    recent_history: recentHistory.rows,
  };
  lastCacheTime = now;

  return cachedStats;
}

function invalidateStatsCache() {
  cachedStats = null;
  lastCacheTime = 0;
}

module.exports = {
  getSystemStats,
  invalidateStatsCache,
};
