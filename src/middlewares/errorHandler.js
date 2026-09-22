const multer = require('multer');

/**
 * Middleware penanganan error terpusat (Global Error Handler)
 */
function errorHandler(err, req, res, next) {
  console.error('Unhandled Application Error:', err);

  // Error dari Multer (misal ukuran file melebihi batas)
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File size exceeds the maximum allowed limit.',
      });
    }
    return res.status(400).json({
      error: `File upload error: ${err.message}`,
    });
  }

  // Error validasi umum
  if (err.status) {
    return res.status(err.status).json({
      error: err.message,
    });
  }

  // Fallback 500 Internal Server Error
  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred.'
      : err.message,
  });
}

module.exports = errorHandler;
