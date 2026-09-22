-- =====================================================================================
-- 01_create_partitioned_sales.sql
-- Pembuatan Tabel Penjualan Tiket Berpartisi Bulanan (Monthly Range Partitioning)
-- Database: hpr_portal
-- =====================================================================================

-- 1. Buat Tabel Master Berpartisi
CREATE TABLE IF NOT EXISTS hrts_sales_p (
    seq_no                  BIGINT,
    passenger_name          VARCHAR(150),
    nik_passport_no         VARCHAR(50),
    nationality             VARCHAR(50),
    order_no                VARCHAR(50) NOT NULL,
    ticket_no               VARCHAR(50) NOT NULL,
    ticketing_station       VARCHAR(100),
    business_area           VARCHAR(100),
    office_no               VARCHAR(50),
    window_no               VARCHAR(50),
    shift_no                VARCHAR(50),
    operator_name           VARCHAR(100),
    ticketing_time          DATE,
    departure_date          DATE,
    train_no                VARCHAR(50),
    origin                  VARCHAR(100),
    cars_number             VARCHAR(20),
    seat_number             VARCHAR(20),
    origin_code             VARCHAR(20),
    purchase_date           DATE NOT NULL,
    purchase_time           TIME,
    departure_time          TIME,
    destination             VARCHAR(100),
    destination_code        VARCHAR(20),
    arrival_date            DATE,
    arrival_time            TIME,
    seat_class              VARCHAR(50),
    ticket_type             VARCHAR(50),
    original_ticket_price   NUMERIC(12, 2) DEFAULT 0,
    discount_type           VARCHAR(50),
    discount_rate           NUMERIC(6, 4) DEFAULT 1,
    before_tax_price        NUMERIC(12, 2) DEFAULT 0,
    tax_rate                NUMERIC(6, 4) DEFAULT 0,
    after_tax_price         NUMERIC(12, 2) DEFAULT 0,
    ticketing_channel       VARCHAR(50),
    payment_method          VARCHAR(50),
    trade_no                VARCHAR(100),
    plat_trade_no           VARCHAR(100),
    payment_gateway         VARCHAR(50),
    b2b_partner             VARCHAR(50),
    created_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_hrts_sales_p PRIMARY KEY (order_no, ticket_no, purchase_date)
) PARTITION BY RANGE (purchase_date);

-- 2. Otomatisasi Pembuatan Partisi Bulanan dari 2023-10 s.d. 2027-12
DO $$
DECLARE
    start_date DATE := '2023-10-01';
    end_date   DATE := '2028-01-01';
    curr_date  DATE := start_date;
    next_date  DATE;
    part_name  TEXT;
BEGIN
    WHILE curr_date < end_date LOOP
        next_date := curr_date + INTERVAL '1 month';
        part_name := 'hrts_sales_' || to_char(curr_date, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF hrts_sales_p FOR VALUES FROM (%L) TO (%L);',
            part_name, curr_date, next_date
        );
        curr_date := next_date;
    END LOOP;
END $$;

-- 3. Pembuatan Index pada Master Partition (Otomatis Diterapkan ke Seluruh Partisi)

-- Index BRIN: Sangat efisien & hemat memori untuk rentang tanggal berurutan
CREATE INDEX IF NOT EXISTS idx_sales_p_pur_date_brin ON hrts_sales_p USING BRIN (purchase_date);
CREATE INDEX IF NOT EXISTS idx_sales_p_dep_date_brin ON hrts_sales_p USING BRIN (departure_date);

-- Index B-Tree: Pencarian cepat tiket spesifik & matching refund
CREATE INDEX IF NOT EXISTS idx_sales_p_ticket_no ON hrts_sales_p (ticket_no);
CREATE INDEX IF NOT EXISTS idx_sales_p_order_no ON hrts_sales_p (order_no);

-- Index Filter Laporan: Stasiun, Kereta, Payment Gateway, Partner
CREATE INDEX IF NOT EXISTS idx_sales_p_reporting ON hrts_sales_p (ticketing_station, train_no, payment_gateway);
CREATE INDEX IF NOT EXISTS idx_sales_p_partner ON hrts_sales_p (b2b_partner, ticketing_channel);
