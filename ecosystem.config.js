/**
 * PM2 Process Management Configuration
 * FAREBOX DATA MANAGEMENT — Production Cluster Deployment
 */

const fs = require('fs');
const path = require('path');
const { loadEnvironmentConfig } = require('./src/config/envLoader');

// Muat konfigurasi .env agar port selalu sinkron
loadEnvironmentConfig();

// Pastikan direktori logs otomatis dibuat jika belum ada
try {
  const logsDir = path.resolve(__dirname, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
} catch (_) {}

const appPort = parseInt(process.env.PORT || '3030', 10);

module.exports = {
  apps: [
    {
      name: 'farebox-portal',
      script: './server.js',
      cwd: __dirname,
      instances: 2, // Mode kluster untuk ketersediaan tinggi (atau gunakan 'max' sesuai core)
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development',
        PORT: appPort,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: appPort,
      },
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
