// ================================================================
// FINTRACK V1 — Google Sheets → Supabase Auto Sync
// By Mrlims · Creator
// ================================================================
// CARA SETUP (lakukan sekali):
// 1. Buka Google Sheet → Extensions → Apps Script
// 2. Hapus semua → paste script ini → Save
// 3. Pilih fungsi setupTrigger → Run → Allow permission
// ================================================================

const SUPABASE_URL   = 'https://derikfjxjsvhaxfqcqwb.supabase.co';
const SUPABASE_KEY   = 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC';
const PROJECT_SHEETS = ['KARANTINA 59', 'MALL BSCD'];
const TX_START_ROW   = 14; // Baris pertama data transaksi
const TOTAL_KONTRAK_COL = 5; // Kolom E = Total Kontrak (row 4)
const TOTAL_KONTRAK_ROW = 4;

// ── Setup trigger ─────────────────────────────────────────────
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();
  Logger.log('✅ Trigger aktif! Setiap edit di sheet akan sync ke Supabase.');
}

// ── Auto-trigger saat ada edit ────────────────────────────────
function onSheetEdit(e) {
  try {
    const sheet     = e.source.getActiveSheet();
    const sheetName = sheet.getName();
    if (!PROJECT_SHEETS.includes(sheetName)) return;

    const row = e.range.getRow();
    const col = e.range.getColumn();

    // Sync total kontrak jika cell E4 diedit
    if (row === TOTAL_KONTRAK_ROW && col === TOTAL_KONTRAK_COL) {
      syncTotalKontrak(sheet, sheetName);
      return;
    }

    // Sync transaksi jika baris >= 14
    if (row >= TX_START_ROW) {
      const projectId = getProjectId(sheetName);
      if (!projectId) return;
      const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
      if (!rowData[0]) return;
      upsertTransaction(projectId, rowData);
      Logger.log('✅ Synced row ' + row + ' - ' + sheetName);
    }
  } catch (err) {
    Logger.log('❌ Error: ' + err.message);
  }
}

// ── Sync Total Kontrak ke Supabase ────────────────────────────
function syncTotalKontrak(sheet, sheetName) {
  const val = sheet.getRange(TOTAL_KONTRAK_ROW, TOTAL_KONTRAK_COL).getValue();
  const totalKontrak = toNumber(val);
  if (!totalKontrak) return;

  const url = SUPABASE_URL + '/rest/v1/projects?name=eq.' + encodeURIComponent(sheetName);
  UrlFetchApp.fetch(url, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    payload: JSON.stringify({ total_kontrak: totalKontrak })
  });
  Logger.log('✅ Total Kontrak ' + sheetName + ' → Rp ' + totalKontrak.toLocaleString());
}

// ── Sync SEMUA data (jalankan manual untuk full sync) ─────────
function syncAllToSupabase() {
  PROJECT_SHEETS.forEach(projectName => {
    try {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(projectName);
      if (!sheet) return;

      // Sync Total Kontrak
      syncTotalKontrak(sheet, projectName);

      // Sync transaksi
      const projectId = getProjectId(projectName);
      if (!projectId) return;
      deleteProjectTransactions(projectId);

      const lastRow = sheet.getLastRow();
      let inserted  = 0;
      for (let row = TX_START_ROW; row <= lastRow; row++) {
        const rowData = sheet.getRange(row, 1, 1, 11).getValues()[0];
        if (!rowData[0]) continue;
        upsertTransaction(projectId, rowData);
        inserted++;
      }
      Logger.log('✅ ' + projectName + ': Total Kontrak + ' + inserted + ' transaksi synced');
    } catch (err) {
      Logger.log('❌ Error ' + projectName + ': ' + err.message);
    }
  });
}

// ── Helper: konversi tanggal → YYYY-MM-DD ─────────────────────
function toISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'UTC', 'yyyy-MM-dd');
  }
  const str = String(val).trim();
  const parts = str.split('-');
  if (parts.length === 3 && parts[2].length === 4) {
    return parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
  }
  return str;
}

// ── Helper: konversi nilai ke angka ──────────────────────────
function toNumber(val) {
  if (!val) return 0;
  const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : Math.round(num);
}

// ── Helper: ambil project ID dari Supabase ───────────────────
function getProjectId(projectName) {
  const url = SUPABASE_URL + '/rest/v1/projects?select=id&name=eq.' + encodeURIComponent(projectName);
  const res = UrlFetchApp.fetch(url, {
    method: 'GET',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  const data = JSON.parse(res.getContentText());
  return data.length > 0 ? data[0].id : null;
}

// ── Helper: hapus semua transaksi project ────────────────────
function deleteProjectTransactions(projectId) {
  const url = SUPABASE_URL + '/rest/v1/transactions?project_id=eq.' + projectId;
  UrlFetchApp.fetch(url, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'return=minimal' }
  });
}

// ── Helper: insert satu transaksi ────────────────────────────
function upsertTransaction(projectId, rowData) {
  const tgl       = toISO(rowData[0]);
  const deskripsi = String(rowData[1] || '').trim();
  const masuk     = toNumber(rowData[5]);
  const keluar    = toNumber(rowData[6]);
  const tujuan    = String(rowData[8] || '').trim();
  const kategori  = String(rowData[9] || 'Lainnya').trim();
  const kas       = String(rowData[10] || 'KAS UTAMA').trim();
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
