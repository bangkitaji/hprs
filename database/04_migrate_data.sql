-- =====================================================================================
-- 04_migrate_data.sql
-- Migrasi Data Historis (Zero Data Loss) dari Tabel Lama ke Skema Baru Berpartisi
-- Database: hpr_portal
-- =====================================================================================

-- PANDUAN EKSEKUSI:
-- Migrasi dibagi menjadi batch tahunan/semester untuk menjaga kestabilan memori server,
-- memungkinkan pemantauan progress yang jelas, dan menghindari transaksi terlalu besar.

-- -------------------------------------------------------------------------------------
-- BAGIAN 1: Migrasi Tabel Sales (14.768.001 Records)
-- -------------------------------------------------------------------------------------

-- Batch 1: Tahun 2023 (Oktober - Desember 2023)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2023-10-01' AND "Purchase Date" < '2024-01-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- Batch 2: Tahun 2024 Semester 1 (Januari - Juni 2024)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2024-01-01' AND "Purchase Date" < '2024-07-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- Batch 3: Tahun 2024 Semester 2 (Juli - Desember 2024)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2024-07-01' AND "Purchase Date" < '2025-01-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- Batch 4: Tahun 2025 Semester 1 (Januari - Juni 2025)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2025-01-01' AND "Purchase Date" < '2025-07-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- Batch 5: Tahun 2025 Semester 2 (Juli - Desember 2025)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2025-07-01' AND "Purchase Date" < '2026-01-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- Batch 6: Tahun 2026 (Januari 2026 - Sekarang)
INSERT INTO hrts_sales_p (
    seq_no, passenger_name, nik_passport_no, nationality, order_no, ticket_no,
    ticketing_station, business_area, office_no, window_no, shift_no, operator_name,
    ticketing_time, departure_date, train_no, origin, cars_number, seat_number,
    origin_code, purchase_date, purchase_time, departure_time, destination,
    destination_code, arrival_date, arrival_time, seat_class, ticket_type,
    original_ticket_price, discount_type, discount_rate, before_tax_price,
    tax_rate, after_tax_price, ticketing_channel, payment_method, trade_no,
    plat_trade_no, payment_gateway, b2b_partner
)
SELECT
    "Seq No"::BIGINT, "Passenger Name", "NIK/Passport No.", "nationality", "Order No.", "Ticket No.",
    "Ticketing Station", "Business Area", "Office No.", "Window No.", "Shift No.", "Operator Name",
    to_date("Ticketing Time", 'YYYYMMDD'), "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time", "destination",
    "Destination Code", "Arrival Date", "Arrival Time", "Seat Class", "Ticket Type",
    COALESCE("Original Ticket Price", 0), "Discount Type", COALESCE("Discount Rate", 1), COALESCE("Before Tax Price", 0),
    COALESCE("Tax Rate", 0), COALESCE("After Tax Price", 0), "Ticketing Channel", "Payment Method", "Trade No",
    "PlatTrade No", "Payment Gateway", "B2B Partner"
FROM hrts_sales
WHERE "Purchase Date" >= '2026-01-01'
ON CONFLICT (order_no, ticket_no, purchase_date) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- BAGIAN 2: Migrasi Tabel Refund (1.137.091 Records)
-- -------------------------------------------------------------------------------------

INSERT INTO hrts_refund_p (
    seq_no, refund_date, cancelation_time, refund_type, refund_person,
    refund_charge_rate, refund_charge, refund_amount, refund_trade_no, plat_trade_no,
    refund_bank_code, refund_bank_name, refund_method, refund_state, refund_account,
    refund_account_name, actual_refund_amount, passenger_name, nik_passport_no,
    nationality, order_no, ticket_no, ticketing_station, business_area, office_no,
    window_no, shift_no, operator_name, ticketing_time, departure_date, train_no,
    origin, cars_number, seat_number, origin_code, purchase_date, purchase_time,
    departure_time, destination, destination_code, arrival_date, arrival_time,
    seat_class, ticket_type, original_ticket_price
)
SELECT
    CASE WHEN "Seq No" ~ '^[0-9]+$' THEN "Seq No"::BIGINT ELSE NULL END,
    to_date("Refund date", 'YYYYMMDD'),
    to_timestamp("Cancelation Time", 'YYYY/MM/DD HH24:MI:SS'),
    "Refund Type", "Refund Person",
    COALESCE("Refund charge rate", 0), COALESCE("Refund Charge", 0), COALESCE("Refund Amount", 0),
    "refundtradeno", "plattradeno", "Refund Bank Code", "Refund Bank Name",
    "refundmethod", "refundstate", "Refund Account", "Refund Account Name",
    COALESCE("Actual Refund Amount", 0), "Passenger Name", "NIK/Passport No.",
    "nationality", "Order No.", "Ticket No.", "Ticketing Station", "Business Area",
    "Office No.", "Window No.", "Shift No.", "Operator Name", "Ticketing Time",
    "Departure Date", "Train No.", "origin", "Cars Number", "Seat Number",
    "Origin Code", "Purchase Date", "Purchase Time", "Departure Time",
    "destination", "Destination Code", "Arrival Date", "Arrival Time",
    "Seat Class", "Ticket Type", COALESCE("Original Ticket Price", 0)
FROM hrts_refund
ON CONFLICT (order_no, ticket_no, refund_date) DO NOTHING;
