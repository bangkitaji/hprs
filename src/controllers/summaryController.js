const summaryService = require('../services/summaryService');

/**
 * Controller untuk endpoint GET /api/summary
 */
async function getSummary(req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const summary = await summaryService.getSummaryReport(startDate, endDate);
    res.json(summary);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSummary,
};
