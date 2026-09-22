const express = require('express');
const path = require('path');
const cors = require('cors');

const apiRoutes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');

const app = express();

// Konfigurasi Reverse Proxy (Nginx)
app.set('trust proxy', 1);

// Middleware Global
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestLogger);

// Layanan File Statis Frontend (public)
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Pemasangan Rute API
app.use('/api', apiRoutes);

// Fallback untuk SPA / Single Page Application
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found.' });
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Middleware Penanganan Error Global
app.use(errorHandler);

module.exports = app;
