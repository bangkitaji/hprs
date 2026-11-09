const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Universal & Bulletproof Environment Variable Loader
 * Menangani UTF-8 BOM, spasi di sekitar '=', berbagai lokasi file .env,
 * serta alias nama variabel database (DB_HOST, PGHOST, DATABASE_URL, dll.)
 */
function loadEnvironmentConfig() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '.env'),
    path.resolve(process.cwd(), '.env.production'),
    path.resolve(__dirname, '../../.env.production'),
    path.resolve(process.cwd(), '.env.local'),
  ];

  // Cari file .env yang benar-benar ada
  let loadedPath = null;
  const parsedKeys = {};

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      try {
        let content = fs.readFileSync(envPath, 'utf-8');
        // 1. Hapus UTF-8 Byte Order Mark (BOM) jika ada
        if (content.charCodeAt(0) === 0xFEFF) {
          content = content.slice(1);
        }

        // 2. Parse menggunakan dotenv
        const parsed = dotenv.parse(content);
        for (const [key, val] of Object.entries(parsed)) {
          // Bersihkan hidden characters atau spasi di key
          const cleanKey = key.trim().replace(/^[\uFEFF\u200B]+/, '');
          process.env[cleanKey] = val;
          parsedKeys[cleanKey] = val;
        }

        // 3. Fallback regex parser jika ada format KEY = VALUE dengan spasi
        const lines = content.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
          if (match) {
            const key = match[1].trim();
            let val = match[2].trim();
            // Hapus kutip jika ada
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            } else {
              // Hapus komentar inline (misal: VAL # komentar)
              const commentIdx = val.indexOf('#');
              if (commentIdx > -1) {
                val = val.substring(0, commentIdx).trim();
              }
            }
            process.env[key] = val;
            parsedKeys[key] = val;
          }
        }

        loadedPath = envPath;
        break;
      } catch (err) {
        console.warn(`[envLoader] Gagal membaca ${envPath}:`, err.message);
      }
    }
  }

  // 4. Resolusi Parameter Database dengan Dukungan Alias
  let host = process.env.DB_HOST || process.env.PGHOST || process.env.DATABASE_HOST || process.env.POSTGRES_HOST || process.env.DB_HOSTNAME || process.env.PG_HOST;
  let port = process.env.DB_PORT || process.env.PGPORT || process.env.DATABASE_PORT || process.env.POSTGRES_PORT;
  let database = process.env.DB_NAME || process.env.PGDATABASE || process.env.DATABASE_NAME || process.env.POSTGRES_DB || process.env.DB_DATABASE;
  let user = process.env.DB_USER || process.env.PGUSER || process.env.DATABASE_USER || process.env.POSTGRES_USER || process.env.DB_USERNAME;
  let password = process.env.DB_PASSWORD || process.env.PGPASSWORD || process.env.DATABASE_PASSWORD || process.env.POSTGRES_PASSWORD;

  // 5. Dukungan Connection String DATABASE_URL / DB_URL jika disediakan
  const rawUrl = process.env.DATABASE_URL || process.env.DB_URL || process.env.POSTGRES_URL;
  if (rawUrl) {
    try {
      const parsedUrl = new URL(rawUrl);
      host = host || parsedUrl.hostname;
      port = port || parsedUrl.port;
      database = database || parsedUrl.pathname.replace(/^\//, '');
      user = user || decodeURIComponent(parsedUrl.username);
      password = password || decodeURIComponent(parsedUrl.password);
    } catch (e) {
      // Abaikan jika bukan URL valid
    }
  }

  // Standarisasi kembali ke process.env
  if (host) process.env.DB_HOST = host;
  if (port) process.env.DB_PORT = port;
  if (database) process.env.DB_NAME = database;
  if (user) process.env.DB_USER = user;
  if (password) process.env.DB_PASSWORD = password;

  return {
    loadedPath,
    parsedKeys,
    dbConfig: {
      host: host || 'localhost',
      port: parseInt(port || '5432', 10),
      database: database || 'hpr_portal',
      user: user || 'postgres',
      password: password || '',
      ssl: process.env.DB_SSL === 'true',
    },
  };
}

module.exports = {
  loadEnvironmentConfig,
};
