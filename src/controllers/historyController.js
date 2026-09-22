const historyService = require('../services/historyService');

/**
 * Controller untuk endpoint GET /api/history
 */
async function getHistory(req, res, next) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const history = await historyService.getUploadHistory({ page, limit });
    res.json(history);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getHistory,
};
