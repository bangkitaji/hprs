const express = require('express');
const router = express.Router();
const reconciliationController = require('../controllers/reconciliationController');
const { requireRole } = require('../middlewares/authMiddleware');

// Eksekusi Batch Rekonsiliasi Otomatis 3-Arah
router.post('/run', requireRole('administrator'), reconciliationController.runReconciliation);

// Ambil Ringkasan Eksekutif & Metrik Fee Settled
router.get('/summary', reconciliationController.getSummary);

// Ambil Daftar Item Hasil Rekonsiliasi dengan Filter & Pagination
router.get('/items', reconciliationController.getItems);

// Ambil Detail 3-Way Perbandingan Sebuah Transaksi
router.get('/items/:id', reconciliationController.getItemDetail);

// Update Status Resolusi Dispute (Actionable Dispute Workflow)
router.patch('/items/:id/resolution', requireRole('administrator'), reconciliationController.updateResolution);

// Ekspor Hasil Rekonsiliasi ke Format CSV
router.get('/export', reconciliationController.exportCsv);

module.exports = router;

