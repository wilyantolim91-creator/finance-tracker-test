-- Migration: enable-realtime.sql
-- Deskripsi: Mengaktifkan Supabase Realtime Broadcasting untuk sinkronisasi otomatis ke Frontend
-- Tanggal  : 2026-06-08
-- Catatan  : Jalankan script ini di Supabase Dashboard -> SQL Editor.

-- Tambahkan tabel ke dalam publication supabase_realtime agar React App bisa me-listen perubahan data
ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
ALTER PUBLICATION supabase_realtime ADD TABLE projects;
