-- =====================================================================================
-- 03_post_load_finalize.sql
-- Finalisasi PRODUCTION Setelah Transfer Data Selesai (Jalankan HANYA di PROD)
-- Database: hpr_portal
-- Estimasi durasi: 5 - 20 menit (tergantung spesifikasi server).
-- =====================================================================================

-- [A] Parameter sesi (boleh diset user biasa, hanya berlaku di sesi ini)
SET statement_timeout = 0;
SET maintenance_work_mem = '512MB';

-- [B] Buat ulang index sekunder (nama & definisi identik dengan skrip 01, 02, 08)
CREATE INDEX IF NOT EXISTS idx_sales_p_pur_date_brin ON hrts_sales USING BRIN (purchase_date);
CREATE INDEX IF NOT EXISTS idx_sales_p_dep_date_brin ON hrts_sales USING BRIN (departure_date);
CREATE INDEX IF NOT EXISTS idx_sales_p_ticket_no     ON hrts_sales (ticket_no);
CREATE INDEX IF NOT EXISTS idx_sales_p_order_no      ON hrts_sales (order_no);
CREATE INDEX IF NOT EXISTS idx_sales_p_reporting     ON hrts_sales (ticketing_station, train_no, payment_gateway);
CREATE INDEX IF NOT EXISTS idx_sales_p_partner       ON hrts_sales (b2b_partner, ticketing_channel);

CREATE INDEX IF NOT EXISTS idx_refund_p_ref_date_brin ON hrts_refund USING BRIN (refund_date);
CREATE INDEX IF NOT EXISTS idx_refund_p_dep_date_brin ON hrts_refund USING BRIN (departure_date);
CREATE INDEX IF NOT EXISTS idx_refund_p_ticket_no     ON hrts_refund (ticket_no);
CREATE INDEX IF NOT EXISTS idx_refund_p_order_no      ON hrts_refund (order_no);
CREATE INDEX IF NOT EXISTS idx_refund_p_state         ON hrts_refund (refund_state, refund_method);

CREATE INDEX IF NOT EXISTS idx_occupancy_date  ON hrts_occupancy (train_date);
CREATE INDEX IF NOT EXISTS idx_occupancy_train ON hrts_occupancy (train_no, train_date);
CREATE INDEX IF NOT EXISTS idx_occupancy_route ON hrts_occupancy (origin, destination);

-- [C] Sinkronkan sequence SERIAL/BIGSERIAL dengan data hasil transfer
--     (wajib, jika tidak INSERT baru dari aplikasi akan gagal "duplicate key").
SELECT setval(pg_get_serial_sequence('users', 'id'),
              COALESCE((SELECT MAX(id) FROM users), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('upload_history', 'id'),
              COALESCE((SELECT MAX(id) FROM upload_history), 0) + 1, false);
SELECT setval(pg_get_serial_sequence('hrts_occupancy', 'id'),
              COALESCE((SELECT MAX(id) FROM hrts_occupancy), 0) + 1, false);

-- [D] Perbarui statistik planner (pemilik tabel boleh menjalankan ANALYZE)
ANALYZE hrts_sales;
ANALYZE hrts_refund;
ANALYZE hrts_occupancy;
ANALYZE hrts_daily_sales_summary;
ANALYZE hrts_daily_refund_summary;
ANALYZE hrts_daily_occupancy_summary;
ANALYZE users;
ANALYZE upload_history;

-- [E] Kembalikan timeout role ke default server (dibuka di skrip 02)
ALTER ROLE CURRENT_USER RESET statement_timeout;
ALTER ROLE CURRENT_USER RESET idle_in_transaction_session_timeout;

-- [F] Cek index sudah lengkap
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('hrts_sales', 'hrts_refund', 'hrts_occupancy')
ORDER BY tablename, indexname;
