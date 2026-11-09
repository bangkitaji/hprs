-- =====================================================================================
-- 11_create_reconciliation_tables.sql
-- Skema Tabel Modul Rekonsiliasi Otomatis (Three-Way Reconciliation Hub)
-- Database: hpr_portal
-- =====================================================================================

-- 1. Tabel Master Batch Eksekusi Rekonsiliasi
CREATE TABLE IF NOT EXISTS reconciliation_batches (
    id                             SERIAL PRIMARY KEY,
    batch_no                       VARCHAR(60) UNIQUE NOT NULL,
    start_date                     DATE NOT NULL,
    end_date                       DATE NOT NULL,
    provider_filter                VARCHAR(50) DEFAULT 'ALL',
    total_transactions             INT DEFAULT 0,
    total_matched_clean            INT DEFAULT 0,
    total_matched_pending          INT DEFAULT 0,
    total_dispute_unsettled        INT DEFAULT 0,
    total_dispute_orphan_paid      INT DEFAULT 0,
    total_dispute_amount_mismatch  INT DEFAULT 0,
    total_mw_orphan                INT DEFAULT 0,
    total_hrts_amount              NUMERIC(15, 2) DEFAULT 0,
    total_mw_amount                NUMERIC(15, 2) DEFAULT 0,
    total_pg_gross_amount          NUMERIC(15, 2) DEFAULT 0,
    total_pg_net_amount            NUMERIC(15, 2) DEFAULT 0,
    total_fee_amount               NUMERIC(15, 2) DEFAULT 0,
    total_variance_amount          NUMERIC(15, 2) DEFAULT 0,
    execution_duration_ms          INT DEFAULT 0,
    status                         VARCHAR(30) DEFAULT 'COMPLETED', -- 'RUNNING', 'COMPLETED', 'FAILED'
    created_by                     VARCHAR(100) DEFAULT 'system',
    created_at                     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index untuk mempermudah pencarian riwayat batch
CREATE INDEX IF NOT EXISTS idx_recon_batches_dates ON reconciliation_batches (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_recon_batches_created_at ON reconciliation_batches (created_at DESC);

-- 2. Tabel Rincian Transaksi Hasil Rekonsiliasi (Item-Level Discrepancy & Matches)
CREATE TABLE IF NOT EXISTS reconciliation_items (
    id                             BIGSERIAL PRIMARY KEY,
    batch_id                       INT NOT NULL REFERENCES reconciliation_batches(id) ON DELETE CASCADE,
    golden_reference               VARCHAR(100) NOT NULL, -- 30-char Whoosh booking/trade identifier
    recon_status                   VARCHAR(35) NOT NULL,
    -- 'MATCH_CLEAN'             : Ada di HRTS, MW, dan PG (Settled 100%)
    -- 'MATCH_PENDING'           : Ada di HRTS, MW, dan PG (PG status Pending)
    -- 'DISPUTE_UNSETTLED'       : Ada di HRTS & MW, tapi TIDAK ADA uang di PG (Potensi Revenue Leakage)
    -- 'DISPUTE_ORPHAN_PAID'     : Ada uang masuk di PG, tapi TIDAK ADA tiket di HRTS (Customer Dispute)
    -- 'DISPUTE_AMOUNT_MISMATCH' : Reference cocok, tapi nominal berbeda antar layer
    -- 'MW_ORPHAN'               : Hanya ada di Middleware (Failed/Aborted Route)
    
    transaction_date               DATE,
    provider                       VARCHAR(50), -- 'Xendit', 'Finnet', 'Doku QR', 'Doku All', 'Middleware Only', 'HRTS Only'
    payment_channel                VARCHAR(100),

    -- Layer 1: HRTS Ticketing Core
    has_hrts                       BOOLEAN DEFAULT FALSE,
    hrts_order_no                  VARCHAR(100),
    hrts_ticket_count              INT DEFAULT 0,
    hrts_station                   VARCHAR(100),
    hrts_amount                    NUMERIC(15, 2) DEFAULT 0,
    hrts_trade_time                TIMESTAMP WITHOUT TIME ZONE,

    -- Layer 2: Middleware Log
    has_middleware                 BOOLEAN DEFAULT FALSE,
    mw_order_id                    VARCHAR(100),
    mw_channel                     VARCHAR(100),
    mw_amount                      NUMERIC(15, 2) DEFAULT 0,
    mw_fee                         NUMERIC(15, 2) DEFAULT 0,
    mw_settlement_amount           NUMERIC(15, 2) DEFAULT 0,
    mw_transaction_time            TIMESTAMP WITHOUT TIME ZONE,

    -- Layer 3: Payment Gateway Settlement
    has_pg                         BOOLEAN DEFAULT FALSE,
    pg_trx_id                      VARCHAR(100),
    pg_gross_amount                NUMERIC(15, 2) DEFAULT 0,
    pg_fee_amount                  NUMERIC(15, 2) DEFAULT 0,
    pg_net_amount                  NUMERIC(15, 2) DEFAULT 0,
    pg_settlement_status           VARCHAR(50), -- 'SETTLED', 'PENDING', 'SUCCESS', etc.
    pg_payment_time                TIMESTAMP WITHOUT TIME ZONE,

    -- Analitik Selisih & Dispute Handling
    amount_variance                NUMERIC(15, 2) DEFAULT 0, -- hrts_amount - pg_net_amount
    resolution_status              VARCHAR(30) DEFAULT 'UNRESOLVED', -- 'UNRESOLVED', 'RESOLVED', 'IGNORED'
    resolution_notes               TEXT,
    resolved_by                    VARCHAR(100),
    resolved_at                    TIMESTAMP WITH TIME ZONE,
    created_at                     TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index performa tinggi untuk filter dan pagination
CREATE INDEX IF NOT EXISTS idx_recon_items_batch_id ON reconciliation_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_recon_items_golden_ref ON reconciliation_items (golden_reference);
CREATE INDEX IF NOT EXISTS idx_recon_items_recon_status ON reconciliation_items (recon_status);
CREATE INDEX IF NOT EXISTS idx_recon_items_date ON reconciliation_items (transaction_date);
CREATE INDEX IF NOT EXISTS idx_recon_items_provider ON reconciliation_items (provider);
CREATE INDEX IF NOT EXISTS idx_recon_items_res_status ON reconciliation_items (resolution_status);
