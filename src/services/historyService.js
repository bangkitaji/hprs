const { pool } = require('../config/database');

/**
 * Service untuk mengelola riwayat upload berkas dengan dukungan pagination dan filter kategori/provider
 */
async function getUploadHistory(params = {}) {
  let page = 1;
  let limit = 10;
  let sourceFilter = null;

  if (typeof params === 'number') {
    limit = Math.min(100, Math.max(1, params));
  } else if (params && typeof params === 'object') {
    if (params.page !== undefined) page = Math.max(1, parseInt(params.page, 10) || 1);
    if (params.limit !== undefined) limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 10));
    if (params.source) sourceFilter = String(params.source).trim();
  }

  const offset = (page - 1) * limit;

  let countSql = 'SELECT count(*)::int AS total FROM upload_history';
  let dataSql = 'SELECT * FROM upload_history';
  const queryParams = [];

  if (sourceFilter) {
    if (['hrts', 'middleware', 'payment_gateway'].includes(sourceFilter)) {
      queryParams.push(sourceFilter);
      countSql += ' WHERE source_type = $1';
      dataSql += ' WHERE source_type = $1';
    } else {
      // Filter by provider (e.g. xendit, finnet, doku_all, doku_qr)
      queryParams.push(sourceFilter);
      countSql += ' WHERE provider = $1';
      dataSql += ' WHERE provider = $1';
    }
  }

  const dataQueryParams = [...queryParams];
  dataSql += ` ORDER BY id DESC LIMIT $${dataQueryParams.length + 1} OFFSET $${dataQueryParams.length + 2}`;
  dataQueryParams.push(limit, offset);

  const [countResult, dataResult] = await Promise.all([
    pool.query(countSql, queryParams),
    pool.query(dataSql, dataQueryParams),
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
  sourceType = 'hrts',
  provider = null,
}) {
  const query = `
    INSERT INTO upload_history (
      file_name, file_size, sheet_name, target_date, total_rows,
      inserted_rows, status, error_message, duration_ms, source_type, provider
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    sourceType,
    provider,
  ];

  const result = await pool.query(query, values);
  return result.rows[0]?.id;
}

module.exports = {
  getUploadHistory,
  logUploadHistory,
};
