# =====================================================================================
# run_migration.ps1
# Runner Script untuk Migrasi Seluruh Data Historis ke Skema Berpartisi
# =====================================================================================

if (-not $env:PGPASSWORD) {
    $env:PGPASSWORD = Read-Host -Prompt "Masukkan Password PostgreSQL" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($env:PGPASSWORD)
    $env:PGPASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}
$psql = if (Get-Command psql -ErrorAction SilentlyContinue) { "psql" } elseif (Test-Path "D:\postgre\bin\psql.exe") { "D:\postgre\bin\psql.exe" } else { "psql" }

function Execute-Batch ($label, $sql) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Memulai $label..." -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $sql | & $psql -U ($env:PGUSER ?? "postgres") -h ($env:PGHOST ?? "localhost") -d ($env:PGDATABASE ?? "hpr_portal")
    $sw.Stop()
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Selesai $label dalam $($sw.Elapsed.TotalSeconds.ToString('F1')) detik." -ForegroundColor Green
}

# 1. Sales Batch 2: 2024 Semester 1
$sql2 = @"
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
"@
Execute-Batch "Sales Batch 2 (2024 H1)" $sql2

# 2. Sales Batch 3: 2024 Semester 2
$sql3 = @"
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
"@
Execute-Batch "Sales Batch 3 (2024 H2)" $sql3

# 3. Sales Batch 4: 2025 Semester 1
$sql4 = @"
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
"@
Execute-Batch "Sales Batch 4 (2025 H1)" $sql4

# 4. Sales Batch 5: 2025 Semester 2
$sql5 = @"
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
"@
Execute-Batch "Sales Batch 5 (2025 H2)" $sql5

# 5. Sales Batch 6: 2026 s.d. Sekarang
$sql6 = @"
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
"@
Execute-Batch "Sales Batch 6 (2026 s.d. Sekarang)" $sql6

# 6. Refund: Seluruh Data (1.137.091 records)
$sqlRefund = @"
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
"@
Execute-Batch "Refund (Semua Data)" $sqlRefund

Write-Host "Migrasi seluruh batch selesai dengan sukses!" -ForegroundColor Yellow
