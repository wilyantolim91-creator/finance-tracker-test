// ================================================================
// FINTRACK V1 — Google Sheets Auto Sync ke Supabase
// By Mrlims · Creator
// Sync otomatis setiap 5 menit
// ================================================================
// CARA SETUP (lakukan SEKALI saja):
// 1. Buka Google Sheet → Extensions → Apps Script
// 2. Hapus semua kode lama → paste script ini → Save (Ctrl+S)
// 3. Pilih fungsi: setupAutoSync → klik Run
// 4. Klik Review Permissions → pilih akun Google → Allow
// 5. Selesai! Sheet sync otomatis ke Supabase setiap 5 menit
// ================================================================

const SUPABASE_URL   = 'https://derikfjxjsvhaxfqcqwb.supabase.co';
const SUPABASE_KEY   = 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC';
const PROJECT_SHEETS = ['KARANTINA 59', 'MALL BSCD'];
const TX_START_ROW   = 14;
const KONTRAK_ROW    = 4;
const KONTRAK_COL    = 5; // Kolom E

// ── STEP 1: Jalankan fungsi ini SEKALI untuk aktifkan auto sync ──
function setupAutoSync() {
  // Hapus semua trigger lama
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // Buat trigger time-based setiap 5 menit
  ScriptApp.newTrigger('syncAllToSupabase')
    .timeBased()
    .everyMinutes(5)
    .create();

  // Langsung sync sekarang
  syncAllToSupabase();

  Logger.log('✅ Auto sync aktif! Sheet akan sync ke Supabase setiap 5 menit.');
}

// ── MAIN: Sync semua data dari sheet ke Supabase ─────────────────
function syncAllToSupabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  PROJECT_SHEETS.forEach(projectName => {
    try {
      const sheet = ss.getSheetByName(projectName);
      if (!sheet) {
        Logger.log('⚠️ Sheet tidak ditemukan: ' + projectName);
        return;
      }

      // 1. Sync Total Kontrak (cell E4)
      const kontrakVal  = sheet.getRange(KONTRAK_ROW, KONTRAK_COL).getValue();
      const totalKontrak = toNumber(kontrakVal);
      if (totalKontrak > 0) {
        updateTotalKontrak(projectName, totalKontrak);
      }

      // 2. Sync semua transaksi
      const projectId = getProjectId(projectName);
      if (!projectId) {
        Logger.log('⚠️ Project tidak ditemukan di Supabase: ' + projectName);
        return;
      }

      // Hapus transaksi lama, insert yang baru dari sheet
      deleteTransactions(projectId);

      const lastRow = sheet.getLastRow();
      let count = 0;
      for (let row = TX_START_ROW; row <= lastRow; row++) {
        const data = sheet.getRange(row, 1, 1, 11).getValues()[0];
        if (!data[0] || !data[1]) continue; // Skip baris kosong
        insertTransaction(projectId, data);
        count++;
      }

      Logger.log('✅ ' + projectName + ': kontrak Rp' + totalKontrak.toLocaleString() + ' | ' + count + ' transaksi');
    } catch (err) {
      Logger.log('❌ Error ' + projectName + ': ' + err.message);
    }
  });
}

// ── Update Total Kontrak di Supabase ─────────────────────────────
function updateTotalKontrak(projectName, amount) {
  const url = SUPABASE_URL + '/rest/v1/projects?name=eq.' + encodeURIComponent(projectName);
  UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({ total_kontrak: amount })
  });
}

// ── Hapus semua transaksi project ────────────────────────────────
function deleteTransactions(projectId) {
  UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/transactions?project_id=eq.' + projectId,
    {
      method: 'DELETE',
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'return=minimal' }
    }
  );
}

// ── Insert satu baris transaksi ───────────────────────────────────
function insertTransaction(projectId, row) {
  const tgl       = toISO(row[0]);
  const deskripsi = String(row[1] || '').trim();
  const masuk     = toNumber(row[5]);
  const keluar    = toNumber(row[6]);
  const tujuan    = String(row[8] || '').trim();
  const kategori  = String(row[9] || 'Lainnya').trim();
  const kas       = String(row[10] || 'KAS UTAMA').trim();
  if (!tgl || !deskripsi) return;

  UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/transactions', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({ project_id: projectId, tgl, deskripsi, masuk, keluar, tujuan, kategori, kas })
  });
}

// ── Helper: ambil Project ID dari Supabase ────────────────────────
function getProjectId(projectName) {
  const res  = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/projects?select=id&name=eq.' + encodeURIComponent(projectName),
    { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
  );
  const data = JSON.parse(res.getContentText());
  return data.length > 0 ? data[0].id : null;
}

// ── Helper: konversi tanggal ke YYYY-MM-DD ────────────────────────
function toISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  const p = s.split('-');
  if (p.length === 3 && p[2].length === 4) {
    return p[2] + '-' + p[1].padStart(2,'0') + '-' + p[0].padStart(2,'0');
  }
  return s;
}

// ── Helper: ambil nilai angka dari cell ───────────────────────────
function toNumber(val) {
  if (!val) return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : Math.round(n);
}

// ── Cek status trigger (opsional) ────────────────────────────────
function checkTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) {
    Logger.log('⚠️ Tidak ada trigger aktif. Jalankan setupAutoSync() dulu!');
  } else {
    triggers.forEach(t => Logger.log('✅ Trigger aktif: ' + t.getHandlerFunction() + ' | ' + t.getTriggerSource()));
  }
}
