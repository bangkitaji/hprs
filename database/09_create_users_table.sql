-- =====================================================================================
-- 09_create_users_table.sql
-- Pembuatan Tabel Pengguna dan Role-Based Access Control (RBAC)
-- Database: hpr_portal
-- =====================================================================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('administrator', 'user')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Seed Default Accounts:
-- 1. Administrator: username 'admin', password 'Admin@123'
-- 2. Regular User : username 'operator', password 'User@123'
INSERT INTO users (username, password_hash, full_name, role)
VALUES 
    ('admin', '$2b$10$5G8LtXidznouKJj9EgSp..X5uZbGHJ3xCp7xNIEMlt3AcH7jVfrom', 'System Administrator', 'administrator'),
    ('operator', '$2b$10$gilKbeUCT.5T4F86D4UySexW5LMxioUAXHOpkAOeVWNpEh/BsQEcK', 'Ticketing Operator', 'user')
ON CONFLICT (username) DO UPDATE 
SET 
    password_hash = EXCLUDED.password_hash,
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role,
    updated_at = CURRENT_TIMESTAMP;

COMMENT ON TABLE users IS 'Tabel pengguna portal ticketing dengan autentikasi & RBAC (administrator vs user)';

-- =====================================================================================
-- Tabel Riwayat Upload File Excel
-- =====================================================================================
CREATE TABLE IF NOT EXISTS upload_history (
    id SERIAL PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,
    sheet_name VARCHAR(100),
    target_date DATE,
    total_rows INT DEFAULT 0,
    inserted_rows INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'success',
    error_message TEXT,
    duration_ms INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upload_history_created_at ON upload_history(created_at DESC);
COMMENT ON TABLE upload_history IS 'Tabel pencatatan riwayat unggah berkas Excel dan audit trail ingestion';
