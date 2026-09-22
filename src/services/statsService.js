const { pool } = require('../config/database');

/**
 * Service untuk mengambil statistik sistem dan KPI real-time database.
 */
async function getSystemStats() {
  const [salesCount, refundCount, occupancyCount, summaryStats, recentHistory] = await Promise.all([
    pool.query('SELECT count(*) FROM hrts_sales'),
    pool.query('SELECT count(*) FROM hrts_refund'),
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

  return {
    total_sales: parseInt(salesCount.rows[0]?.count || 0, 10),
    total_refund: parseInt(refundCount.rows[0]?.count || 0, 10),
    total_occupancy: parseInt(occupancyCount.rows[0]?.count || 0, 10),
    latest_summary: summaryStats.rows[0] || null,
    recent_history: recentHistory.rows,
  };
}

module.exports = {
  getSystemStats,
};
