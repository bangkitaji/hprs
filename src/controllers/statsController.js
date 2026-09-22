const statsService = require('../services/statsService');

/**
 * Controller untuk endpoint GET /api/stats
 */
async function getStats(req, res, next) {
  try {
    const stats = await statsService.getSystemStats();
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getStats,
};
