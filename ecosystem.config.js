/**
 * PM2 Process Management Configuration
 * FAREBOX DATA MANAGEMENT — Production Cluster Deployment
 */

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
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000, // Sesuaikan jika port 3000 sudah terpakai oleh aplikasi/stack lain
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
