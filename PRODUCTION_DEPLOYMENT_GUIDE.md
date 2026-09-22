# PANDUAN DEPLOYMENT PRODUCTION: ARSITEKTUR DATABASE & NGINX SHARED HOSTING
### FAREBOX DATA MANAGEMENT — Whoosh High Speed Railway
**Platform:** PostgreSQL 14 / 15 / 16 • Node.js Express • Nginx Reverse Proxy (Multi-Tenant / Shared Server)  
**Karakteristik Data:** ~20.000 records/hari (~7,3 juta records/tahun, ~2,7 GB/tahun)  
**Fokus Solusi:** Range Partitioning Bulanan, BRIN & B-Tree Indexing, Summary Data Mart, Nginx Multi-Stack Isolation, PM2 Cluster Management.

---

## 1. RINGKASAN ARSITEKTUR

Untuk menjamin performa query laporan manajemen tetap cepat (< 10 milidetik) dan database stabil hingga 5–10 tahun ke depan, arsitektur baru menggunakan struktur 4 pilar:

1. **Table Partitioning Bulanan (Declarative Range Partitioning)**:
   - Tabel `hrts_sales` dipartisi bulanan berdasarkan `purchase_date`.
   - Tabel `hrts_refund` dipartisi bulanan berdasarkan `refund_date`.
   - **Manfaat:** *Partition Pruning* membatasi scan disk hanya pada bulan yang diminta laporan (misal: query laporan September 2026 hanya memindai ~600k baris dalam partisi `hrts_sales_2026_09`, mengabaikan 14+ juta baris lainnya).
2. **Kombinasi Index Ringan (BRIN + B-Tree)**:
   - **BRIN Index** pada kolom tanggal (`purchase_date`, `departure_date`, `refund_date`). Ukuran index BRIN sangat kecil (hanya puluhan Kilobyte) sehingga sangat hemat RAM dan I/O disk.
   - **B-Tree Index** pada kolom pencarian spesifik (`ticket_no`, `order_no`, dan kolom pelaporan `ticketing_station`, `train_no`).
3. **Data Mart Agregasi Harian (`daily_sales_summary` & `daily_refund_summary`)**:
   - Menyimpan pra-agregasi harian berdasarkan dimensi stasiun, kereta, kelas, channel, dan payment gateway.
   - Dashboard laporan bulanan/tahunan membaca tabel summary yang hanya berisi ratusan baris, bukan jutaan baris data mentah.
4. **Sanitasi Skema & Penamaan Standar**:
   - Kolom diubah menjadi format standar `snake_case` tanpa spasi atau tanda baca.
   - Tipe data tanggal dan waktu menggunakan tipe asli PostgreSQL (`DATE`, `TIME`, `TIMESTAMP`).

---

## 2. CHECKLIST PRA-DEPLOYMENT (PRE-REQUISITES)

Sebelum mengeksekusi di server production, pastikan kriteria berikut terpenuhi:

* [ ] **Cek Ukuran & Estimasi Storage Database**:
  - Data mentah sales saat ini: ~5,5 GB; refund: ~0,5 GB.
  - Saat proses migrasi, tabel lama dan tabel baru akan berdampingan sementara (memerlukan ruang tambahan ~6–8 GB).
  - **Jika punya akses OS server:** Cek partisi disk bebas minimal 15–20 GB (`df -h`).
  - **Jika HANYA punya akses database:** Jalankan query berikut di DBeaver/pgAdmin untuk memeriksa ukuran saat ini:
    ```sql
    SELECT pg_size_pretty(pg_database_size(current_database())) AS total_db_size;
    SELECT pg_size_pretty(pg_total_relation_size('hrts_sales')) AS sales_size,
           pg_size_pretty(pg_total_relation_size('hrts_refund')) AS refund_size;
    ```
* [ ] **Backup Database**:
  - **Opsi A (Via DBeaver / pgAdmin di Komputer Lokal):**
    - *DBeaver:* Klik kanan database `hpr_portal` ➔ **Tools** ➔ **Backup Database** ➔ Simpan file `.dump` di komputer lokal.
    - *pgAdmin:* Klik kanan database `hpr_portal` ➔ **Backup...** ➔ Pilih format *Custom*.
  - **Opsi B (Via Remote CLI dari Mesin Lokal / Web Server):**
    ```bash
    pg_dump -h <host_database> -p 5432 -U <user_database> -d hpr_portal -Fc -f "backup_hpr_portal_pre_migration.dump"
    ```
* [ ] **Waktu Eksekusi (Maintenance Window)**:
  - Waktu migrasi 14,7 juta baris membutuhkan waktu sekitar **6 – 12 menit**.
  - Pilih jadwal saat tidak ada proses import harian yang sedang aktif (misal pukul 23:00 – 04:00 WIB).

---

## 3. PANDUAN EKSEKUSI STEP-BY-STEP DI PRODUCTION

> [!IMPORTANT]
> **PILIHAN JALUR EKSEKUSI BERDASARKAN HAK AKSES ANDA:**
> - **JALUR 1 (HANYA AKSES DATABASE):** Jika Anda **TIDAK BISA** SSH / remote desktop ke server database (misal: AWS RDS, Cloud SQL, atau database dikelola tim DBA). Seluruh script SQL dijalankan melalui **SQL Client (DBeaver, pgAdmin, DataGrip)** dari komputer Anda.
> - **JALUR 2 (AKSES SERVER OS PENUH):** Jika Anda memiliki akses terminal / PowerShell langsung di server database.

Seluruh script DDL dan migrasi telah tersedia di folder `d:\project\hpr\database\`:

```
d:\project\hpr\database\
├── 00_tuning_postgresql.sql
├── 01_create_partitioned_sales.sql
├── 02_create_partitioned_refund.sql
├── 03_create_summary_tables.sql
├── 04_migrate_data.sql
├── 05_switch_tables.sql
├── 06_daily_ingestion_sample.sql
├── 07_create_views_compatibility.sql
├── 08_create_occupancy_tables.sql
├── 09_create_users_table.sql
└── run_migration.ps1
```

---

### Langkah 1: Tuning Parameter PostgreSQL

#### Jika HANYA Punya Akses Database (Tanpa Akses OS / Bukan Superuser):
Anda tidak bisa mengedit file `postgresql.conf` atau merestart service database. Namun, Anda **TIDAK PERLU RESTART SERVER**! Cukup atur parameter **di tingkat sesi (Session-Level)** pada tab SQL Editor DBeaver/pgAdmin Anda sebelum menjalankan migrasi:

```sql
-- Jalankan di awal sesi SQL Editor DBeaver / pgAdmin:
SET work_mem = '128MB';                          -- Mempercepat sort & aggregation di RAM
SET maintenance_work_mem = '1GB';                -- Mempercepat pembuatan index partisi
SET max_parallel_workers_per_gather = 4;         -- Memanfaatkan paralel CPU
SET random_page_cost = 1.1;                      -- Optimasi scan SSD/NVMe
```
*(Parameter ini langsung aktif untuk tab query Anda dan otomatis kembali default saat koneksi ditutup. Jika database dikelola DBA, Anda bisa mengajukan perubahan permanen `shared_buffers = 6GB` kepada tim DBA / via Cloud Console).*

#### Jika Memiliki Akses Server OS Penuh:
Jalankan script tuning menggunakan `psql` dan restart service:
```powershell
$env:PGPASSWORD='password_production'
& psql -U postgres -h localhost -d hpr_portal -f "d:\project\hpr\database\00_tuning_postgresql.sql"
Restart-Service postgresql-x64-16
```

---

### Langkah 2: Pembuatan Tabel Master Berpartisi & Summary Mart

#### Jika HANYA Punya Akses Database (DBeaver / pgAdmin):
Buka tab **SQL Editor** yang terhubung ke database `hpr_portal`, lalu buka dan eksekusi file berikut secara berurutan:
1. Buka isi file [`01_create_partitioned_sales.sql`](database/01_create_partitioned_sales.sql) ➔ Klik **Execute Script (Alt+X)**.
2. Buka isi file [`02_create_partitioned_refund.sql`](database/02_create_partitioned_refund.sql) ➔ Klik **Execute Script (Alt+X)**.
3. Buka isi file [`03_create_summary_tables.sql`](database/03_create_summary_tables.sql) ➔ Klik **Execute Script (Alt+X)**.

#### Jika Melalui Server OS / Terminal:
```powershell
& psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\01_create_partitioned_sales.sql"
& psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\02_create_partitioned_refund.sql"
& psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\03_create_summary_tables.sql"
```

---

### Langkah 3: Eksekusi Migrasi Data Historis (Zero Data Loss)

#### Jika HANYA Punya Akses Database (DBeaver / pgAdmin):
Buka file [`04_migrate_data.sql`](database/04_migrate_data.sql) di DBeaver / pgAdmin. File ini telah dipisah menjadi blok batch yang aman dan idempoten:
1. **Batch 1 (2023 H2):** Blok query baris 16–37 ➔ Tekan **Ctrl+Enter**. *(Selesai ~20 detik)*
2. **Batch 2 (2024 H1):** Blok query baris 40–61 ➔ Tekan **Ctrl+Enter**. *(Selesai ~2 menit)*
3. **Batch 3 (2024 H2):** Blok query baris 64–85 ➔ Tekan **Ctrl+Enter**. *(Selesai ~2 menit)*
4. **Batch 4 (2025 H1):** Blok query baris 88–109 ➔ Tekan **Ctrl+Enter**. *(Selesai ~2 menit)*
5. **Batch 5 (2025 H2):** Blok query baris 112–133 ➔ Tekan **Ctrl+Enter**. *(Selesai ~2 menit)*
6. **Batch 6 (2026 s.d. Sekarang):** Blok query baris 136–157 ➔ Tekan **Ctrl+Enter**. *(Selesai ~1 menit)*
7. **Refund (Semua Data):** Blok query baris 161–189 ➔ Tekan **Ctrl+Enter**. *(Selesai ~40 detik)*

*Keuntungan menjalankan per batch di DBeaver: Anda dapat memantau status commit per semester tanpa takut transaksi dibatalkan karena timeout koneksi jaringan.*

#### Jika Melalui Script Runner PowerShell (dari Laptop / Mesin Kerja):
Edit baris koneksi `$psql` dan `-h <ip_host_database>` di file [`run_migration.ps1`](database/run_migration.ps1), lalu jalankan:
```powershell
& powershell.exe -ExecutionPolicy Bypass -File "d:\project\hpr\database\run_migration.ps1"
```

---

### Langkah 4: Validasi Integritas Data (Data Checksum)

Jalankan query validasi untuk memastikan data 100% identik antara tabel lama dan tabel baru:

```sql
-- 1. Validasi Jumlah Baris
SELECT 
    (SELECT count(*) FROM hrts_sales) AS old_sales_count,
    (SELECT count(*) FROM hrts_sales_p) AS new_sales_count,
    (SELECT count(*) FROM hrts_refund) AS old_refund_count,
    (SELECT count(*) FROM hrts_refund_p) AS new_refund_count;

-- 2. Validasi Akumulasi Finansial (Rupiah Checksum)
SELECT 
    (SELECT SUM("Original Ticket Price") FROM hrts_sales) AS old_sales_revenue,
    (SELECT SUM(original_ticket_price) FROM hrts_sales_p) AS new_sales_revenue,
    (SELECT SUM("Refund Amount") FROM hrts_refund) AS old_refund_total,
    (SELECT SUM(refund_amount) FROM hrts_refund_p) AS new_refund_total;
```
*(Pastikan selisihnya adalah 0).*

---

### Langkah 5: Pengalihan Nama Tabel (Table Switch)

Jika validasi berhasil, ubah nama tabel partisi baru menjadi tabel utama:
- **Di DBeaver / pgAdmin:** Buka file [`05_switch_tables.sql`](database/05_switch_tables.sql) ➔ Klik **Execute Script (Alt+X)**.
- **Via Terminal:**
  ```powershell
  & psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\05_switch_tables.sql"
  ```
*Tabel lama akan otomatis berubah menjadi `hrts_sales_legacy` dan `hrts_refund_legacy` (tersimpan utuh sebagai backup).*

---

### Langkah 6: Pembuatan View Kompatibilitas Warisan (Legacy Views)

Jika aplikasi atau script lama masih membutuhkan nama kolom dengan spasi (`"Passenger Name"`, `"Order No."`):
- **Di DBeaver / pgAdmin:** Buka file [`07_create_views_compatibility.sql`](database/07_create_views_compatibility.sql) ➔ Klik **Execute Script (Alt+X)**.
- **Via Terminal:**
  ```powershell
  & psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\07_create_views_compatibility.sql"
  ```
Aplikasi lama dapat membaca view `v_hrts_sales_legacy_compat` tanpa perlu mengubah kode SQL lama seketika.

---

### Langkah 7: Backfill Data Mart Laporan Harian

Jalankan pengisian data historis ke tabel `hrts_daily_sales_summary` dan `hrts_daily_refund_summary`:
```sql
-- Backfill seluruh summary sales historis
INSERT INTO hrts_daily_sales_summary (
    summary_date, departure_date, ticketing_station, origin_code,
    destination_code, train_no, seat_class, ticketing_channel,
    payment_gateway, b2b_partner, total_tickets, total_gross_amount,
    total_discount_amount, total_tax_amount, total_net_amount
)
SELECT
    purchase_date,
    COALESCE(departure_date, purchase_date),
    COALESCE(ticketing_station, ''),
    COALESCE(origin_code, ''),
    COALESCE(destination_code, ''),
    COALESCE(train_no, ''),
    COALESCE(seat_class, ''),
    COALESCE(ticketing_channel, ''),
    COALESCE(payment_gateway, ''),
    COALESCE(b2b_partner, ''),
    COUNT(*)::INT,
    COALESCE(SUM(original_ticket_price), 0),
    COALESCE(SUM(original_ticket_price - before_tax_price), 0),
    COALESCE(SUM(after_tax_price - before_tax_price), 0),
    COALESCE(SUM(after_tax_price), 0)
FROM hrts_sales
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10
ON CONFLICT (summary_date, departure_date, ticketing_station, origin_code, 
             destination_code, train_no, seat_class, ticketing_channel, 
             payment_gateway, b2b_partner) DO NOTHING;

-- Backfill seluruh summary refund historis
INSERT INTO hrts_daily_refund_summary (
    summary_date, departure_date, refund_type,
    ticketing_station, refund_method, refund_state,
    total_refund_tickets, total_refund_amount,
    total_refund_charge, total_actual_refund
)
SELECT
    refund_date,
    departure_date,
    COALESCE(refund_type, ''),
    COALESCE(ticketing_station, ''),
    COALESCE(refund_method, ''),
    COALESCE(refund_state, ''),
    COUNT(*)::INT,
    COALESCE(SUM(refund_amount), 0),
    COALESCE(SUM(refund_charge), 0),
    COALESCE(SUM(actual_refund_amount), 0)
FROM hrts_refund
GROUP BY 1, 2, 3, 4, 5, 6
ON CONFLICT (summary_date, departure_date, refund_type, 
             ticketing_station, refund_method, refund_state) DO NOTHING;
```

---

### Langkah 8: Pembuatan Tabel Okupansi Kereta & Master Procedure

Inisialisasi tabel okupansi `hrts_occupancy`, tabel summary harian `hrts_daily_occupancy_summary`, serta stored procedure pembaruan agregasi terpadu:
- **Di DBeaver / pgAdmin:** Buka file [`08_create_occupancy_tables.sql`](database/08_create_occupancy_tables.sql) ➔ Klik **Execute Script (Alt+X)**.
- **Via Terminal / psql:**
  ```powershell
  & psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\08_create_occupancy_tables.sql"
  ```
*Stored procedure `sp_refresh_daily_summary(p_target_date)` akan otomatis mengagregasi data Sales, Refund, dan Okupansi secara konsisten.*

---

### Langkah 9: Pembuatan Tabel Pengguna & Autentikasi RBAC

Inisialisasi tabel pengguna `users` dan pembuatan akun default (Administrator & Operator):
- **Di DBeaver / pgAdmin:** Buka file [`09_create_users_table.sql`](database/09_create_users_table.sql) ➔ Klik **Execute Script (Alt+X)**.
- **Via Terminal / psql:**
  ```powershell
  & psql -U <user> -h <host> -d hpr_portal -f "d:\project\hpr\database\09_create_users_table.sql"
  ```
*Akun default yang terbentuk:*
- **Administrator:** username `admin`, password `Admin@123`
- **Operator:** username `operator`, password `User@123`
*(Sangat disarankan segera mengganti password default setelah login pertama kali di portal).*

---

## 4. INTEGRASI BATCH HARIAN (DAILY INGESTION SOP)

Untuk menjamin injeksi harian ~20.000 data berjalan cepat dan tidak terjadi duplikasi:

1. **Gunakan Klausa `ON CONFLICT` (Upsert Idempoten)**:
   ```sql
   INSERT INTO hrts_sales (order_no, ticket_no, purchase_date, ...)
   VALUES (...)
   ON CONFLICT (order_no, ticket_no, purchase_date)
   DO UPDATE SET 
       after_tax_price = EXCLUDED.after_tax_price,
       payment_gateway = EXCLUDED.payment_gateway,
       ticketing_channel = EXCLUDED.ticketing_channel;
   ```
2. **Panggil Stored Procedure Refresh Summary**:
   Di akhir script import batch harian, panggil:
   ```sql
   CALL sp_refresh_daily_summary(CURRENT_DATE - INTERVAL '1 day');
   CALL sp_refresh_daily_summary(CURRENT_DATE);
   ```

---

## 5. RENCANA ROLLBACK (CONTINGENCY PLAN)

Jika terjadi kendala tak terduga selama masa uji coba di production:
1. Kembalikan tabel asli dalam hitungan detik:
   ```sql
   ALTER TABLE IF EXISTS hrts_sales RENAME TO hrts_sales_optimized;
   ALTER TABLE IF EXISTS hrts_refund RENAME TO hrts_refund_optimized;

   ALTER TABLE IF EXISTS hrts_sales_legacy RENAME TO hrts_sales;
   ALTER TABLE IF EXISTS hrts_refund_legacy RENAME TO hrts_refund;
   ```
2. Sistem akan seketika kembali ke kondisi sebelum migrasi tanpa kehilangan data apapun.

---

## 6. PEMELIHARAAN JANGKA PANJANG (MAINTENANCE)

1. **Pembuatan Partisi Baru Otomatis**:
   Partisi yang dibuat mencakup hingga **Desember 2027**. Di akhir tahun 2027, jalankan script untuk menambahkan partisi tahun berikutnya (2028 dst).
2. **Pengarsipan Data Lama (Data Archiving)**:
   Jika data di atas 5 tahun ingin diarsipkan ke storage dingin:
   ```sql
   -- Lepas partisi tanpa mengganggu tabel utama
   ALTER TABLE hrts_sales DETACH PARTITION hrts_sales_2023_10;
   
   -- Dump partisi tersebut ke file terkompresi
   -- pg_dump -t hrts_sales_2023_10 ...
   
   -- Hapus partisi lama setelah dibackup
   DROP TABLE hrts_sales_2023_10;
   ```

---

## 7. DEPLOYMENT PADA SERVER NGINX MULTI-TENANT (SHARED DENGAN STACK LAIN)

Bagian ini merupakan panduan operasional wajib jika server Nginx digunakan bersama (*shared host*) untuk berbagai macam aplikasi dengan teknologi/stack yang berbeda (misalnya berdampingan dengan PHP/Laravel-FPM, Python/Django/FastAPI, Go binary, Java Spring Boot, atau aplikasi Node.js lainnya).

### 7.1. Prinsip Isolasi Multi-Stack (Zero-Conflict Architecture)

Agar aplikasi **FAREBOX DATA MANAGEMENT** berjalan berdampingan tanpa mengganggu atau terganggu oleh aplikasi lain di server:

1. **Isolasi Port Localhost (Pencegahan Port Conflict)**:
   - Node.js backend hanya melakukan bind ke IP internal `127.0.0.1` (bukan `0.0.0.0`).
   - Tentukan port unik (default: `3000`). Jika port `3000` telah digunakan oleh stack lain, ubah ke port alternatif (misal: `5050`, `5051`, atau `8090`) di file `.env` dan `ecosystem.config.js`.
   - Cek ketersediaan port di Linux sebelum menjalankan:
     ```bash
     sudo ss -tulpn | grep -E ':(3000|5050)'
     ```

2. **Isolasi User & Hak Akses Linux**:
   - **JANGAN** jalankan Node.js sebagai user `root`.
   - **JANGAN** menggunakan user `www-data` (user default PHP/Nginx) untuk menjalankan proses Node.js, agar permission file dan environment variabel terisolasi.
   - Buat user khusus aplikasi:
     ```bash
     sudo useradd -m -s /bin/bash fareboxapp
     sudo chown -R fareboxapp:fareboxapp /var/www/farebox
     ```

3. **Isolasi File Environment (`.env`)**:
   - Amankan file credential database dan JWT:
     ```bash
     chmod 600 /var/www/farebox/.env
     ```

4. **Isolasi Logging**:
   - File log akses dan error Nginx wajib dipisahkan ke file tersendiri (`/var/log/nginx/farebox_access.log` dan `/var/log/nginx/farebox_error.log`), bukan ke log default Nginx server.

---

### 7.2. Konfigurasi Nginx Virtual Host (Server Block)

Template konfigurasi siap pakai telah disediakan di file [`nginx-farebox.conf`](nginx-farebox.conf).

#### Opsi A: Menggunakan Subdomain / Domain Terpisah (SANGAT DIREKOMENDASIKAN)
Menggunakan subdomain (misal: `farebox.kcic.co.id`) memberikan isolasi terbaik terhadap static path, websocket, SSL certificate, dan cookie session.

1. Salin konfigurasi ke direktori Nginx:
   ```bash
   sudo cp /var/www/farebox/nginx-farebox.conf /etc/nginx/sites-available/farebox.conf
   ```
2. Sesuaikan `server_name` dan path root di `/etc/nginx/sites-available/farebox.conf`:
   ```nginx
   upstream farebox_backend {
       server 127.0.0.1:3000;
       keepalive 32;
   }

   server {
       listen 80;
       server_name farebox.kcic.co.id;

       access_log /var/log/nginx/farebox_access.log combined;
       error_log  /var/log/nginx/farebox_error.log warn;

       # PENTING: Batas upload file Excel berukuran besar (100MB)
       # Default Nginx adalah 1MB (mencegah error 413 Payload Too Large)
       client_max_body_size 100M;

       # PENTING: Timeout khusus untuk pemrosesan file Excel 20.000+ baris
       # Mencegah error 504 Gateway Timeout saat ingestion berlangsung
       proxy_connect_timeout 60s;
       proxy_send_timeout    300s;
       proxy_read_timeout    300s;
       send_timeout          300s;

       # Header Keamanan
       add_header X-Content-Type-Options "nosniff" always;
       add_header X-Frame-Options "SAMEORIGIN" always;
       add_header X-XSS-Protection "1; mode=block" always;

       # Optimasi Static Assets: Disajikan langsung oleh Nginx (Meringankan Event Loop Node)
       location ~* \.(?:css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2)$ {
           root /var/www/farebox/public;
           expires 7d;
           add_header Cache-Control "public, no-transform";
           access_log off;
           try_files $uri @proxy_backend;
       }

       # Proxy ke Backend Node.js
       location / {
           try_files $uri @proxy_backend;
       }

       location @proxy_backend {
           proxy_pass http://farebox_backend;
           proxy_http_version 1.1;

           proxy_set_header Host              $host;
           proxy_set_header X-Real-IP         $remote_addr;
           proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Upgrade           $http_upgrade;
           proxy_set_header Connection        "upgrade";

           # Nonaktifkan buffering untuk upload streaming yang stabil
           proxy_buffering off;
           proxy_request_buffering off;
       }
   }
   ```
3. Aktifkan virtual host dan reload Nginx:
   ```bash
   sudo ln -s /etc/nginx/sites-available/farebox.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

#### Opsi B: Menggunakan Subpath pada Domain Utama (Alternatif jika tanpa Subdomain)
Jika aplikasi harus berada di subpath (misal: `https://portal-utama.kcic.co.id/farebox/`):
Tambahkan blok lokasi berikut di dalam `server { ... }` domain utama Anda:

```nginx
location /farebox/ {
    # Batas upload dan timeout khusus
    client_max_body_size 100M;
    proxy_read_timeout 300s;
    proxy_connect_timeout 60s;

    # Rewrite path ke backend Node.js
    proxy_pass http://127.0.0.1:3000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

---

### 7.3. Manajemen Proses Node.js dengan PM2 (Cluster Mode)

File konfigurasi PM2 telah tersedia di [`ecosystem.config.js`](ecosystem.config.js).

1. **Instalasi PM2 secara Global**:
   ```bash
   sudo npm install -g pm2
   ```

2. **Jalankan Aplikasi dalam Mode Cluster**:
   ```bash
   cd /var/www/farebox
   pm2 start ecosystem.config.js --env production
   ```
   *Mode kluster ini otomatis memanfaatkan multi-core CPU dan mendistribusikan beban secara zero-downtime.*

3. **Simpan Status agar Otomatis Berjalan saat Server Reboot**:
   ```bash
   pm2 save
   pm2 startup systemd -u fareboxapp --hp /home/fareboxapp
   ```
   *(Jalankan perintah sudo yang dihasilkan oleh output PM2 di layar).*

4. **Perintah Monitoring PM2**:
   ```bash
   pm2 status farebox-portal     # Melihat status CPU, RAM, & Uptime
   pm2 logs farebox-portal       # Melihat live console logs
   pm2 reload farebox-portal     # Zero-downtime reload setelah update kode
   ```

---

### 7.4. Konfigurasi SSL/TLS HTTPS (Let's Encrypt / Certbot)

Pada server bersama, pasang SSL khusus untuk subdomain Farebox tanpa menyentuh sertifikat aplikasi lain:

```bash
sudo certbot --nginx -d farebox.kcic.co.id
```
Certbot akan otomatis menambahkan konfigurasi HTTPS (port 443) dan redirect HTTP -> HTTPS di file `/etc/nginx/sites-available/farebox.conf`.

---

### 7.5. Troubleshooting Khusus Server Bersama (Multi-Stack Gotchas)

| Gejala Error | Akar Masalah | Solusi |
| :--- | :--- | :--- |
| **`413 Request Entity Too Large`** | Nginx menolak file Excel yang diunggah karena ukuran melebihi limit default Nginx (1 MB). | Pastikan `client_max_body_size 100M;` telah diset di dalam blok `server` atau `location` Farebox. Jalankan `sudo nginx -t && sudo systemctl reload nginx`. |
| **`504 Gateway Timeout`** | Proses parsing Excel puluhan ribu baris melebihi default timeout Nginx (60 detik). | Tambahkan `proxy_read_timeout 300s;` dan `proxy_send_timeout 300s;` pada konfigurasi Nginx Farebox. |
| **`502 Bad Gateway`** | Nginx tidak dapat menghubungi backend Node.js. | 1. Cek apakah PM2 berjalan: `pm2 status`.<br>2. Cek apakah port di Nginx (`127.0.0.1:3000`) sama persis dengan `PORT` di `.env` / `ecosystem.config.js`.<br>3. Cek log error backend: `pm2 logs farebox-portal --err`. |
| **Port Conflict (`EADDRINUSE`)** | Port yang dipilih (misal 3000) sudah dipakai oleh aplikasi lain (Python/Go/PHP/Node lain). | Cari aplikasi pemakai port: `sudo ss -tulpn \| grep :3000`. Ganti port Farebox ke port lain (misal 5050) di file `.env`, `ecosystem.config.js`, dan `upstream` Nginx. |
| **Permission Denied (`uploads/`)** | User Node.js tidak memiliki izin menulis file upload Excel sementara. | Jalankan: `sudo chown -R fareboxapp:fareboxapp /var/www/farebox/uploads && chmod -R 775 /var/www/farebox/uploads`. |
| **Client IP selalu terbaca `127.0.0.1`** | Express belum mempercayai reverse proxy Nginx. | Pastikan `app.set('trust proxy', 1);` telah aktif di `src/app.js` (sudah terpasang secara default). |

---

## 8. PANDUAN DEPLOYMENT: KONDISI HANYA AKSES DATABASE (TANPA AKSES SERVER OS)

Bagian ini merupakan panduan operasional khusus apabila **Database PostgreSQL berada dalam satu server tersendiri (atau server terpusat/managed database KCIC/cloud)** di mana:
1. **Anda HANYA diberikan kredensial akses database** (`Host/IP`, `Port 5432`, `Database Name`, `Username`, `Password`).
2. **Anda TIDAK MEMILIKI akses ke sistem operasi (OS) server database tersebut** (tidak ada SSH, tidak ada Remote Desktop/RDP, tidak ada root/sudo, tidak bisa membuka terminal host database, dan tidak bisa mengakses disk/filesystem server database).
3. **Aplikasi Node.js Express + Nginx berjalan di server aplikasi Anda sendiri** (App Server / VPS Web / Local Staging / Cloud Instance).

---

### 8.1. Arsitektur Topologi: App Server vs Database Server

Dalam skenario ini, arsitektur terpisah secara fisik menjadi dua komponen:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [SERVER 1: SERVER APLIKASI (APP SERVER)]                                  │
│ Hak Akses: Penuh (SSH / Terminal / Root / Nginx / PM2 / Filesystem)       │
│                                                                           │
│  [User Browser]                                                           │
│         │                                                                 │
│         ▼                                                                 │
│   Nginx (Port 80 / 443)                                                   │
│         │                                                                 │
│         ▼                                                                 │
│   Node.js Express / PM2 Cluster (Port 3000)                               │
│     ├── Static assets disajikan dari disk App Server                      │
│     ├── File Excel diunggah ke /var/www/farebox/uploads (Disk App Server) │
│     └── Parsing xlsx di-buffer di memori RAM App Server                   │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                         Koneksi TCP/IP Port 5432
                      (Kredensial User Database Saja)
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ [SERVER 2: SERVER DATABASE POSTGRESQL (DB SERVER)]                        │
│ Hak Akses: HANYA LEVEL DATABASE (No SSH, No RDP, No Terminal, No OS)      │
│                                                                           │
│  PostgreSQL Engine (Port 5432)                                            │
│     ├── Menerima query INSERT batch, SELECT laporan, UPDATE dari App Svr  │
│     ├── Menjalankan Stored Procedure (sp_refresh_daily_summary)           │
│     └── Menyimpan data partisi bulanan (hrts_sales_p, hrts_refund_p)      │
└───────────────────────────────────────────────────────────────────────────┘
```

> [!NOTE]
> **Mengapa Arsitektur Ini Sangat Aman & Praktis?**
> - **Komputasi Berat Berada di App Server:** Parsing file Excel puluhan ribu baris memakan CPU & RAM di App Server, sehingga tidak membebani server database.
> - **Tidak Butuh File System DB:** Aplikasi Farebox mengirim data dalam bentuk query SQL batch (`INSERT ... VALUES (...), (...) ON CONFLICT`), sehingga **TIDAK PERNAH** membutuhkan perintah `COPY FROM '/path'` lokal di server database.

---

### 8.2. Checklist Pra-Koneksi & Verifikasi Jaringan (Network Pre-Flight)

Sebelum memulai deployment aplikasi, pastikan komputer Anda dan App Server dapat menjangkau port PostgreSQL (5432) di DB Server.

#### 1. Uji Konektivitas Port TCP 5432
Jalankan uji koneksi dari server aplikasi (atau komputer deployer):

- **Dari Linux / App Server:**
  ```bash
  nc -zv <IP_HOST_DATABASE> 5432
  # atau jika nc belum terinstall:
  timeout 3 bash -c "</dev/tcp/<IP_HOST_DATABASE>/5432" && echo "✅ Port 5432 Terbuka" || echo "❌ Port 5432 Tertutup"
  ```
- **Dari Windows / Mesin Deployer:**
  ```powershell
  Test-NetConnection -ComputerName <IP_HOST_DATABASE> -Port 5432
  # Pastikan hasilnya: TcpTestSucceeded : True
  ```

#### 2. Penanganan Jika Port 5432 Berada di Jaringan Private / Bastion
Jika server database berada dalam private subnet KCIC dan tidak dapat diakses langsung dari IP publik:
- **Metode A: Gunakan VPN Perusahaan (Corporate VPN)**
  Pastikan App Server atau mesin kerja Anda telah tersambung ke VPN KCIC sehingga IP private database (misal `192.168.x.x` atau `10.x.x.x`) dapat di-ping dan port 5432 terbuka.
- **Metode B: SSH Bastion Tunnel (Port Forwarding)**
  Jika ada satu server perantara (bastion/jump host) yang memiliki akses SSH:
  ```bash
  # Forward port 5432 dari App Server ke Server Database lewat Bastion:
  ssh -N -f -L 5432:<IP_PRIVATE_DB>:5432 user@<IP_BASTION>
  ```
  Di konfigurasi `.env`, cukup gunakan: `DB_HOST=127.0.0.1` dan `DB_PORT=5432`.
- **Metode C: DBeaver SSH Tunnel (Untuk Administrasi DB)**
  Di DBeaver: Klik kanan koneksi ➔ **Edit Connection** ➔ Tab **SSH** ➔ Centang **Use SSH Tunnel** ➔ Masukkan host/user Bastion. Port database tetap `5432`.

#### 3. Penanganan Enkripsi SSL/TLS Database (`DB_SSL`)
Jika server database mewajibkan SSL (misal database cloud AWS RDS / Azure / Google Cloud SQL):
- Di file `.env`, ubah:
  ```env
  DB_SSL=true
  ```
  *(Aplikasi telah dikonfigurasi di `src/config/database.js` untuk otomatis mengaktifkan enkripsi SSL/TLS aman jika flag ini aktif).*

---

### 8.3. Verifikasi Hak Akses User Database (DB-Level Permissions)

Karena Anda bukan superuser `postgres` dan tidak memiliki akses OS ke server database, user database Anda wajib memiliki privilese minimal untuk membuat skema, tabel, view, dan function/procedure.

Buka **DBeaver / pgAdmin**, jalankan query diagnosa berikut:

```sql
-- 1. Periksa siapa user yang sedang aktif dan atribut role
SELECT current_user, session_user, current_database();

SELECT rolname, rolsuper, rolcreaterole, rolcreatedb 
FROM pg_roles 
WHERE rolname = current_user;

-- 2. Periksa hak akses pembuatan objek pada skema public
SELECT 
    has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables;
```

#### Solusi Jika `can_create_tables` bernilai `FALSE`:
Pada **PostgreSQL 15 ke atas**, hak akses `CREATE` pada schema `public` dicabut secara default untuk non-superuser demi keamanan. Jika saat membuat tabel muncul pesan:  
`ERROR: permission denied for schema public`

Kirimkan permohonan singkat berikut kepada Tim DBA / Sysadmin pemilik server database:
```sql
-- Dijalankan oleh DBA / Superuser di server database:
GRANT USAGE, CREATE ON SCHEMA public TO <user_database_anda>;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO <user_database_anda>;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO <user_database_anda>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO <user_database_anda>;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO <user_database_anda>;
```

---

### 8.4. Optimasi & Tuning Database Tanpa Akses OS (No `postgresql.conf`, No Restart)

Keterbatasan utama tanpa akses server OS adalah Anda **tidak bisa mengedit file `postgresql.conf`** dan **tidak bisa merestart service PostgreSQL**. Namun, Anda memiliki 3 strategi ampuh:

#### Strategi 1: Tuning Tingkat Database / Role (Permanen Tanpa Restart)
Jika user database Anda memiliki privilese `ALTER DATABASE` atau `ALTER ROLE`, jalankan perintah SQL ini sekali saja melalui DBeaver/pgAdmin:

```sql
-- Berlaku otomatis untuk SETIAP koneksi ke database hpr_portal secara permanen:
ALTER DATABASE hpr_portal SET work_mem = '64MB';
ALTER DATABASE hpr_portal SET maintenance_work_mem = '1GB';
ALTER DATABASE hpr_portal SET random_page_cost = 1.1;
ALTER DATABASE hpr_portal SET max_parallel_workers_per_gather = 4;
ALTER DATABASE hpr_portal SET statement_timeout = '300s'; -- Mencegah query macet lebih dari 5 menit
```
*(Perintah ini langsung disimpan di katalog sistem database dan aktif untuk koneksi berikutnya tanpa perlu menyentuh file konfigurasi ataupun merestart server).*

#### Strategi 2: Tuning Tingkat Sesi (Session-Level) Saat Eksekusi DDL / Migrasi
Sebelum Anda menjalankan script migrasi data besar di tab SQL DBeaver / pgAdmin, tempelkan perintah ini di baris teratas:

```sql
SET work_mem = '128MB';           -- Mempercepat kalkulasi agregasi & sort di RAM
SET maintenance_work_mem = '1GB'; -- Mempercepat indexing partisi 14+ juta baris
SET random_page_cost = 1.1;       -- Optimasi I/O SSD
```

#### Strategi 3: Template Pengajuan Parameter Global ke Tim DBA
Jika server database dikelola oleh Tim DBA KCIC, berikan formulir tiket optimasi berikut untuk diatur pada `postgresql.conf` server:
```
Kepada Yth: Tim Database Administrator (DBA)
Perihal  : Permohonan Penyesuaian Parameter Global PostgreSQL untuk DB hpr_portal

Mohon bantuan untuk memperbarui parameter global pada postgresql.conf berikut:
1. shared_buffers = 6GB (Alokasi 25% RAM server untuk buffer pool)
2. effective_cache_size = 18GB (Perkiraan cache disk OS & DB)
3. max_connections = 150 (Mencegah kehabisan koneksi jika dipakai bersama)
4. wal_buffers = 16MB
5. checkpoint_completion_target = 0.9
```

---

### 8.5. Eksekusi Skema & Migrasi Jarak Jauh (Remote DDL Execution)

Seluruh inisialisasi tabel, partisi, view, dan stored procedure dijalankan langsung dari **DBeaver / pgAdmin** di komputer Anda (atau via `psql` remote dari App Server).

#### Urutan Eksekusi Wajib (Jalankan Secara Berurutan):

| No | File SQL | Fungsi / Tujuan | Estimasi Waktu |
| :---: | :--- | :--- | :---: |
| **1** | [`01_create_partitioned_sales.sql`](database/01_create_partitioned_sales.sql) | Membuat tabel partisi master `hrts_sales_p` beserta partisi bulanan 2023–2027 dan index BRIN + B-Tree. | ~5 detik |
| **2** | [`02_create_partitioned_refund.sql`](database/02_create_partitioned_refund.sql) | Membuat tabel partisi master `hrts_refund_p` beserta partisi bulanan dan index. | ~5 detik |
| **3** | [`03_create_summary_tables.sql`](database/03_create_summary_tables.sql) | Membuat tabel data mart harian `hrts_daily_sales_summary` & `hrts_daily_refund_summary`. | ~2 detik |
| **4** | [`04_migrate_data.sql`](database/04_migrate_data.sql) *(Jika ada data lama)* | Memindahkan data dari tabel legacy ke tabel partisi baru secara bertahap (per semester). | ~6–10 menit |
| **5** | [`05_switch_tables.sql`](database/05_switch_tables.sql) | Mengubah tabel lama menjadi `_legacy` dan tabel baru menjadi `hrts_sales` & `hrts_refund`. | ~2 detik |
| **6** | [`07_create_views_compatibility.sql`](database/07_create_views_compatibility.sql) | Membuat view kompatibilitas `v_hrts_sales_legacy_compat` untuk query dengan spasi kolom lama. | ~2 detik |
| **7** | [`08_create_occupancy_tables.sql`](database/08_create_occupancy_tables.sql) | Membuat tabel okupansi kereta, summary okupansi, dan stored procedure `sp_refresh_daily_summary`. | ~3 detik |
| **8** | [`09_create_users_table.sql`](database/09_create_users_table.sql) | Membuat tabel RBAC pengguna dan akun default (`admin` & `operator`). | ~2 detik |

#### Tips Khusus Migrasi Data Historis Jarak Jauh (Langkah 4):
> [!WARNING]
> **JANGAN JALANKAN SELURUH FILE `04_migrate_data.sql` SEKALIGUS MELALUI KONEKSI JARAK JAUH / VPN!**  
> Lonjakan latensi jaringan atau VPN disconnect dapat memutus transaksi dan memicu *rollback* seluruh 14 juta data.
>
> **Praktik Terbaik:**
> 1. Di DBeaver, buka [`04_migrate_data.sql`](database/04_migrate_data.sql).
> 2. Sorot (highlight) blok **Batch 1 (2023 H2)** ➔ Tekan **Ctrl+Enter**. Tunggu selesai dan ter-commit.
> 3. Lanjutkan ke **Batch 2 (2024 H1)**, lalu **Batch 3**, dan seterusnya.
> 4. Setiap batch independen dan idempoten (`ON CONFLICT DO NOTHING`). Jika koneksi putus di tengah Batch 3, Anda cukup mengulang Batch 3 tanpa mengulang Batch 1 dan 2.

#### Eksekusi Otomatis via Remote CLI (Alternatif jika dari Linux App Server):
Jika Anda berada di terminal App Server yang memiliki `psql`:
```bash
export PGPASSWORD="<password_database>"
DB_HOST="<ip_host_database>"
DB_USER="<user_database>"
DB_NAME="hpr_portal"

for file in \
  "01_create_partitioned_sales.sql" \
  "02_create_partitioned_refund.sql" \
  "03_create_summary_tables.sql" \
  "05_switch_tables.sql" \
  "07_create_views_compatibility.sql" \
  "08_create_occupancy_tables.sql" \
  "09_create_users_table.sql"
do
  echo "Executing $file..."
  psql -h $DB_HOST -p 5432 -U $DB_USER -d $DB_NAME -f "/var/www/farebox/database/$file"
done
```

---

### 8.6. Konfigurasi Aplikasi Node.js di App Server

Di server aplikasi tempat Node.js Express berjalan (`/var/www/farebox`), sesuaikan file `.env`:

```env
# ==============================================================================
# KONFIGURASI PRODUCTION (SERVER APLIKASI TERPISAH DARI DATABASE)
# ==============================================================================
PORT=3000
NODE_ENV=production

# Arahkan ke IP / Domain Server Database PostgreSQL
DB_HOST=192.168.10.50
DB_PORT=5432
DB_NAME=hpr_portal
DB_USER=farebox_user
DB_PASSWORD=PasswordKuatDatabase123!

# Connection Pool Tuning (Penting untuk Shared Database)
DB_MAX_CONNECTIONS=15
DB_SSL=false

# Upload & Keamanan
MAX_UPLOAD_SIZE_MB=100
JWT_SECRET=FareboxSecretKeyWhoosh2026ProductionSecured!
JWT_EXPIRES_IN=8h
```

#### Aturan Ukuran Connection Pool (`DB_MAX_CONNECTIONS`):
Karena server database mungkin digunakan bersama oleh aplikasi lain (PHP, Python, atau database lain di host tersebut):
- Jika menggunakan PM2 Cluster dengan **2 worker**, total koneksi adalah: `2 instance x 15 pool = 30 koneksi`.
- Jangan menyetel `DB_MAX_CONNECTIONS` terlalu besar (misal 50–100), agar tidak menghabiskan slot `max_connections` server PostgreSQL.
- Aplikasi sudah dilengkapi `idleTimeoutMillis: 30000` (koneksi idle otomatis dilepas setelah 30 detik).

---

### 8.7. Otomatisasi Backup & Maintenance Tanpa Akses OS Database

Karena Anda tidak memiliki akses `crontab` di server database, seluruh penjadwalan pemeliharaan dilakukan secara remote dari **App Server**.

#### 1. Remote Database Backup Otomatis (Cron di App Server)
Buat script backup di App Server:

```bash
sudo mkdir -p /var/backups/farebox-db
sudo chown -R fareboxapp:fareboxapp /var/backups/farebox-db
nano /home/fareboxapp/backup_remote_db.sh
```

Isi file `/home/fareboxapp/backup_remote_db.sh`:
```bash
#!/bin/bash
# Script Backup Otomatis Remote PostgreSQL Farebox
BACKUP_DIR="/var/backups/farebox-db"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/hpr_portal_${TIMESTAMP}.dump"

export PGPASSWORD="<password_database>"
DB_HOST="<ip_host_database>"
DB_USER="<user_database>"
DB_NAME="hpr_portal"

# Jalankan dump terkompresi secara remote
pg_dump -h $DB_HOST -p 5432 -U $DB_USER -d $DB_NAME -Fc -f "$BACKUP_FILE"

# Hapus backup yang lebih tua dari 14 hari (rotasi disk)
find $BACKUP_DIR -type f -name "hpr_portal_*.dump" -mtime +14 -delete
```

Beri izin eksekusi dan daftarkan ke crontab user `fareboxapp`:
```bash
chmod +x /home/fareboxapp/backup_remote_db.sh
crontab -e
```
Tambahkan baris berikut (berjalan setiap hari pukul 02:00 WIB dini hari):
```cron
0 2 * * * /home/fareboxapp/backup_remote_db.sh >> /var/log/farebox_backup.log 2>&1
```

#### 2. Otomatisasi Refresh Data Mart Summary Harian
Stored procedure `sp_refresh_daily_summary` dapat dipanggil secara otomatis setiap malam setelah batch sales & refund selesai:
Tambahkan di crontab App Server (pukul 01:00 WIB):
```cron
0 1 * * * PGPASSWORD='<password>' psql -h <ip_host_db> -U <user_db> -d hpr_portal -c "CALL sp_refresh_daily_summary(CURRENT_DATE - INTERVAL '1 day'); CALL sp_refresh_daily_summary(CURRENT_DATE);" >> /var/log/farebox_refresh.log 2>&1
```

---

### 8.8. Monitoring Kesehatan & Kapasitas Database Secara Remote (Tanpa Akses OS)

Anda tidak perlu membuka terminal SSH server DB atau menjalankan `df -h` dan `top`. Seluruh metrik vital dapat dipantau melalui query SQL di **DBeaver / pgAdmin**:

#### 1. Memeriksa Penggunaan Kapasitas Storage Database & Tabel
```sql
-- Cek ukuran total database hpr_portal:
SELECT pg_size_pretty(pg_database_size('hpr_portal')) AS total_database_size;

-- Cek 10 tabel / partisi dengan ukuran disk terbesar:
SELECT 
    relname AS table_name,
    pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
    pg_size_pretty(pg_relation_size(c.oid)) AS table_data_size,
    pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 10;
```

#### 2. Memeriksa Koneksi Aktif & Sisa Slot Koneksi
```sql
-- Cek jumlah koneksi aktif berdasarkan state:
SELECT state, count(*) 
FROM pg_stat_activity 
WHERE datname = 'hpr_portal' 
GROUP BY state;

-- Cek batas maksimum koneksi server:
SHOW max_connections;
```

#### 3. Deteksi Query yang Sedang Berjalan Lambat / Terkunci (Locks)
```sql
-- Menampilkan query yang sedang berjalan lebih dari 10 detik:
SELECT 
    pid,
    usename,
    client_addr,
    now() - query_start AS duration,
    state,
    query
FROM pg_stat_activity
WHERE state != 'idle' 
  AND (now() - query_start) > INTERVAL '10 seconds'
ORDER BY duration DESC;
```

#### 4. Membatalkan Query yang Macet / Hang (Tanpa Membutuhkan `kill -9` di OS):
Jika ada query pelaporan besar yang menggantung dan mengunci tabel:
```sql
-- Batalkan query secara elegan (graceful cancel):
SELECT pg_cancel_backend(<pid_yang_macet>);

-- Jika query tidak merespons cancel, putus koneksinya (force terminate):
SELECT pg_terminate_backend(<pid_yang_macet>);
```

---

### 8.9. Matriks Troubleshooting Khusus Akses Database-Only

| Gejala Error | Akar Masalah | Solusi Tindakan (Tanpa Akses OS) |
| :--- | :--- | :--- |
| **`ECONNREFUSED` / `Connection refused`** | Port 5432 di host database tidak dapat dijangkau dari App Server. | 1. Cek firewall jaringan/router KCIC.<br>2. Hubungi Sysadmin server database untuk memastikan `listen_addresses = '*'` aktif di `postgresql.conf` dan port 5432 terbuka di iptables/ufw/Windows Firewall.<br>3. Gunakan SSH Bastion Tunnel jika database berada di private subnet. |
| **`FATAL: no pg_hba.conf entry for host ...`** | IP App Server belum diizinkan oleh PostgreSQL untuk melakukan koneksi remote. | Hubungi DBA untuk menambahkan baris berikut di `pg_hba.conf` server DB:<br>`host hpr_portal <user_db> <IP_APP_SERVER>/32 scram-sha-256`<br>Lalu minta DBA menjalankan `SELECT pg_reload_conf();` (tidak perlu restart server). |
| **`FATAL: remaining connection slots are reserved for superuser`** | Seluruh kuota koneksi database habis karena pool aplikasi lain atau aplikasi belum menutup koneksi idle. | 1. Turunkan `DB_MAX_CONNECTIONS` di `.env` (misal dari 20 ke 10).<br>2. Periksa query koneksi idle lewat DBeaver dan terminasi koneksi hantu dengan `SELECT pg_terminate_backend(pid);`.<br>3. Minta DBA menaikkan `max_connections`. |
| **`ERROR: permission denied for schema public`** | User database bukan superuser dan izin pembuatan objek dicabut (umum di PostgreSQL 15+). | Minta DBA menjalankan perintah:<br>`GRANT ALL ON SCHEMA public TO <user_db>;` |
| **`canceling statement due to statement timeout`** | Query migrasi data historis atau pembuatan index melebihi batas waktu maksimal yang ditentukan server. | Jalankan `SET statement_timeout = 0;` di tab SQL Editor DBeaver Anda sebelum mengeksekusi script migrasi. |
| **`password authentication failed for user`** | Password salah atau metode hashing password tidak cocok (md5 vs scram-sha-256). | Pastikan karakter spesial pada password di file `.env` tidak terpotong (gunakan tanda kutip tunggal jika ada simbol). |
| **`Server closed the connection unexpectedly` (SSL required)** | Server database mewajibkan koneksi terenkripsi SSL. | Aktifkan `DB_SSL=true` di file `.env` App Server. |

