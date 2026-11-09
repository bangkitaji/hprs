-- =====================================================================================
-- 10_create_middleware_and_pg_tables.sql
-- Farebox Data Management — Enhancement: Middleware & Payment Gateway Tables
-- Database: hpr_portal
-- =====================================================================================

-- 1. Perbarui tabel upload_history dengan kolom kategori dan provider
ALTER TABLE IF EXISTS upload_history 
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50) DEFAULT 'hrts',
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_upload_history_source ON upload_history(source_type, provider);

-- =====================================================================================
-- 2. TABEL: middleware_transactions
-- Sumber data: File teks .txt (pemisah ||) dari sistem Middleware
-- =====================================================================================
CREATE TABLE IF NOT EXISTS middleware_transactions (
    id BIGSERIAL PRIMARY KEY,
    business_serial_number VARCHAR(64) UNIQUE NOT NULL, -- Whoosh 30-digit trade ref (1GGA...)
    middleware_serial_number VARCHAR(64),               -- UUID
    pg_serial_number VARCHAR(100),                      -- PG Ref / Approval code / Bank Ref
    middleware_transaction_time TIMESTAMP,              -- YYYYMMDDHHMMSS
    pg_transaction_time TIMESTAMP,                      -- YYYYMMDDHHMMSS
    transaction_currency VARCHAR(10) DEFAULT 'IDR',
    processing_fee NUMERIC(15, 2) DEFAULT 0,
    transaction_amount NUMERIC(15, 2) DEFAULT 0,
    settlement_amount NUMERIC(15, 2) DEFAULT 0,
    payment_gateway VARCHAR(50),                        -- Doku, Xendit, Finnet
    payment_method VARCHAR(50),                         -- QR, Virtual Account, Credit Card
    payment_channel VARCHAR(50),
    ticket_sales_channel VARCHAR(50),                   -- KAI, KCIC
    transaction_type VARCHAR(50),
    payment_bank VARCHAR(100),
    settlement_date TIMESTAMP,
    merchant_name VARCHAR(100),
    merchant_id VARCHAR(100),
    promotion_amount NUMERIC(15, 2) DEFAULT 0,
    consumer_id VARCHAR(64),
    passenger_name VARCHAR(255),
    himbara_fee NUMERIC(15, 2) DEFAULT 0,
    additional_vat NUMERIC(15, 2) DEFAULT 0,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mw_bsn ON middleware_transactions(business_serial_number);
CREATE INDEX IF NOT EXISTS idx_mw_pg_serial ON middleware_transactions(pg_serial_number);
CREATE INDEX IF NOT EXISTS idx_mw_time ON middleware_transactions(middleware_transaction_time);
CREATE INDEX IF NOT EXISTS idx_mw_pg ON middleware_transactions(payment_gateway);
COMMENT ON TABLE middleware_transactions IS 'Tabel transaksi perantara sistem middleware dengan pemisah double pipe (||)';

-- =====================================================================================
-- 3. TABEL: pg_xendit_settlements
-- Sumber data: File CSV dari Xendit (All Transactions Report)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS pg_xendit_settlements (
    id BIGSERIAL PRIMARY KEY,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    reference VARCHAR(64),                              -- Whoosh 30-digit trade ref (1GGA...)
    status VARCHAR(50),                                 -- Success, Pending
    type VARCHAR(50),                                   -- PAYMENT, Disbursement
    channel VARCHAR(50),                                -- Virtual Account, Bank
    channel_name VARCHAR(100),                          -- MANDIRI, BCA, ID_MANDIRI, dll.
    account_number VARCHAR(100),
    currency VARCHAR(10) DEFAULT 'IDR',
    amount NUMERIC(15, 2) DEFAULT 0,
    net_amount NUMERIC(15, 2) DEFAULT 0,
    invoice_id VARCHAR(100),
    batch_id VARCHAR(100),
    payment_date TIMESTAMP,
    created_timestamp TIMESTAMP,
    updated_timestamp TIMESTAMP,
    timezone VARCHAR(50),
    description TEXT,
    channel_reference VARCHAR(100),
    settlement_status VARCHAR(50),                      -- SETTLED, PENDING
    actual_settlement_time TIMESTAMP,
    estimated_settlement_time TIMESTAMP,
    product_id VARCHAR(100),
    total_fee NUMERIC(15, 2) DEFAULT 0,
    total_vat NUMERIC(15, 2) DEFAULT 0,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_xendit_ref ON pg_xendit_settlements(reference);
CREATE INDEX IF NOT EXISTS idx_xendit_tx_id ON pg_xendit_settlements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_xendit_pay_date ON pg_xendit_settlements(payment_date);
CREATE INDEX IF NOT EXISTS idx_xendit_type ON pg_xendit_settlements(type);
COMMENT ON TABLE pg_xendit_settlements IS 'Tabel transaksi settlement & disbursement payment gateway Xendit';

-- =====================================================================================
-- 4. TABEL: pg_finnet_settlements
-- Sumber data: File Excel (.xlsx) Transaksi KCIC Periode Finnet
-- =====================================================================================
CREATE TABLE IF NOT EXISTS pg_finnet_settlements (
    id BIGSERIAL PRIMARY KEY,
    trx_invoice VARCHAR(64) UNIQUE NOT NULL,            -- Whoosh 30-digit trade ref (1GGA...)
    created_at_dt TIMESTAMP,
    updated_at_dt TIMESTAMP,
    expired_at_dt TIMESTAMP,
    payment_at_dt TIMESTAMP,
    merchant_id VARCHAR(100),
    sof_desc VARCHAR(100),                              -- Kartu Kredit / Debit, BRI, dll.
    trx_currency VARCHAR(10) DEFAULT 'IDR',
    trx_amount NUMERIC(15, 2) DEFAULT 0,
    trx_amount_payment NUMERIC(15, 2) DEFAULT 0,
    trx_amount_settle NUMERIC(15, 2) DEFAULT 0,
    total_capture_amount NUMERIC(15, 2) DEFAULT 0,
    trx_desc TEXT,
    payment_status VARCHAR(50),                         -- CAPTURED, PAID
    external_trx_id VARCHAR(100),
    external_order_id VARCHAR(100),
    external_account_id VARCHAR(100),
    trigger_by VARCHAR(50),
    transaction_mode VARCHAR(50),
    payment_code VARCHAR(100),
    payment_channel VARCHAR(50),
    ref_no VARCHAR(100),                                -- Nomor referensi persetujuan bank
    meta_data TEXT,
    session_data TEXT,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finnet_invoice ON pg_finnet_settlements(trx_invoice);
CREATE INDEX IF NOT EXISTS idx_finnet_ref_no ON pg_finnet_settlements(ref_no);
CREATE INDEX IF NOT EXISTS idx_finnet_payment_at ON pg_finnet_settlements(payment_at_dt);
COMMENT ON TABLE pg_finnet_settlements IS 'Tabel transaksi settlement payment gateway Finnet (Finpay & CC/Debit)';

-- =====================================================================================
-- 5. TABEL: pg_doku_qr_settlements
-- Sumber data: File Excel (.xlsx) Report Doku QRIS (Header pada baris ke-10)
-- =====================================================================================
CREATE TABLE IF NOT EXISTS pg_doku_qr_settlements (
    id BIGSERIAL PRIMARY KEY,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    qris_transaction_id VARCHAR(64),                    -- Whoosh 30-digit trade ref (1GGA...)
    reference_number VARCHAR(100),                      -- Cocok dengan PG Serial Number di Middleware
    merchant_name VARCHAR(100),
    issuer_name VARCHAR(100),                           -- Mandiri, BCA, OCBC NISP, GOPAY, dll.
    transaction_date TIMESTAMP,
    amount NUMERIC(15, 2) DEFAULT 0,
    status VARCHAR(50),
    customer_pan VARCHAR(100),
    customer_name VARCHAR(255),
    invoice_acquirer VARCHAR(100),
    invoice_number VARCHAR(100),
    terminal_id VARCHAR(50),
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doku_qr_qris_id ON pg_doku_qr_settlements(qris_transaction_id);
CREATE INDEX IF NOT EXISTS idx_doku_qr_ref_no ON pg_doku_qr_settlements(reference_number);
CREATE INDEX IF NOT EXISTS idx_doku_qr_tx_date ON pg_doku_qr_settlements(transaction_date);
COMMENT ON TABLE pg_doku_qr_settlements IS 'Tabel transaksi QRIS settlement dari payment gateway DOKU';

-- =====================================================================================
-- 6. TABEL: pg_doku_all_settlements
-- Sumber data: File CSV Export Doku All Data
-- =====================================================================================
CREATE TABLE IF NOT EXISTS pg_doku_all_settlements (
    id BIGSERIAL PRIMARY KEY,
    invoice_number VARCHAR(64) UNIQUE NOT NULL,         -- Whoosh 30-digit trade ref (1GGA...)
    transaction_date TIMESTAMP,
    amount NUMERIC(15, 2) DEFAULT 0,
    payment_method VARCHAR(100),
    status VARCHAR(50),
    activity VARCHAR(50),
    payment_type VARCHAR(100),
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    brand_id VARCHAR(100),
    acquirer_name VARCHAR(100),
    mid VARCHAR(100),
    tid VARCHAR(100),
    tenor VARCHAR(50),
    issuing_bank VARCHAR(100),
    approval_code VARCHAR(100),
    order_number VARCHAR(100),
    card_masked VARCHAR(50),
    bank_batch_number VARCHAR(100),
    bank_settlement_date VARCHAR(100),
    payment_number VARCHAR(100),
    response_code VARCHAR(50),
    response_message VARCHAR(255),
    additional_info TEXT,
    request_id VARCHAR(100),
    card_expiry_date VARCHAR(50),
    billing_number VARCHAR(100),
    brand_name VARCHAR(100),
    promo_code VARCHAR(100),
    total_amount NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    paid_amount NUMERIC(15, 2) DEFAULT 0,
    card_holder_name VARCHAR(255),
    reference_number VARCHAR(100),
    cashback_amount NUMERIC(15, 2) DEFAULT 0,
    source_file VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_doku_all_inv ON pg_doku_all_settlements(invoice_number);
CREATE INDEX IF NOT EXISTS idx_doku_all_date ON pg_doku_all_settlements(transaction_date);
CREATE INDEX IF NOT EXISTS idx_doku_all_method ON pg_doku_all_settlements(payment_method);
COMMENT ON TABLE pg_doku_all_settlements IS 'Tabel transaksi komprehensif DOKU All (Virtual Account, Card, QRIS, dll.)';

