-- ============================================================
-- Migration: sync-schema-update.sql
-- Deskripsi: Menambahkan dukungan sinkronisasi 2 arah (two-way sync)
--            antara Google Sheets dan aplikasi Finance Tracker.
-- Tanggal  : 2026-06-07
-- Catatan  : File ini bersifat IDEMPOTENT — aman dijalankan berulang kali.
-- ============================================================

-- ************************************************************
-- 1. Tambah kolom sync pada tabel `transactions`
--    - sync_source : asal data ('app' atau 'sheet')
--    - sync_hash   : hash baris untuk deteksi perubahan
--    - updated_at  : waktu terakhir baris diubah (auto-update via trigger)
-- ************************************************************

-- 1a. sync_source — melacak asal entri transaksi
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'transactions'
          AND column_name  = 'sync_source'
    ) THEN
        ALTER TABLE public.transactions
            ADD COLUMN sync_source TEXT DEFAULT 'app';

        RAISE NOTICE 'Kolom sync_source berhasil ditambahkan ke transactions.';
    ELSE
        RAISE NOTICE 'Kolom sync_source sudah ada, dilewati.';
    END IF;
END
$$;

-- 1b. sync_hash — hash data baris untuk mendeteksi perubahan
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'transactions'
          AND column_name  = 'sync_hash'
    ) THEN
        ALTER TABLE public.transactions
            ADD COLUMN sync_hash TEXT;

        RAISE NOTICE 'Kolom sync_hash berhasil ditambahkan ke transactions.';
    ELSE
        RAISE NOTICE 'Kolom sync_hash sudah ada, dilewati.';
    END IF;
END
$$;

-- 1c. updated_at — waktu terakhir baris diperbarui (diisi otomatis oleh trigger)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = 'transactions'
          AND column_name  = 'updated_at'
    ) THEN
        ALTER TABLE public.transactions
            ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();

        RAISE NOTICE 'Kolom updated_at berhasil ditambahkan ke transactions.';
    ELSE
        RAISE NOTICE 'Kolom updated_at sudah ada, dilewati.';
    END IF;
END
$$;


-- ************************************************************
-- 2. Buat tabel `sync_log`
--    Mencatat setiap sesi sinkronisasi: arah, jumlah baris, waktu.
-- ************************************************************

CREATE TABLE IF NOT EXISTS public.sync_log (
    id            SERIAL        PRIMARY KEY,
    project_name  TEXT          NOT NULL,                       -- nama proyek yang disinkronkan
    direction     TEXT          NOT NULL                        -- 'sheet_to_db' atau 'db_to_sheet'
                  CHECK (direction IN ('sheet_to_db', 'db_to_sheet')),
    synced_count  INTEGER       DEFAULT 0,                     -- jumlah baris yang berhasil disinkronkan
    synced_at     TIMESTAMPTZ   DEFAULT now()                  -- waktu sinkronisasi
);

COMMENT ON TABLE  public.sync_log              IS 'Log setiap sesi sinkronisasi antara Google Sheets dan database.';
COMMENT ON COLUMN public.sync_log.direction    IS 'Arah sync: sheet_to_db (dari Sheet ke DB) atau db_to_sheet (dari DB ke Sheet).';
COMMENT ON COLUMN public.sync_log.synced_count IS 'Jumlah baris yang berhasil disinkronkan dalam sesi ini.';


-- ************************************************************
-- 3. Buat fungsi trigger `update_updated_at()`
--    Otomatis mengisi updated_at = now() setiap kali baris di-UPDATE.
-- ************************************************************

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_updated_at()
    IS 'Trigger function: otomatis set updated_at = now() pada setiap UPDATE.';


-- ************************************************************
-- 4. Buat trigger pada tabel `transactions`
--    Memanggil update_updated_at() BEFORE UPDATE.
-- ************************************************************

-- Drop dulu jika sudah ada agar definisi selalu up-to-date (idempotent)
DROP TRIGGER IF EXISTS trg_transactions_updated_at ON public.transactions;

CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON public.transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TRIGGER trg_transactions_updated_at ON public.transactions
    IS 'Auto-update kolom updated_at setiap kali baris transaksi diubah.';


-- ************************************************************
-- 5. Buat index untuk polling query yang efisien
--    Mempercepat query: WHERE sync_source = 'app' AND updated_at > ?
-- ************************************************************

CREATE INDEX IF NOT EXISTS idx_transactions_sync_source_updated_at
    ON public.transactions (sync_source, updated_at);


-- ************************************************************
-- 6. Nonaktifkan RLS pada sync_log
--    Konsisten dengan setup tabel lain yang sudah ada.
-- ************************************************************

ALTER TABLE public.sync_log DISABLE ROW LEVEL SECURITY;


-- ============================================================
-- Selesai. Migration sync-schema-update.sql berhasil dijalankan.
-- ============================================================
