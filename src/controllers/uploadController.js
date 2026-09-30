const path = require('path');
const fs = require('fs');
const { UPLOAD_DIR } = require('../config/upload');
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
    res.json({
      ...previewData,
      tempFileName: path.basename(filePath),
      tempFilePath: path.basename(filePath), // backward compatibility for frontend
    });
  } catch (err) {
    console.error('Error in previewUpload:', err);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (_) {}
    }
    next(err);
  }
}

/**
 * Controller for endpoint POST /api/upload/process
 */
async function processUpload(req, res, next) {
  try {
    const { tempFilePath, tempFileName, originalName, fileSize, selectedSheets } = req.body;
    const fileId = tempFileName || tempFilePath;

    if (!fileId) {
      return res.status(400).json({
        error: 'Temporary file identifier is required.',
      });
    }

    // STRICT SANITIZATION: strip all directory traversal components
    const safeBaseName = path.basename(fileId);
    const safeFilePath = path.join(UPLOAD_DIR, safeBaseName);

    // Verify file exists and is strictly within UPLOAD_DIR
    const resolvedPath = path.resolve(safeFilePath);
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR)) || !fs.existsSync(resolvedPath)) {
      return res.status(400).json({
        error: 'Temporary file not found or already processed. Please upload again.',
      });
    }

    const results = await ingestionService.processExcelIngestion({
      tempFilePath: resolvedPath,
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
    next(err);
  }
}

module.exports = {
  previewUpload,
  processUpload,
};
