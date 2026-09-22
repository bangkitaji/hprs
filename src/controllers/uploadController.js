const fs = require('fs');
const ingestionService = require('../services/ingestionService');

/**
 * Controller for endpoint POST /api/upload/preview
 */
async function previewUpload(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const filePath = req.file.path;

  try {
    const previewData = await ingestionService.generateExcelPreview(
      filePath,
      req.file.originalname,
      req.file.size
    );
    res.json(previewData);
  } catch (err) {
    console.error('Error in previewUpload:', err);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
    res.status(500).json({ error: `Failed to read Excel file: ${err.message}` });
  }
}

/**
 * Controller for endpoint POST /api/upload/process
 */
async function processUpload(req, res, next) {
  const { tempFilePath, originalName, fileSize, selectedSheets } = req.body;

  if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    return res.status(400).json({
      error: 'Temporary file not found or already processed. Please upload again.',
    });
  }

  try {
    const results = await ingestionService.processExcelIngestion({
      tempFilePath,
      originalName,
      fileSize,
      selectedSheets,
    });

    res.json({
      success: true,
      message: `Successfully ingested ${results.totalSalesInserted} Sales records, ${results.totalRefundInserted} Refund records, and ${results.totalOccupancyInserted} Occupancy records.`,
      results,
    });
  } catch (err) {
    console.error('Error in processUpload:', err);
    res.status(500).json({ error: `Failed to ingest data: ${err.message}` });
  }
}

module.exports = {
  previewUpload,
  processUpload,
};
