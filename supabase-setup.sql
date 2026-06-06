-- FinTrack Supabase Setup
-- Jalankan seluruh script ini di: Supabase Dashboard → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS users (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password text NOT NULL,
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text UNIQUE NOT NULL,
  total_kontrak bigint NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_projects (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  tgl date NOT NULL,
  deskripsi text NOT NULL DEFAULT '',
  masuk bigint NOT NULL DEFAULT 0,
  keluar bigint NOT NULL DEFAULT 0,
  kategori text NOT NULL DEFAULT 'Lainnya',
  kas text NOT NULL DEFAULT 'KAS UTAMA',
  tujuan text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

-- Nonaktifkan RLS (keamanan dijaga lewat Vercel env vars yang tidak dipublish)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;

-- ── SEED DATA ──

INSERT INTO users (username, password, role) VALUES
  ('admin', 'admin123', 'admin'),
  ('staff', 'staff123', 'staff')
ON CONFLICT (username) DO NOTHING;

INSERT INTO projects (name, total_kontrak) VALUES
  ('KARANTINA 59', 79000000),
  ('MALL BSCD', 89000000)
ON CONFLICT (name) DO NOTHING;

INSERT INTO user_projects (user_id, project_id)
SELECT u.id, p.id FROM users u, projects p
WHERE u.username = 'staff' AND p.name = 'KARANTINA 59'
ON CONFLICT DO NOTHING;

-- Transaksi KARANTINA 59
INSERT INTO transactions (project_id, tgl, deskripsi, masuk, keluar, kategori, kas, tujuan)
SELECT p.id,'2026-04-15','DP dari klien',54000000,0,'Transfer','KAS UTAMA','Kas Utama' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-04-15','Afiliasi ke Kas Wily',0,10000000,'Transfer','KAS UTAMA','Kas Wily' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-04-15','Terima transfer dr UTAMA',10000000,0,'Transfer Internal','KAS WILY','KAS UTAMA' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-06-01','Transfer ke Kas Awen',0,15000000,'Transfer','KAS UTAMA','KAS AWEN' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-06-01','Terima transfer dr UTAMA',15000000,0,'Transfer Internal','KAS AWEN','KAS UTAMA' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-02-05','Beli HPL',0,170000,'Material','KAS WILY','Supplier' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-02-05','Upah pasang HPL',0,800000,'Upah','KAS WILY','Tukang' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-06-11','Gaji tukang keramik',0,4000000,'Upah','KAS WILY','Tukang Keramik' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-06-11','Gaji tukang keramik 2',0,4000000,'Upah','KAS WILY','Tukang Keramik' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-05-20','Pembelian lem & triplek',0,1140000,'Material','KAS AWEN','Supplier' FROM projects p WHERE p.name='KARANTINA 59' UNION ALL
SELECT p.id,'2026-05-31','Upah harian',0,220000,'Upah','KAS AWEN','Tukang' FROM projects p WHERE p.name='KARANTINA 59';

-- Transaksi MALL BSCD
INSERT INTO transactions (project_id, tgl, deskripsi, masuk, keluar, kategori, kas, tujuan)
SELECT p.id,'2026-04-15','DP',54000000,0,'Transfer','KAS UTAMA','Kas Utama' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-04-15','Afiliasi ke Kas Wily',0,10000000,'Transfer','KAS UTAMA','Kas Wily' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-04-15','Terima transfer dr UTAMA',10000000,0,'Transfer Internal','KAS WILY','KAS UTAMA' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-02-05','Perabot Lilik',0,800000,'Lainnya','KAS WILY','upah' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-02-05','Beli HPL',0,170000,'Material','KAS WILY','Supplier' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-05-31','gaji',0,110000,'Upah','KAS AWEN','upah' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-05-31','gaji 2',0,110000,'Upah','KAS AWEN','upah' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-05-15','Pembelian Lem',0,60000,'Material','KAS AWEN','Supplier' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-10-27','Triplek',0,540000,'Material','KAS AWEN','Supplier' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-06-11','Gaji tukang keramik',0,4000000,'Upah','KAS WILY','Tukang Keramik' FROM projects p WHERE p.name='MALL BSCD' UNION ALL
SELECT p.id,'2026-06-11','Gaji tukang keramik 2',0,4000000,'Upah','KAS WILY','Tukang Keramik' FROM projects p WHERE p.name='MALL BSCD';
