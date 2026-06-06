-- ============================================================
-- SYNC DATA REAL DARI GOOGLE SHEETS KE SUPABASE
-- FinTrack V1 — By Mrlims
-- Jalankan di: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Hapus transaksi lama (data dummy)
DELETE FROM transactions
WHERE project_id IN (SELECT id FROM projects WHERE name IN ('KARANTINA 59', 'MALL BSCD'));

-- Update total_kontrak sesuai data real
UPDATE projects SET total_kontrak = 79000000 WHERE name = 'KARANTINA 59';
UPDATE projects SET total_kontrak = 89000000 WHERE name = 'MALL BSCD';

-- ── KARANTINA 59 — 14 transaksi real ──────────────────────────
INSERT INTO transactions (project_id, tgl, deskripsi, masuk, keluar, kategori, kas, tujuan)
SELECT p.id, '2026-02-05', 'Perabot Lilik',           0,        800000,   'Lainnya',           'KAS WILY',  'upah'     FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-02-05', 'Beli HPL',                0,        170000,   'Material',          'KAS WILY',  'material' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-04-15', 'DP',                      54000000, 0,        'Transfer',          'KAS UTAMA', 'Kas Utama' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-04-15', 'Afiliasi ke Kas Wily',    0,        10000000, 'Transfer',          'KAS UTAMA', 'Kas Wily' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-04-15', 'Terima transfer dr UTAMA',10000000, 0,        'Transfer Internal', 'KAS WILY',  'KAS UTAMA' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-05-31', 'gaji',                    0,        110000,   'Labor',             'KAS AWEN',  'upah'     FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-05-31', 'gaji 2',                  0,        110000,   'Labor',             'KAS AWEN',  'upah'     FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2024-05-15', 'Pembelian Lem',            0,        60000,    'Material',          'KAS AWEN',  'mat'      FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2023-10-27', 'Triplek',                  0,        540000,   'Material',          'KAS AWEN',  'Supplier' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-06-11', 'Gaji tukang keramik',      0,        4000000,  'Labor',             'KAS WILY',  'upah'     FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-06-11', 'Gaji tukang keramik 2',   0,        4000000,  'Labor',             'KAS WILY',  'upah'     FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-06-01', 'Transfer dana ke Kas Awen',0,       15000000, 'Transfer',          'KAS UTAMA', 'KAS AWEN' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-06-01', 'Terima transfer dr UTAMA',15000000, 0,        'Transfer Internal', 'KAS AWEN',  'KAS UTAMA' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id, '2026-10-01', 'Triplek',                  0,        540000,   'Material',          'KAS AWEN',  'Supplier' FROM projects p WHERE p.name='KARANTINA 59';

-- ── MALL BSCD — 11 transaksi real ─────────────────────────────
INSERT INTO transactions (project_id, tgl, deskripsi, masuk, keluar, kategori, kas, tujuan)
SELECT p.id, '2026-02-05', 'Perabot Lilik',           0,        800000,   'Lainnya',           'KAS WILY',  'upah'     FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-02-05', 'Beli HPL',                0,        170000,   'Material',          'KAS WILY',  'material' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-04-15', 'DP',                      54000000, 0,        'Transfer',          'KAS UTAMA', 'Kas Utama' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-04-15', 'Afiliasi ke Kas Wily',    0,        10000000, 'Transfer',          'KAS UTAMA', 'Kas Wily' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-04-15', 'Terima transfer dr UTAMA',10000000, 0,        'Transfer Internal', 'KAS WILY',  'KAS UTAMA' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-05-31', 'gaji',                    0,        110000,   'Labor',             'KAS AWEN',  'upah'     FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-05-31', 'gaji 2',                  0,        110000,   'Labor',             'KAS AWEN',  'upah'     FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2024-05-15', 'Pembelian Lem',            0,        60000,    'Material',          'KAS AWEN',  'material' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2023-10-27', 'Triplek',                  0,        540000,   'Material',          'KAS AWEN',  'material' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-06-11', 'Gaji tukang keramik',      0,        4000000,  'Labor',             'KAS WILY',  'upah'     FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id, '2026-06-11', 'Gaji tukang keramik 2',   0,        4000000,  'Labor',             'KAS WILY',  'upah'     FROM projects p WHERE p.name='MALL BSCD';

-- Verifikasi
SELECT 'KARANTINA 59' as project, COUNT(*) as tx_count FROM transactions t JOIN projects p ON t.project_id=p.id WHERE p.name='KARANTINA 59'
UNION ALL
SELECT 'MALL BSCD', COUNT(*) FROM transactions t JOIN projects p ON t.project_id=p.id WHERE p.name='MALL BSCD';
