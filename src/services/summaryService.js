const { pool } = require('../config/database');

/**
 * Service untuk menyajikan data agregat data mart (sales & occupancy) untuk grafik & laporan dashboard.
 */
async function getSummaryReport(startDate, endDate) {
  let filterClause = '';
  const params = [];

  if (startDate && endDate) {
    params.push(startDate, endDate);
    filterClause = 'WHERE summary_date >= $1 AND summary_date <= $2';
  } else {
    // Default: 30 hari terakhir
    filterClause = `WHERE summary_date >= (SELECT MAX(summary_date) - INTERVAL '30 days' FROM hrts_daily_sales_summary)`;
  }

  const [dailyTrends, stationBreakdown, paymentBreakdown, occupancySummary] = await Promise.all([
    pool.query(`
      SELECT 
        to_char(summary_date, 'YYYY-MM-DD') as date,
        SUM(total_tickets) as tickets,
        SUM(total_gross_amount) as gross_revenue,
        SUM(total_net_amount) as net_revenue
      FROM hrts_daily_sales_summary
      ${filterClause}
      GROUP BY summary_date
      ORDER BY summary_date ASC
    `, params),

    pool.query(`
      SELECT 
        COALESCE(NULLIF(ticketing_station, ''), 'Online/Lainnya') as station,
        SUM(total_tickets) as tickets,
        SUM(total_net_amount) as revenue
      FROM hrts_daily_sales_summary
      ${filterClause}
      GROUP BY ticketing_station
      ORDER BY revenue DESC
      LIMIT 6
    `, params),

    pool.query(`
      SELECT 
        COALESCE(NULLIF(payment_gateway, ''), NULLIF(ticketing_channel, ''), 'Lainnya') as channel,
        SUM(total_tickets) as tickets,
        SUM(total_net_amount) as revenue
      FROM hrts_daily_sales_summary
      ${filterClause}
      GROUP BY 1
      ORDER BY revenue DESC
      LIMIT 6
    `, params),

    pool.query(`
      SELECT 
        to_char(summary_date, 'YYYY-MM-DD') as date,
        SUM(total_capacity) as total_capacity,
        SUM(total_passengers) as total_passengers,
        ROUND(AVG(avg_occupancy_rate) * 100, 1) as avg_occupancy_pct,
        SUM(total_fare) as total_fare
      FROM hrts_daily_occupancy_summary
      ${filterClause}
      GROUP BY summary_date
      ORDER BY summary_date ASC
    `, params).catch(() => ({ rows: [] })),
  ]);

  return {
    dailyTrends: dailyTrends.rows,
    stationBreakdown: stationBreakdown.rows,
    paymentBreakdown: paymentBreakdown.rows,
    occupancySummary: occupancySummary.rows,
  };
}

module.exports = {
  getSummaryReport,
};
