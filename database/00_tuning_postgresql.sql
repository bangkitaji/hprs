-- =====================================================================================
-- 00_tuning_postgresql.sql
-- Optimasi Konfigurasi PostgreSQL untuk Server HRTS (RAM 24GB, 16 CPU Cores, NVMe/SSD)
-- Database: hpr_portal
-- =====================================================================================

-- 1. Memory Buffers (Optimalisasi RAM 24GB)
-- shared_buffers: 25% dari total RAM (Default postgres 128MB sangat kecil)
ALTER SYSTEM SET shared_buffers = '6GB';

-- effective_cache_size: Estimasi total memori yang tersedia untuk caching oleh OS dan PostgreSQL
ALTER SYSTEM SET effective_cache_size = '18GB';

-- work_mem: Memori untuk operasi sorting / hash agregasi per operasi query
-- 64MB mencegah query laporan 14 juta baris tumpah (spill) ke disk temp files
ALTER SYSTEM SET work_mem = '64MB';

-- maintenance_work_mem: Memori untuk VACUUM, CREATE INDEX, ALTER TABLE ADD FOREIGN KEY
ALTER SYSTEM SET maintenance_work_mem = '1GB';

-- 2. Storage & Optimizer Cost (Untuk NVMe / Fast SSD)
-- Nilai default 4.0 adalah untuk harddisk mekanis putar (HDD). SSD memiliki random access cepat.
ALTER SYSTEM SET random_page_cost = 1.1;

-- 3. Paralelisme Query (Memaksimalkan 16 CPU Cores)
ALTER SYSTEM SET max_worker_processes = 16;
ALTER SYSTEM SET max_parallel_workers = 16;
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_maintenance_workers = 4;

-- 4. Checkpoint & Write-Ahead Logging (WAL)
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;

-- 5. Reload konfigurasi untuk parameter yang dinamis
SELECT pg_reload_conf();

-- CATATAN:
-- Parameter 'shared_buffers' memerlukan 1x restart service PostgreSQL untuk aktif.
-- Di Windows PowerShell (Run as Administrator):
-- Restart-Service postgresql-x64-16
