-- =====================================================================================
-- 02_create_partitioned_refund.sql
-- Pembuatan Tabel Refund Tiket Berpartisi Bulanan (Monthly Range Partitioning)
-- Database: hpr_portal
-- =====================================================================================

-- 1. Buat Tabel Master Berpartisi
CREATE TABLE IF NOT EXISTS hrts_refund_p (
    seq_no                  BIGINT,
    refund_date             DATE NOT NULL,
    cancelation_time        TIMESTAMP WITHOUT TIME ZONE,
    refund_type             VARCHAR(100),
    refund_person           VARCHAR(150),
    refund_charge_rate      NUMERIC(6, 4) DEFAULT 0,
    refund_charge           NUMERIC(12, 2) DEFAULT 0,
    refund_amount           NUMERIC(12, 2) DEFAULT 0,
    refund_trade_no         VARCHAR(100),
    plat_trade_no           VARCHAR(100),
    refund_bank_code        VARCHAR(50),
    refund_bank_name        VARCHAR(100),
    refund_method           VARCHAR(50),
    refund_state            VARCHAR(50),
    refund_account          VARCHAR(100),
    refund_account_name     VARCHAR(150),
    actual_refund_amount    NUMERIC(12, 2) DEFAULT 0,
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
    purchase_date           DATE,
    purchase_time           TIME,
    departure_time          TIME,
    destination             VARCHAR(100),
    destination_code        VARCHAR(20),
    arrival_date            DATE,
    arrival_time            TIME,
    seat_class              VARCHAR(50),
    ticket_type             VARCHAR(50),
    original_ticket_price   NUMERIC(12, 2) DEFAULT 0,
    created_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_hrts_refund_p PRIMARY KEY (order_no, ticket_no, refund_date)
) PARTITION BY RANGE (refund_date);

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
        part_name := 'hrts_refund_' || to_char(curr_date, 'YYYY_MM');
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF hrts_refund_p FOR VALUES FROM (%L) TO (%L);',
            part_name, curr_date, next_date
        );
        curr_date := next_date;
    END LOOP;
END $$;

-- 3. Pembuatan Index pada Master Partition
CREATE INDEX IF NOT EXISTS idx_refund_p_ref_date_brin ON hrts_refund_p USING BRIN (refund_date);
CREATE INDEX IF NOT EXISTS idx_refund_p_dep_date_brin ON hrts_refund_p USING BRIN (departure_date);
CREATE INDEX IF NOT EXISTS idx_refund_p_ticket_no ON hrts_refund_p (ticket_no);
CREATE INDEX IF NOT EXISTS idx_refund_p_order_no ON hrts_refund_p (order_no);
CREATE INDEX IF NOT EXISTS idx_refund_p_state ON hrts_refund_p (refund_state, refund_method);
