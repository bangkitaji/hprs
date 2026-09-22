-- =====================================================================================
-- 06_daily_ingestion_sample.sql
-- Template Injeksi Data Batch Harian (~20.000 Records) yang Idempoten & Aman
-- Database: hpr_portal
-- =====================================================================================

-- 1. Pola Injeksi Data Sales Harian (Upsert / On Conflict Do Update)
-- Menggunakan ON CONFLICT menjamin jika ada re-run job atau re-upload file laporan,
-- data tidak akan pernah duplikat dan data harga/status terupdate dengan benar.

/*
INSERT INTO hrts_sales (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
VALUES 
    (1001, 'Budi Santoso', '3273...', 'Indonesia', 'GA12345678', '9876543',
     'Halim', '', '6200100', '001', 'day', 'Admin',
     '2026-09-14', '2026-09-15', 'G1201', 'Halim', '01', '001A',
     'IDHMA', '2026-09-14', '08:00:00', '06:40:00', 'Padalarang',
     'IDPGA', '2026-09-15', '07:10:00', 'First Class', 'Adult',
     600000, 'normal', 1, 600000, 0, 600000, 'Mobile App', 'QRIS',
     'TRX20260914001', 'PLAT-XYZ', 'Xendit', 'WhooshApp')
ON CONFLICT (order_no, ticket_no, purchase_date) 
DO UPDATE SET
    passenger_name        = EXCLUDED.passenger_name,
    after_tax_price       = EXCLUDED.after_tax_price,
    payment_method        = EXCLUDED.payment_method,
    payment_gateway       = EXCLUDED.payment_gateway,
    ticketing_channel     = EXCLUDED.ticketing_channel;
*/

-- 2. Trigger Refresh Data Mart Agregasi Laporan Harian
-- Setiap kali batch harian selesai diinjeksi (misal untuk data tanggal kemarin atau hari ini):
CALL sp_refresh_daily_summary(CURRENT_DATE);
CALL sp_refresh_daily_summary(CURRENT_DATE - INTERVAL '1 day');

-- 3. Verifikasi Jumlah Data yang Baru Masuk
SELECT 
    purchase_date,
    COUNT(*) AS total_records_inserted,
    SUM(after_tax_price) AS total_revenue
FROM hrts_sales
WHERE purchase_date = CURRENT_DATE
GROUP BY purchase_date;
