const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const apiRoutes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');

const app = express();

// Konfigurasi Reverse Proxy (Nginx)
app.set('trust proxy', 1);

// Middleware Keamanan Header HTTP (Helmet)
app.use(helmet({
  contentSecurityPolicy: false, // Dinonaktifkan sementara agar CDN FontAwesome & Chart.js di frontend berfungsi lancar
  crossOriginEmbedderPolicy: false,
}));

// Pembatasan CORS Berbasis Asal (Whitelist)
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://farebox.kcic.co.id', 'https://farebox.kcic.co.id'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true,
}));

// Rate Limiter Khusus Endpoint Login (Brute-Force & Credential Stuffing Protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 10, // Maksimal 10 kali percobaan gagal per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this IP address. Please try again after 15 minutes.',
  },
});
app.use('/api/auth/login', loginLimiter);

// Rate Limiter Umum API (DDoS Protection)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 600, // 600 request per menit per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP address. Please slow down.',
  },
});
app.use('/api', apiLimiter);

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
