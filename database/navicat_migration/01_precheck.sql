-- =====================================================================================
-- 01_precheck.sql
-- Pemeriksaan Awal Sebelum Migrasi Data (Jalankan di LOCAL dan PRODUCTION via Navicat)
-- Database: hpr_portal
-- Cara pakai: Navicat > pilih koneksi > New Query > paste > Run (jalankan per blok)
-- =====================================================================================

-- [A] Identitas koneksi & versi server
--     Pastikan versi major PRODUCTION >= versi LOCAL (minimal PostgreSQL 11).
SELECT current_user, current_database(), version();

-- [B] Hak akses user saat ini (KRUSIAL di PRODUCTION)
--     can_create_in_public HARUS true. Jika false, minta DBA menjalankan:
--     GRANT USAGE, CREATE ON SCHEMA public TO <user_anda>;
SELECT
    has_database_privilege(current_database(), 'CONNECT') AS can_connect,
    has_database_privilege(current_database(), 'TEMP')    AS can_temp,
    has_schema_privilege('public', 'USAGE')               AS can_use_public,
    has_schema_privilege('public', 'CREATE')              AS can_create_in_public;

SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolconnlimit
FROM pg_roles WHERE rolname = current_user;

-- [C] Parameter sesi yang memengaruhi transfer besar
SHOW server_encoding;                     -- harus sama (UTF8) di kedua sisi
SHOW statement_timeout;                   -- 0 = tanpa batas
SHOW idle_in_transaction_session_timeout; -- 0 = tanpa batas
SHOW TimeZone;

-- [D] Ukuran database saat ini
SELECT pg_size_pretty(pg_database_size(current_database())) AS total_db_size;

-- [E] Inventaris tabel di schema public (tanpa partisi anak)
--     Di LOCAL: tentukan tabel mana yang akan dipindahkan (abaikan *_legacy).
--     Di PROD : pastikan belum ada tabel yang bentrok / berisi data.
SELECT
    c.relname                                   AS table_name,
    CASE c.relkind WHEN 'p' THEN 'PARTITIONED' WHEN 'r' THEN 'TABLE' WHEN 'v' THEN 'VIEW' END AS jenis,
    pg_get_userbyid(c.relowner)                 AS owner,
    c.reltuples::BIGINT                         AS estimasi_baris
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'v')
  AND NOT c.relispartition
ORDER BY c.relkind, c.relname;

-- [F] Jumlah & rentang partisi (bandingkan LOCAL vs PROD, harus identik)
SELECT
    parent.relname       AS parent_table,
    COUNT(*)             AS jumlah_partisi,
    MIN(child.relname)   AS partisi_pertama,
    MAX(child.relname)   AS partisi_terakhir
FROM pg_inherits i
JOIN pg_class parent ON parent.oid = i.inhparent
JOIN pg_class child  ON child.oid  = i.inhrelid
WHERE parent.relname IN ('hrts_sales', 'hrts_refund')
GROUP BY parent.relname;

-- [G] (LOCAL saja) Rentang tanggal data. Harus berada di dalam rentang partisi
--     PROD (2023-10-01 s.d. 2027-12-31), jika tidak -> error "no partition found".
SELECT 'hrts_sales'  AS tabel, MIN(purchase_date) AS tgl_min, MAX(purchase_date) AS tgl_max, COUNT(*) AS total FROM hrts_sales
UNION ALL
SELECT 'hrts_refund', MIN(refund_date), MAX(refund_date), COUNT(*) FROM hrts_refund
UNION ALL
SELECT 'hrts_occupancy', MIN(train_date), MAX(train_date), COUNT(*) FROM hrts_occupancy;
