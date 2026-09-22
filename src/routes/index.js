const express = require('express');
const router = express.Router();

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const statsRoutes = require('./statsRoutes');
const summaryRoutes = require('./summaryRoutes');
const historyRoutes = require('./historyRoutes');
const uploadRoutes = require('./uploadRoutes');
const { authenticate, requireRole } = require('../middlewares/authMiddleware');

// 1. Rute Publik Autentikasi (Login & Cek Sesi)
router.use('/auth', authRoutes);

// 2. Rute Upload Data (Bisa diakses oleh Administrator & User)
router.use('/upload', authenticate, uploadRoutes);

// 3. Rute Manajemen Pengguna (Khusus Administrator)
router.use('/users', userRoutes);

// 4. Rute Data Mart Analytics (Khusus Administrator)
router.use('/summary', authenticate, requireRole('administrator'), summaryRoutes);

// 5. Rute Statistik KPI & Riwayat Upload (Memerlukan Login)
router.use('/stats', authenticate, statsRoutes);
router.use('/history', authenticate, historyRoutes);

module.exports = router;
