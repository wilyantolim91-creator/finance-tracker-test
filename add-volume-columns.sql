-- Migration: add-volume-columns.sql
-- Deskripsi: Menambahkan kolom volume, satuan, dan harga_satuan pada tabel public.transactions.
-- Tanggal  : 2026-06-07
-- Catatan  : Jalankan script ini di Supabase Dashboard -> SQL Editor.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS volume NUMERIC DEFAULT 1,
  ADD COLUMN IF NOT EXISTS satuan TEXT DEFAULT 'ls',
  ADD COLUMN IF NOT EXISTS harga_satuan BIGINT DEFAULT 0;

COMMENT ON COLUMN public.transactions.volume IS 'Jumlah/kuantitas barang atau jasa';
COMMENT ON COLUMN public.transactions.satuan IS 'Satuan barang/jasa (misal: sak, ls, pcs, hari)';
COMMENT ON COLUMN public.transactions.harga_satuan IS 'Harga per unit/satuan';
