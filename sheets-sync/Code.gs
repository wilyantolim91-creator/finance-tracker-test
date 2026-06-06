// ================================================================
// FINTRACK V1 — Google Sheets → Supabase Auto Sync
// By Mrlims · Creator
// ================================================================
// CARA SETUP (lakukan sekali):
// 1. Buka Google Sheet kamu
// 2. Klik menu Extensions → Apps Script
// 3. Hapus semua isi → paste seluruh script ini
// 4. Klik Save (ikon disket)
// 5. Jalankan fungsi setupTrigger() → klik Run
// 6. Izinkan permission yang diminta
// 7. Selesai! Setiap edit di sheet akan sync otomatis ke Supabase
// ================================================================

const SUPABASE_URL   = 'https://derikfjxjsvhaxfqcqwb.supabase.co';
const SUPABASE_KEY   = 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC';
const PROJECT_SHEETS = ['KARANTINA 59', 'MALL BSCD'];
const TX_HEADER_ROW  = 13; // Baris header transaksi (Tanggal, Description, ...)
const TX_START_ROW   = 14; // Baris pertama data transaksi

// ── Setup trigger (jalankan sekali) ──────────────────────────────
function setupTrigger() {
  // Hapus trigger lama supaya tidak dobel
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  // Buat trigger onEdit baru
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  Logger.log('✅ Trigger berhasil dibuat! Setiap edit di sheet akan sync ke Supabase.');
}

// ── Auto-trigger saat ada edit di sheet ──────────────────────────
function onSheetEdit(e) {
  try {
    const sheet    = e.source.getActiveSheet();
    const sheetName = sheet.getName();
    if (!PROJECT_SHEETS.includes(sheetName)) return;

    const row = e.range.getRow();
    if (row < TX_START_ROW) return; // Bukan baris transaksi

    // Ambil data baris yang diedit
    const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
    const tanggal = rowData[0];
    if (!tanggal) return; // Baris kosong, skip

    const projectId = getProjectId(sheetName);
    if (!projectId) return;

    upsertTransaction(projectId, rowData, row);
    Logger.log('✅ Synced row ' + row + ' dari ' + sheetName);
  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
  }
}

// ── Sync SEMUA data (jalankan manual jika perlu full sync) ───────
function syncAllToSupabase() {
  PROJECT_SHEETS.forEach(projectName => {
    try {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(projectName);
      if (!sheet) { Logger.log('Sheet tidak ditemukan: ' + projectName); return; }

      const projectId = getProjectId(projectName);
      if (!projectId) { Logger.log('Project tidak ditemukan di Supabase: ' + projectName); return; }

      // Hapus semua transaksi lama project ini
      deleteProjectTransactions(projectId);

      // Insert semua transaksi dari sheet
      const lastRow   = sheet.getLastRow();
      let   inserted  = 0;
      for (let row = TX_START_ROW; row <= lastRow; row++) {
        const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
        if (!rowData[0]) continue; // Skip baris kosong
        upsertTransaction(projectId, rowData, row);
        inserted++;
      }
      Logger.log('✅ ' + projectName + ': ' + inserted + ' transaksi berhasil disync');
    } catch (err) {
      Logger.log('❌ Error sync ' + projectName + ': ' + err.message);
    }
  });
}

// ── Helper: konversi tanggal DD-MM-YYYY atau Date → YYYY-MM-DD ──
function toISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  const str = String(val).trim();
  // Handle DD-MM-YYYY or D-M-YYYY
  const parts = str.split('-');
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      // DD-MM-YYYY → YYYY-MM-DD
      return parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
    } else {
      // Sudah YYYY-MM-DD
      return str;
    }
  }
  return str;
}

// ── Helper: ambil nilai angka dari cell (bisa format Rp) ─────────
function toNumber(val) {
  if (!val || val === '' || val === 0) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : Math.round(num);
}

// ── Helper: GET project ID dari Supabase ─────────────────────────
function getProjectId(projectName) {
  const url = SUPABASE_URL + '/rest/v1/projects?select=id&name=eq.' + encodeURIComponent(projectName);
  const res  = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  const data = JSON.parse(res.getContentText());
  return data.length > 0 ? data[0].id : null;
}

// ── Helper: hapus semua transaksi project ────────────────────────
function deleteProjectTransactions(projectId) {
  const url = SUPABASE_URL + '/rest/v1/transactions?project_id=eq.' + projectId;
  UrlFetchApp.fetch(url, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'return=minimal' }
  });
}

// ── Helper: insert/update satu transaksi ─────────────────────────
function upsertTransaction(projectId, rowData, rowNumber) {
  // Kolom sheet: A=Tanggal, B=Description, C=Volume, D=Satuan, E=Nilai Satuan
  //              F=Masuk,   G=Keluar,      H=Saldo,  I=Tujuan, J=Kategori, K=Kas
  const tgl       = toISO(rowData[0]);
  const deskripsi = String(rowData[1] || '').trim();
  const masuk     = toNumber(rowData[5]);
  const keluar    = toNumber(rowData[6]);
  const tujuan    = String(rowData[8] || '').trim();
  const kategori  = String(rowData[9] || 'Lainnya').trim();
  const kas       = String(rowData[10] || 'KAS UTAMA').trim();

  if (!tgl || !deskripsi) return;

  const body = JSON.stringify({
    project_id: projectId,
    tgl: tgl,
    deskripsi: deskripsi,
    masuk: masuk,
    keluar: keluar,
    tujuan: tujuan,
    kategori: kategori,
    kas: kas
  });

  const url = SUPABASE_URL + '/rest/v1/transactions';
  UrlFetchApp.fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    payload: body
  });
}
