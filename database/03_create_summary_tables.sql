-- =====================================================================================
-- 03_create_summary_tables.sql
-- Pembuatan Data Mart Agregasi Harian (Summary Rollup) untuk Laporan Cepat Sub-Detik
-- Database: hpr_portal
-- =====================================================================================

-- 1. Tabel Ringkasan Penjualan Harian (Sales Data Mart)
CREATE TABLE IF NOT EXISTS hrts_daily_sales_summary (
    summary_date            DATE NOT NULL, -- purchase_date
    departure_date          DATE NOT NULL,
    ticketing_station       VARCHAR(100) NOT NULL DEFAULT '',
    origin_code             VARCHAR(20) NOT NULL DEFAULT '',
    destination_code        VARCHAR(20) NOT NULL DEFAULT '',
    train_no                VARCHAR(50) NOT NULL DEFAULT '',
    seat_class              VARCHAR(50) NOT NULL DEFAULT '',
    ticketing_channel       VARCHAR(50) NOT NULL DEFAULT '',
    payment_gateway         VARCHAR(50) NOT NULL DEFAULT '',
    b2b_partner             VARCHAR(50) NOT NULL DEFAULT '',
    total_tickets           INT NOT NULL DEFAULT 0,
    total_gross_amount      NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_discount_amount   NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_tax_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_net_amount        NUMERIC(14, 2) NOT NULL DEFAULT 0,
    updated_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_daily_sales_summary PRIMARY KEY (
        summary_date, departure_date, ticketing_station, origin_code, 
        destination_code, train_no, seat_class, ticketing_channel, 
        payment_gateway, b2b_partner
    )
);

CREATE INDEX IF NOT EXISTS idx_sum_sales_date ON hrts_daily_sales_summary (summary_date);
CREATE INDEX IF NOT EXISTS idx_sum_sales_dep ON hrts_daily_sales_summary (departure_date);
CREATE INDEX IF NOT EXISTS idx_sum_sales_station ON hrts_daily_sales_summary (ticketing_station, train_no);

-- 2. Tabel Ringkasan Refund Harian (Refund Data Mart)
CREATE TABLE IF NOT EXISTS hrts_daily_refund_summary (
    summary_date            DATE NOT NULL, -- refund_date
    departure_date          DATE,
    refund_type             VARCHAR(100) NOT NULL DEFAULT '',
    ticketing_station       VARCHAR(100) NOT NULL DEFAULT '',
    refund_method           VARCHAR(50) NOT NULL DEFAULT '',
    refund_state            VARCHAR(50) NOT NULL DEFAULT '',
    total_refund_tickets    INT NOT NULL DEFAULT 0,
    total_refund_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_refund_charge     NUMERIC(14, 2) NOT NULL DEFAULT 0,
    total_actual_refund     NUMERIC(14, 2) NOT NULL DEFAULT 0,
    updated_at              TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pk_daily_refund_summary PRIMARY KEY (
        summary_date, departure_date, refund_type, 
        ticketing_station, refund_method, refund_state
    )
);

CREATE INDEX IF NOT EXISTS idx_sum_refund_date ON hrts_daily_refund_summary (summary_date);

-- 3. Stored Procedure untuk Refresh Summary Harian (Dapat dipanggil saat batch selesai)
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

END;
$$;
