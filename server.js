/**
 * Farebox Data Management Portal
 * Application Entry Point & Server Bootstrap
 */

require('dotenv').config();

const app = require('./src/app');
const { pool } = require('./src/config/database');

const PORT = process.env.PORT || 3000;

// Jalankan Server HTTP
const server = app.listen(PORT, () => {
  console.log('=======================================================');
  console.log('🚄 FAREBOX DATA MANAGEMENT');
  console.log(`   Running on : http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('=======================================================');
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
