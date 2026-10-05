-- =====================================================================================
-- 02_prepare_target_before_load.sql
-- Persiapan Tabel Target di PRODUCTION Sebelum Transfer Data (Jalankan HANYA di PROD)
-- Database: hpr_portal
-- Prasyarat: Struktur sudah dibuat (skrip 01, 02, rename, 03, 07, 08, 09).
-- =====================================================================================

-- [A] Nonaktifkan timeout untuk user Anda sendiri (tidak butuh superuser).
--     Setelah dijalankan, PUTUSKAN lalu SAMBUNGKAN ULANG koneksi PROD di Navicat
--     agar berlaku untuk sesi Data Transfer. Dikembalikan di skrip 03.
ALTER ROLE CURRENT_USER SET statement_timeout = 0;
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = 0;

-- [B] Hapus index sekunder sementara agar INSERT 2-4x lebih cepat.
--     Primary Key TETAP dipertahankan untuk mencegah data duplikat saat retry.
--     Index dibuat ulang di skrip 03_post_load_finalize.sql.
DROP INDEX IF EXISTS
    idx_sales_p_pur_date_brin,
    idx_sales_p_dep_date_brin,
    idx_sales_p_ticket_no,
    idx_sales_p_order_no,
    idx_sales_p_reporting,
    idx_sales_p_partner;

DROP INDEX IF EXISTS
    idx_refund_p_ref_date_brin,
    idx_refund_p_dep_date_brin,
    idx_refund_p_ticket_no,
    idx_refund_p_order_no,
    idx_refund_p_state;

DROP INDEX IF EXISTS
    idx_occupancy_date,
    idx_occupancy_train,
    idx_occupancy_route;

-- [C] Kosongkan tabel kecil yang sudah terisi seed default oleh skrip 09
--     (akun admin/operator) agar tidak bentrok dengan data users dari LOCAL.
--     Lewati baris ini jika Anda TIDAK ingin memindahkan data users dari LOCAL.
TRUNCATE TABLE users RESTART IDENTITY;

-- [D] Pastikan seluruh tabel target dalam keadaan kosong sebelum transfer
SELECT 'hrts_sales' AS tabel, COUNT(*) FROM hrts_sales
UNION ALL SELECT 'hrts_refund', COUNT(*) FROM hrts_refund
UNION ALL SELECT 'hrts_occupancy', COUNT(*) FROM hrts_occupancy
UNION ALL SELECT 'hrts_daily_sales_summary', COUNT(*) FROM hrts_daily_sales_summary
UNION ALL SELECT 'hrts_daily_refund_summary', COUNT(*) FROM hrts_daily_refund_summary
UNION ALL SELECT 'hrts_daily_occupancy_summary', COUNT(*) FROM hrts_daily_occupancy_summary
UNION ALL SELECT 'users', COUNT(*) FROM users
UNION ALL SELECT 'upload_history', COUNT(*) FROM upload_history;
