const reconciliationService = require('../services/reconciliationService');

/**
 * Controller untuk Modul Rekonsiliasi Otomatis (Three-Way Reconciliation Hub)
 */

async function runReconciliation(req, res) {
  try {
    const { startDate, endDate, providerFilter } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'startDate and endDate are required fields.',
      });
    }

    const createdBy = req.user?.username || 'administrator';

    const result = await reconciliationService.runReconciliationBatch({
      startDate,
      endDate,
      providerFilter: providerFilter || 'ALL',
      createdBy,
    });

    return res.status(200).json({
      success: true,
      message: `Reconciliation batch ${result.batchNo} completed successfully in ${(result.durationMs / 1000).toFixed(2)}s.`,
      data: result,
    });
  } catch (err) {
    console.error('Error in runReconciliation:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to execute reconciliation batch: ' + err.message,
    });
  }
}

async function getSummary(req, res) {
  try {
    const { batchId, startDate, endDate } = req.query;

    const data = await reconciliationService.getReconciliationSummary({
      batchId: batchId ? parseInt(batchId, 10) : undefined,
      startDate,
      endDate,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    console.error('Error in getSummary:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve reconciliation summary: ' + err.message,
    });
  }
}

async function getItems(req, res) {
  try {
    const {
      batchId,
      reconStatus,
      provider,
      resolutionStatus,
      search,
      page = 1,
      limit = 25,
      sortBy = 'id',
      sortDir = 'DESC',
    } = req.query;

    const result = await reconciliationService.getReconciliationItems({
      batchId: batchId ? parseInt(batchId, 10) : undefined,
      reconStatus,
      provider,
      resolutionStatus,
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 25,
      sortBy,
      sortDir,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('Error in getItems:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve reconciliation items: ' + err.message,
    });
  }
}

async function getItemDetail(req, res) {
  try {
    const { id } = req.params;
    const item = await reconciliationService.getReconciliationItemDetail(parseInt(id, 10));

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Reconciliation item not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: item,
    });
  } catch (err) {
    console.error('Error in getItemDetail:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve item detail: ' + err.message,
    });
  }
}

async function updateResolution(req, res) {
  try {
    const { id } = req.params;
    const { resolutionStatus, resolutionNotes } = req.body;

    if (!resolutionStatus) {
      return res.status(400).json({
        success: false,
        message: 'resolutionStatus is required (RESOLVED, UNRESOLVED, or IGNORED).',
      });
    }

    const user = req.user?.username || 'administrator';

    const updated = await reconciliationService.updateItemResolution({
      itemId: parseInt(id, 10),
      resolutionStatus,
      resolutionNotes: resolutionNotes || '',
      user,
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: 'Item not found to update.',
      });
    }

    return res.status(200).json({
      success: true,
      message: `Item #${id} resolution updated to ${resolutionStatus}.`,
      data: updated,
    });
  } catch (err) {
    console.error('Error in updateResolution:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to update item resolution: ' + err.message,
    });
  }
}

async function exportCsv(req, res) {
  try {
    const { batchId, reconStatus, provider, resolutionStatus } = req.query;

    const csvContent = await reconciliationService.exportReconciliationItemsCsv({
      batchId: batchId ? parseInt(batchId, 10) : undefined,
      reconStatus,
      provider,
      resolutionStatus,
    });

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const filename = `whoosh_reconciliation_${timestamp}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('Error in exportCsv:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to export CSV: ' + err.message,
    });
  }
}

module.exports = {
  runReconciliation,
  getSummary,
  getItems,
  getItemDetail,
  updateResolution,
  exportCsv,
};

