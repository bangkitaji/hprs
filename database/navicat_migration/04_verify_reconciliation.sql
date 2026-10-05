-- =====================================================================================
-- 04_verify_reconciliation.sql
-- Rekonsiliasi Data LOCAL vs PRODUCTION (Jalankan di KEDUA koneksi, bandingkan hasilnya)
-- Database: hpr_portal
-- Tips: Export hasil masing-masing ke Excel (Navicat: klik kanan grid > Export),
--       lalu bandingkan kolom jumlah_baris & checksum_nominal. Harus 100% identik.
-- =====================================================================================

-- [A] Rekap per bulan: jumlah baris + total nominal (checksum sederhana)
SELECT 'hrts_sales' AS tabel, to_char(purchase_date, 'YYYY-MM') AS bulan,
       COUNT(*) AS jumlah_baris, SUM(after_tax_price) AS checksum_nominal
FROM hrts_sales GROUP BY 1, 2
UNION ALL
SELECT 'hrts_refund', to_char(refund_date, 'YYYY-MM'),
       COUNT(*), SUM(actual_refund_amount)
FROM hrts_refund GROUP BY 1, 2
UNION ALL
SELECT 'hrts_occupancy', to_char(train_date, 'YYYY-MM'),
       COUNT(*), SUM(total_fare)
FROM hrts_occupancy GROUP BY 1, 2
ORDER BY 1, 2;

-- [B] Rekap total per tabel (termasuk tabel kecil)
SELECT 'hrts_sales' AS tabel, COUNT(*) AS jumlah_baris FROM hrts_sales
UNION ALL SELECT 'hrts_refund', COUNT(*) FROM hrts_refund
UNION ALL SELECT 'hrts_occupancy', COUNT(*) FROM hrts_occupancy
UNION ALL SELECT 'hrts_daily_sales_summary', COUNT(*) FROM hrts_daily_sales_summary
UNION ALL SELECT 'hrts_daily_refund_summary', COUNT(*) FROM hrts_daily_refund_summary
UNION ALL SELECT 'hrts_daily_occupancy_summary', COUNT(*) FROM hrts_daily_occupancy_summary
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'upload_history', COUNT(*) FROM upload_history
ORDER BY 1;

-- [C] Cek objek pendukung (view & procedure) sudah ada
SELECT 'view' AS jenis, viewname AS nama FROM pg_views
WHERE schemaname = 'public' AND viewname LIKE 'v_hrts_%'
UNION ALL
SELECT 'procedure', proname FROM pg_proc
WHERE proname = 'sp_refresh_daily_summary';
