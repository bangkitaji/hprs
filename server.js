/**
 * Farebox Data Management Portal
 * Application Entry Point & Server Bootstrap
 */

const { loadEnvironmentConfig } = require('./src/config/envLoader');
loadEnvironmentConfig();

const app = require('./src/app');
const { pool, dbConfig } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

// Jalankan Server HTTP
const server = app.listen(PORT, () => {
  console.log('=======================================================');
  console.log('🚄 FAREBOX DATA MANAGEMENT');
  console.log(`   Running on : http://localhost:${PORT}`);
  console.log(`   DB Host    : ${dbConfig.host}:${dbConfig.port} (${dbConfig.database})`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('=======================================================');
});

// Tangani error binding port (misal Port 3000 sudah terpakai)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ PORT ${PORT} SUDAH DIGUNAKAN (EADDRINUSE)!`);
    console.error(`   Ada proses Node.js lama atau aplikasi lain yang masih menduduki port ${PORT}.`);
    console.error(`   Cara mengatasinya di Linux production:`);
    console.error(`   1. Hentikan proses lama: sudo fuser -k ${PORT}/tcp`);
    console.error(`   2. Atau bunuh semua node: killall -9 node`);
    console.error(`   3. Kemudian reload PM2: pm2 reload ecosystem.config.js --env production\n`);
  } else {
    console.error('\n❌ Server HTTP Error:', err);
  }
  process.exit(1);
});

// Global Uncaught Exception & Promise Rejection Handlers
process.on('uncaughtException', (err) => {
  console.error('\n💥 Uncaught Exception in server process:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful Shutdown Handler
function handleGracefulShutdown(signal) {
  console.log(`\n[${signal}] Gracefully shutting down server...`);
  server.close(() => {
    console.log('HTTP server stopped successfully.');
    pool.end(() => {
      console.log('PostgreSQL database connection pool closed.');
      process.exit(0);
    });
  });

  // Force exit if shutdown process exceeds 10 seconds
  setTimeout(() => {
    console.error('Shutdown timed out after 10 seconds, forcing exit.');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
