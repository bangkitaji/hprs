-- =====================================================================================
-- 05_switch_tables.sql
-- Pengalihan Nama Tabel (Table Switching) setelah Verifikasi Data Berhasil
-- Database: hpr_portal
-- =====================================================================================

-- 1. Ubah nama tabel lama menjadi legacy/backup (Data lama tetap aman 100%)
ALTER TABLE IF EXISTS hrts_sales RENAME TO hrts_sales_legacy;
ALTER TABLE IF EXISTS hrts_refund RENAME TO hrts_refund_legacy;

-- 2. Ubah nama tabel partisi baru menjadi tabel utama produksi
ALTER TABLE IF EXISTS hrts_sales_p RENAME TO hrts_sales;
ALTER TABLE IF EXISTS hrts_refund_p RENAME TO hrts_refund;

-- CATATAN:
-- Jika sewaktu-waktu perlu rollback:
-- ALTER TABLE hrts_sales RENAME TO hrts_sales_p;
-- ALTER TABLE hrts_refund RENAME TO hrts_refund_p;
-- ALTER TABLE hrts_sales_legacy RENAME TO hrts_sales;
-- ALTER TABLE hrts_refund_legacy RENAME TO hrts_refund;
