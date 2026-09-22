-- =====================================================================================
-- 08_create_occupancy_tables.sql
-- Pembuatan Tabel Occupancy Kereta Cepat (HRTS Occupancy Data Engine)
-- Database: hpr_portal
-- =====================================================================================

-- 1. Tabel Utama hrts_occupancy
CREATE TABLE IF NOT EXISTS hrts_occupancy (
    id                      BIGSERIAL PRIMARY KEY,
    train_no                VARCHAR(50) NOT NULL,
    origin                  VARCHAR(100) NOT NULL,
    destination             VARCHAR(100) NOT NULL,
    train_date              DATE NOT NULL,
    departure_time          TIME,
    seat_class              VARCHAR(50) NOT NULL,
    capacity_per_class      INT DEFAULT 0,
    occupancy_rate          NUMERIC(6, 4) DEFAULT 0, -- Nilai desimal: contoh 0.5600 (56%), 1.0000 (100%)
    sum_passengers          INT DEFAULT 0,           -- SUMPSG
    total_fare              NUMERIC(14, 2) DEFAULT 0, -- TOTFARE
    fare                    NUMERIC(14, 2) DEFAULT 0, -- FARE
    created_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_hrts_occupancy UNIQUE (train_no, train_date, origin, destination, seat_class)
);

CREATE INDEX IF NOT EXISTS idx_occupancy_date ON hrts_occupancy (train_date);
CREATE INDEX IF NOT EXISTS idx_occupancy_train ON hrts_occupancy (train_no, train_date);
CREATE INDEX IF NOT EXISTS idx_occupancy_route ON hrts_occupancy (origin, destination);

-- 2. Tabel Ringkasan Okupansi Harian (Occupancy Data Mart Summary)
CREATE TABLE IF NOT EXISTS hrts_daily_occupancy_summary (
    summary_date            DATE NOT NULL, -- train_date
    train_no                VARCHAR(50) NOT NULL DEFAULT '',
    origin                  VARCHAR(100) NOT NULL DEFAULT '',
    destination             VARCHAR(100) NOT NULL DEFAULT '',
    seat_class              VARCHAR(50) NOT NULL DEFAULT '',
    total_capacity          INT NOT NULL DEFAULT 0,
    total_passengers        INT NOT NULL DEFAULT 0,
    avg_occupancy_rate      NUMERIC(6, 4) NOT NULL DEFAULT 0,
    total_fare              NUMERIC(14, 2) NOT NULL DEFAULT 0,
    updated_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_daily_occupancy_summary PRIMARY KEY (summary_date, train_no, origin, destination, seat_class)
);

CREATE INDEX IF NOT EXISTS idx_sum_occupancy_date ON hrts_daily_occupancy_summary (summary_date);

-- 3. Stored Procedure Refresh Summary Lengkap (Sales + Refund + Occupancy)
CREATE OR REPLACE PROCEDURE sp_refresh_daily_summary(p_target_date DATE)
LANGUAGE plpgsql
AS $$
BEGIN
    -- A. Refresh Sales Summary untuk tanggal target
    DELETE FROM hrts_daily_sales_summary WHERE summary_date = p_target_date;

    INSERT INTO hrts_daily_sales_summary (
        summary_date, departure_date, ticketing_station, origin_code,
        destination_code, train_no, seat_class, ticketing_channel,
        payment_gateway, b2b_partner, total_tickets, total_gross_amount,
        total_discount_amount, total_tax_amount, total_net_amount, updated_at
    )
    SELECT
        purchase_date AS summary_date,
        COALESCE(departure_date, purchase_date) AS departure_date,
        COALESCE(ticketing_station, '') AS ticketing_station,
        COALESCE(origin_code, '') AS origin_code,
        COALESCE(destination_code, '') AS destination_code,
        COALESCE(train_no, '') AS train_no,
        COALESCE(seat_class, '') AS seat_class,
        COALESCE(ticketing_channel, '') AS ticketing_channel,
        COALESCE(payment_gateway, '') AS payment_gateway,
        COALESCE(b2b_partner, '') AS b2b_partner,
        COUNT(*)::INT AS total_tickets,
        COALESCE(SUM(original_ticket_price), 0) AS total_gross_amount,
        COALESCE(SUM(original_ticket_price - before_tax_price), 0) AS total_discount_amount,
        COALESCE(SUM(after_tax_price - before_tax_price), 0) AS total_tax_amount,
        COALESCE(SUM(after_tax_price), 0) AS total_net_amount,
        CURRENT_TIMESTAMP AS updated_at
    FROM hrts_sales
    WHERE purchase_date = p_target_date
    GROUP BY
        purchase_date,
        COALESCE(departure_date, purchase_date),
        COALESCE(ticketing_station, ''),
        COALESCE(origin_code, ''),
        COALESCE(destination_code, ''),
        COALESCE(train_no, ''),
        COALESCE(seat_class, ''),
        COALESCE(ticketing_channel, ''),
        COALESCE(payment_gateway, ''),
        COALESCE(b2b_partner, '');

    -- B. Refresh Refund Summary untuk tanggal target
    DELETE FROM hrts_daily_refund_summary WHERE summary_date = p_target_date;

    INSERT INTO hrts_daily_refund_summary (
        summary_date, departure_date, refund_type,
        ticketing_station, refund_method, refund_state,
        total_refund_tickets, total_refund_amount,
        total_refund_charge, total_actual_refund, updated_at
    )
    SELECT
        refund_date AS summary_date,
        COALESCE(departure_date, refund_date) AS departure_date,
        COALESCE(refund_type, '') AS refund_type,
        COALESCE(ticketing_station, '') AS ticketing_station,
        COALESCE(refund_method, '') AS refund_method,
        COALESCE(refund_state, '') AS refund_state,
        COUNT(*)::INT AS total_refund_tickets,
        COALESCE(SUM(refund_amount), 0) AS total_refund_amount,
        COALESCE(SUM(refund_charge), 0) AS total_refund_charge,
        COALESCE(SUM(actual_refund_amount), 0) AS total_actual_refund,
        CURRENT_TIMESTAMP AS updated_at
    FROM hrts_refund
    WHERE refund_date = p_target_date
    GROUP BY
        refund_date,
        COALESCE(departure_date, refund_date),
        COALESCE(refund_type, ''),
        COALESCE(ticketing_station, ''),
        COALESCE(refund_method, ''),
        COALESCE(refund_state, '');

    -- C. Refresh Occupancy Summary untuk tanggal target
    DELETE FROM hrts_daily_occupancy_summary WHERE summary_date = p_target_date;

    INSERT INTO hrts_daily_occupancy_summary (
        summary_date, train_no, origin, destination, seat_class,
        total_capacity, total_passengers, avg_occupancy_rate, total_fare, updated_at
    )
    SELECT
        train_date AS summary_date,
        train_no,
        origin,
        destination,
        seat_class,
        COALESCE(SUM(capacity_per_class), 0)::INT AS total_capacity,
        COALESCE(SUM(sum_passengers), 0)::INT AS total_passengers,
        COALESCE(AVG(occupancy_rate), 0)::NUMERIC(6, 4) AS avg_occupancy_rate,
        COALESCE(SUM(total_fare), 0)::NUMERIC(14, 2) AS total_fare,
        CURRENT_TIMESTAMP AS updated_at
    FROM hrts_occupancy
    WHERE train_date = p_target_date
    GROUP BY
        train_date,
        train_no,
        origin,
        destination,
        seat_class;

END;
$$;
