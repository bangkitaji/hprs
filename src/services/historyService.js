const { pool } = require('../config/database');

/**
 * Service untuk mengelola riwayat upload berkas dengan dukungan pagination
 */
async function getUploadHistory(params = {}) {
  let page = 1;
  let limit = 10;

  if (typeof params === 'number') {
    limit = Math.min(100, Math.max(1, params));
  } else if (params && typeof params === 'object') {
    if (params.page !== undefined) page = Math.max(1, parseInt(params.page, 10) || 1);
    if (params.limit !== undefined) limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 10));
  }

  const offset = (page - 1) * limit;

  const [countResult, dataResult] = await Promise.all([
    pool.query('SELECT count(*)::int AS total FROM upload_history'),
    pool.query(
      'SELECT * FROM upload_history ORDER BY id DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    ),
  ]);

  const total = countResult.rows[0]?.total || 0;
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    data: dataResult.rows,
    total,
    page,
    limit,
    totalPages,
  };
}

/**
 * Mencatat riwayat upload berhasil atau gagal ke tabel upload_history
 */
async function logUploadHistory({
  fileName,
  fileSize = 0,
  sheetName = null,
  targetDate = null,
  totalRows = 0,
  insertedRows = 0,
  status = 'success',
  errorMessage = null,
  durationMs = 0,
}) {
  const query = `
    INSERT INTO upload_history (
      file_name, file_size, sheet_name, target_date, total_rows,
      inserted_rows, status, error_message, duration_ms
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id
  `;
  const values = [
    fileName,
    fileSize,
    sheetName,
    targetDate,
    totalRows,
    insertedRows,
    status,
    errorMessage,
    durationMs,
  ];

  const result = await pool.query(query, values);
  return result.rows[0]?.id;
}

module.exports = {
  getUploadHistory,
  logUploadHistory,
};
