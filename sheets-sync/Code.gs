// ============================================================================
// FinTrack — Sinkronisasi 2 Arah antara Google Sheets & Supabase
// ============================================================================
// File ini menangani sinkronisasi data transaksi antara Google Sheets
// (sebagai antarmuka pengguna) dan Supabase (sebagai database utama).
//
// Fitur utama:
//   1. Sinkronisasi instan saat sel diedit (onEdit trigger)
//   2. Sinkronisasi berkala setiap 1 menit (time-based trigger)
//   3. Deteksi sheet proyek baru secara otomatis
//   4. Deteksi perubahan berbasis hash untuk efisiensi
//   5. Pemetaan UUID di kolom L untuk relasi stabil Sheet ↔ Supabase
//   6. Mekanisme kunci (lock) untuk mencegah konflik sinkronisasi
// ============================================================================

// ---------------------------------------------------------------------------
// KONSTANTA
// ---------------------------------------------------------------------------

/** URL basis Supabase REST API */
const SUPABASE_URL = 'https://derikfjxjsvhaxfqcqwb.supabase.co';

/** Kunci publik (anon/publishable) Supabase */
const SUPABASE_KEY = 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC';

/** Baris awal data transaksi di setiap sheet proyek */
const TX_START_ROW = 14;

/** Baris yang berisi nilai Total Kontrak */
const KONTRAK_ROW = 4;

/** Kolom yang berisi nilai Total Kontrak (E = 5) */
const KONTRAK_COL = 5;

/** Baris yang berisi nilai DP Masuk */
const DP_MASUK_ROW = 5;

/** Kolom yang berisi nilai DP Masuk (E = 5) */
const DP_MASUK_COL = 5;

/** Kolom tersembunyi untuk menyimpan UUID Supabase (L = 12) */
const ID_COL = 12;

/** Kolom tersembunyi untuk menyimpan hash data baris (M = 13) */
const HASH_COL = 13;

/** Daftar nama sheet yang BUKAN sheet proyek — akan dilewati */
const SKIP_SHEETS = ['Summary', 'Template', 'Config', 'Dashboard', 'Rekap'];

/** Batas waktu otomatis pelepasan kunci sinkronisasi (dalam milidetik) */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 menit

// ---------------------------------------------------------------------------
// Cache sederhana untuk project ID (berlaku selama satu eksekusi skrip)
// ---------------------------------------------------------------------------
const _projectCache = {};

// ============================================================================
// 1. SETUP — Pemasangan Trigger Otomatis
// ============================================================================

/**
 * Memasang semua trigger yang diperlukan dan menjalankan sinkronisasi awal.
 * Panggil fungsi ini SATU KALI secara manual dari editor Apps Script.
 *
 * Langkah:
 *   - Hapus semua trigger lama milik skrip ini
 *   - Pasang trigger onEdit instalasi (untuk sinkronisasi instan)
 *   - Pasang trigger berkala setiap 1 menit (untuk sinkronisasi dua arah)
 *   - Jalankan sinkronisasi penuh pertama kali
 */
function setupAutoSync() {
  try {
    // Hapus semua trigger yang sudah ada
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => ScriptApp.deleteTrigger(trigger));
    Logger.log('✅ Semua trigger lama berhasil dihapus.');

    // Pasang trigger onEdit (installable, bukan simple trigger)
    ScriptApp.newTrigger('onSheetEdit')
      .forSpreadsheet(SpreadsheetApp.getActive())
      .onEdit()
      .create();
    Logger.log('✅ Trigger onEdit berhasil dipasang.');

    // Pasang trigger berkala setiap 1 menit
    ScriptApp.newTrigger('syncBidirectional')
      .timeBased()
      .everyMinutes(1)
      .create();
    Logger.log('✅ Trigger berkala (1 menit) berhasil dipasang.');

    // Jalankan sinkronisasi penuh pertama kali
    Logger.log('🔄 Memulai sinkronisasi penuh pertama kali...');
    forceFullSync();

    Logger.log('🎉 Setup selesai! Sinkronisasi otomatis sudah aktif.');
  } catch (err) {
    Logger.log('❌ Gagal setup: ' + err.message);
    throw err;
  }
}

// ============================================================================
// 2. ON EDIT TRIGGER — Sinkronisasi Instan Saat Sel Diedit
// ============================================================================

/**
 * Dipanggil otomatis setiap kali pengguna mengedit sel di spreadsheet.
 * Memeriksa apakah edit terjadi di sheet proyek dan di baris transaksi,
 * lalu menyinkronkan baris tersebut ke Supabase secara instan.
 *
 * @param {Object} e — Event object dari trigger onEdit
 */
function onSheetEdit(e) {
  try {
    // Cek apakah sedang dalam proses sinkronisasi (mencegah loop)
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('IS_SYNCING') === 'true') {
      return; // Lewati — edit ini berasal dari proses sync itu sendiri
    }

    if (!e || !e.range) return;

    const sheet = e.range.getSheet();
    const sheetName = sheet.getName();

    // Lewati sheet yang bukan sheet proyek
    if (SKIP_SHEETS.includes(sheetName)) return;

    const editedRow = e.range.getRow();

    // Hanya proses jika edit di baris transaksi (baris >= TX_START_ROW)
    if (editedRow < TX_START_ROW) return;

    // Hanya proses jika edit di kolom data (A-K, kolom 1-11)
    const editedCol = e.range.getColumn();
    if (editedCol > 11) return;

    Logger.log(`📝 Edit terdeteksi di sheet "${sheetName}", baris ${editedRow}`);

    // Baca data seluruh baris transaksi (kolom A sampai M)
    const rowRange = sheet.getRange(editedRow, 1, 1, HASH_COL);
    const rowValues = rowRange.getValues()[0];

    // Cek apakah baris memiliki data (minimal tanggal atau deskripsi)
    if (!rowValues[0] && !rowValues[1]) {
      // Baris kosong — mungkin pengguna menghapus data
      // Jika ada UUID, hapus transaksi dari Supabase
      const existingId = rowValues[ID_COL - 1];
      if (existingId) {
        Logger.log(`🗑️ Baris ${editedRow} dikosongkan, menghapus dari Supabase: ${existingId}`);
        supaFetch(`/rest/v1/transactions?id=eq.${existingId}`, 'DELETE');
        // Bersihkan UUID dan hash di sheet
        setSyncFlag(true);
        sheet.getRange(editedRow, ID_COL).setValue('');
        sheet.getRange(editedRow, HASH_COL).setValue('');
        setSyncFlag(false);
      }
      return;
    }

    // Dapatkan atau buat proyek di Supabase
    const kontrak = sheet.getRange(KONTRAK_ROW, KONTRAK_COL).getValue();
    const dpMasuk = sheet.getRange(DP_MASUK_ROW, DP_MASUK_COL).getValue();
    const sheetGid = sheet.getSheetId().toString();
    const projectId = getOrCreateProject(sheetName, toNumber(kontrak), toNumber(dpMasuk), sheetGid);

    if (!projectId) {
      Logger.log('❌ Gagal mendapatkan project ID untuk: ' + sheetName);
      return;
    }

    // Siapkan data transaksi dari baris
    const txData = buildTransactionData(rowValues, projectId);

    // Hitung hash baru untuk deteksi perubahan
    const newHash = computeHash(txData);
    const oldHash = rowValues[HASH_COL - 1] || '';

    // Jika hash sama, data tidak berubah — lewati
    if (newHash === oldHash) {
      Logger.log(`⏭️ Baris ${editedRow} tidak berubah (hash sama), dilewati.`);
      return;
    }

    const existingId = rowValues[ID_COL - 1];

    setSyncFlag(true);
    try {
      if (existingId) {
        // Update transaksi yang sudah ada
        txData.sync_hash = newHash;
        txData.sync_source = 'sheet';
        txData.updated_at = new Date().toISOString();

        const res = supaFetch(
          `/rest/v1/transactions?id=eq.${existingId}`,
          'PATCH',
          txData
        );
        Logger.log(`✅ Baris ${editedRow} diperbarui di Supabase: ${existingId}`);
      } else {
        // Insert transaksi baru
        txData.sync_hash = newHash;
        txData.sync_source = 'sheet';

        const res = supaFetch(
          '/rest/v1/transactions',
          'POST',
          txData,
          { prefer: 'return=representation' }
        );

        if (res && res.length > 0) {
          const newId = res[0].id;
          sheet.getRange(editedRow, ID_COL).setValue(newId);
          Logger.log(`✅ Baris ${editedRow} ditambahkan ke Supabase: ${newId}`);
        }
      }

      // Simpan hash baru di kolom M
      sheet.getRange(editedRow, HASH_COL).setValue(newHash);
    } finally {
      setSyncFlag(false);
    }

  } catch (err) {
    Logger.log('❌ Error di onSheetEdit: ' + err.message);
    setSyncFlag(false);
  }
}

// ============================================================================
// 3. SINKRONISASI DUA ARAH (BIDIRECTIONAL SYNC)
// ============================================================================

/**
 * Fungsi utama sinkronisasi dua arah. Dijalankan setiap 1 menit via trigger.
 *
 * Alur:
 *   1. Cek dan pasang kunci (lock) untuk mencegah eksekusi paralel
 *   2. Deteksi sheet proyek baru
 *   3. Untuk setiap sheet proyek:
 *      a. Sheet → Supabase: kirim baris baru/berubah, hapus yang sudah dihapus
 *      b. Supabase → Sheet: tarik transaksi baru/berubah dari app
 *   4. Catat log sinkronisasi
 *   5. Lepas kunci
 */
function syncBidirectional() {
  const lock = LockService.getScriptLock();
  try {
    // Coba dapatkan lock, tunggu hingga 10 detik. Jika gagal, return.
    const hasLock = lock.tryLock(10000);
    if (!hasLock) {
      Logger.log('⏳ Sinkronisasi dilewati — proses lain sedang berjalan.');
      return;
    }
  } catch (err) {
    Logger.log('❌ Gagal mendapatkan lock: ' + err.message);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('IS_SYNCING', 'true');

  try {
    Logger.log('🔄 Memulai sinkronisasi dua arah...');
    const ss = SpreadsheetApp.getActive();

    // Deteksi dan buat proyek baru jika ada sheet baru
    detectNewSheets(ss);

    const sheets = ss.getSheets();
    let totalSynced = 0;

    for (const sheet of sheets) {
      const sheetName = sheet.getName();

      // Lewati sheet yang bukan proyek
      if (SKIP_SHEETS.includes(sheetName)) continue;

      try {
        // Dapatkan project ID
        const kontrak = sheet.getRange(KONTRAK_ROW, KONTRAK_COL).getValue();
        const dpMasuk = sheet.getRange(DP_MASUK_ROW, DP_MASUK_COL).getValue();
        const sheetGid = sheet.getSheetId().toString();
        const projectId = getOrCreateProject(sheetName, toNumber(kontrak), toNumber(dpMasuk), sheetGid);

        if (!projectId) {
          Logger.log(`⚠️ Proyek "${sheetName}" tidak ditemukan di Supabase, dilewati.`);
          continue;
        }

        // --- ARAH 1: Sheet → Supabase ---
        const sheetToDbCount = syncSheetToSupabase(sheet, sheetName, projectId);

        // --- ARAH 2: Supabase → Sheet ---
        const dbToSheetCount = syncSupabaseToSheet(sheet, sheetName, projectId);

        const directionSummary = [];
        if (sheetToDbCount > 0) directionSummary.push(`${sheetToDbCount} sheet→db`);
        if (dbToSheetCount > 0) directionSummary.push(`${dbToSheetCount} db→sheet`);

        if (directionSummary.length > 0) {
          Logger.log(`📊 "${sheetName}": ${directionSummary.join(', ')}`);
          totalSynced += sheetToDbCount + dbToSheetCount;

          // Catat ke sync_log
          if (sheetToDbCount > 0) logSync(sheetName, 'sheet_to_db', sheetToDbCount);
          if (dbToSheetCount > 0) logSync(sheetName, 'db_to_sheet', dbToSheetCount);
        }

        // Perbarui waktu terakhir sinkronisasi untuk proyek ini
        props.setProperty(`LAST_SYNC_${sheetName}`, new Date().toISOString());

      } catch (err) {
        Logger.log(`❌ Error sinkronisasi proyek "${sheetName}": ${err.message}`);
      }
    }

    if (totalSynced > 0) {
      Logger.log(`✅ Sinkronisasi selesai. Total ${totalSynced} perubahan diproses.`);
    } else {
      Logger.log('✅ Sinkronisasi selesai. Tidak ada perubahan.');
    }

  } catch (err) {
    Logger.log('❌ Error fatal sinkronisasi: ' + err.message);
  } finally {
    props.setProperty('IS_SYNCING', 'false');
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 3a. Sheet → Supabase
// ---------------------------------------------------------------------------

/**
 * Menyinkronkan data dari satu sheet proyek ke Supabase.
 *
 * Logika:
 *   - Baris dengan UUID di kolom L & hash berubah → UPDATE
 *   - Baris tanpa UUID → INSERT (UUID ditulis balik ke kolom L)
 *   - UUID di Supabase (sync_source='sheet') yang tidak ada di sheet → DELETE
 *
 * @param {Sheet} sheet — Objek sheet Google Sheets
 * @param {string} sheetName — Nama sheet (= nama proyek)
 * @param {string} projectId — UUID proyek di Supabase
 * @returns {number} Jumlah perubahan yang diproses
 */
function syncSheetToSupabase(sheet, sheetName, projectId) {
  let changeCount = 0;
  const lastRow = sheet.getLastRow();

  // Jika tidak ada data transaksi, cek apakah ada yang perlu dihapus
  if (lastRow < TX_START_ROW) {
    const deleted = deleteOrphanedTransactions(projectId, []);
    return deleted;
  }

  // Baca semua data sekaligus untuk efisiensi
  const numRows = lastRow - TX_START_ROW + 1;
  const dataRange = sheet.getRange(TX_START_ROW, 1, numRows, HASH_COL);
  const allRows = dataRange.getValues();

  // Ambil range ID dan Hash (Kolom L dan M) untuk di-update sekaligus di akhir
  const idHashRange = sheet.getRange(TX_START_ROW, ID_COL, numRows, 2);
  const idHashValues = idHashRange.getValues();

  const sheetUUIDs = []; // Kumpulkan UUID yang ada di sheet
  const batchInserts = []; // Kumpulkan baris untuk batch insert
  const batchInsertRows = []; // Simpan indeks array untuk tulis UUID balik
  let hasChanges = false;

  setSyncFlag(true);
  try {
    for (let i = 0; i < allRows.length; i++) {
      const row = allRows[i];

      // Lewati baris kosong (tidak ada tanggal DAN tidak ada deskripsi)
      if (!row[0] && !row[1]) continue;

      const existingId = row[ID_COL - 1] ? String(row[ID_COL - 1]).trim() : '';
      const existingHash = row[HASH_COL - 1] ? String(row[HASH_COL - 1]).trim() : '';

      // Bangun data transaksi
      const txData = buildTransactionData(row, projectId);
      const newHash = computeHash(txData);

      if (existingId) {
        // Baris sudah punya UUID — cek apakah data berubah
        sheetUUIDs.push(existingId);

        if (newHash !== existingHash) {
          // Data berubah → update di Supabase
          txData.sync_hash = newHash;
          txData.sync_source = 'sheet';
          txData.updated_at = new Date().toISOString();

          supaFetch(`/rest/v1/transactions?id=eq.${existingId}`, 'PATCH', txData);

          // Perbarui hash di memori
          idHashValues[i][1] = newHash;
          hasChanges = true;
          changeCount++;
        }
      } else {
        // Baris baru — kumpulkan untuk batch insert
        txData.sync_hash = newHash;
        txData.sync_source = 'sheet';

        batchInserts.push(txData);
        batchInsertRows.push({ arrayIndex: i, hash: newHash });
      }
    }

    // Batch insert baris baru (jika ada)
    if (batchInserts.length > 0) {
      const inserted = supaFetch(
        '/rest/v1/transactions',
        'POST',
        batchInserts,
        { prefer: 'return=representation' }
      );

      if (inserted && inserted.length > 0) {
        for (let j = 0; j < inserted.length; j++) {
          const rowInfo = batchInsertRows[j];
          idHashValues[rowInfo.arrayIndex][0] = inserted[j].id; // Tulis ID di memori
          idHashValues[rowInfo.arrayIndex][1] = rowInfo.hash;   // Tulis Hash di memori
          sheetUUIDs.push(inserted[j].id);
        }
        hasChanges = true;
        changeCount += inserted.length;
        Logger.log(`➕ ${inserted.length} baris baru ditambahkan dari "${sheetName}"`);
      }
    }

    // Tulis semua perubahan ID/Hash ke sheet sekaligus
    if (hasChanges) {
      idHashRange.setValues(idHashValues);
      SpreadsheetApp.flush(); // Pastikan data tertulis sebelum hapus orphan
    }

    // Hapus transaksi "orphan" (ada di Supabase tapi sudah dihapus di sheet)
    const deletedCount = deleteOrphanedTransactions(projectId, sheetUUIDs);
    changeCount += deletedCount;

  } finally {
    setSyncFlag(false);
  }

  return changeCount;
}

/**
 * Menghapus transaksi di Supabase yang sudah tidak ada di sheet.
 * Hanya menghapus transaksi dengan sync_source='sheet'.
 *
 * @param {string} projectId — UUID proyek
 * @param {string[]} sheetUUIDs — Daftar UUID yang masih ada di sheet
 * @returns {number} Jumlah transaksi yang dihapus
 */
function deleteOrphanedTransactions(projectId, sheetUUIDs) {
  // Ambil semua UUID transaksi sync_source='sheet' dari Supabase
  const dbTransactions = supaFetch(
    `/rest/v1/transactions?project_id=eq.${projectId}&sync_source=eq.sheet&select=id`,
    'GET'
  );

  if (!dbTransactions || dbTransactions.length === 0) return 0;

  const sheetUUIDSet = new Set(sheetUUIDs);
  const orphanIds = dbTransactions
    .map(t => t.id)
    .filter(id => !sheetUUIDSet.has(id));

  if (orphanIds.length === 0) return 0;

  // Hapus orphan secara bulk menggunakan filter `in`
  // Kita hilangkan tanda kutip ganda agar URL-safe tanpa encoding tambahan
  const idsParam = `(${orphanIds.join(',')})`;
  supaFetch(
    `/rest/v1/transactions?id=in.${idsParam}&project_id=eq.${projectId}`,
    'DELETE'
  );

  Logger.log(`🗑️ ${orphanIds.length} transaksi orphan dihapus dari proyek ${projectId}`);
  return orphanIds.length;
}

// ---------------------------------------------------------------------------
// 3b. Supabase → Sheet
// ---------------------------------------------------------------------------

/**
 * Menyinkronkan data dari Supabase ke sheet (transaksi dari app).
 *
 * Logika:
 *   - Ambil transaksi dengan sync_source='app' yang diperbarui setelah
 *     waktu sinkronisasi terakhir
 *   - Jika UUID sudah ada di sheet → update baris tersebut
 *   - Jika UUID belum ada → tambahkan baris baru di akhir
 *
 * @param {Sheet} sheet — Objek sheet Google Sheets
 * @param {string} sheetName — Nama sheet (= nama proyek)
 * @param {string} projectId — UUID proyek di Supabase
 * @returns {number} Jumlah perubahan yang diproses
 */
function syncSupabaseToSheet(sheet, sheetName, projectId) {
  const props = PropertiesService.getScriptProperties();
  const lastSync = props.getProperty(`LAST_SYNC_${sheetName}`) || '2000-01-01T00:00:00Z';

  // Ambil transaksi dari app yang lebih baru dari terakhir sync
  const transactions = supaFetch(
    `/rest/v1/transactions?project_id=eq.${projectId}` +
    `&sync_source=eq.app` +
    `&updated_at=gt.${lastSync}` +
    `&order=tgl.asc,created_at.asc`,
    'GET'
  );

  if (!transactions || transactions.length === 0) return 0;

  // Bangun peta UUID → nomor baris dari data sheet yang ada
  const uuidRowMap = buildUUIDRowMap(sheet);
  let changeCount = 0;

  setSyncFlag(true);
  try {
    for (const tx of transactions) {
      const existingRow = uuidRowMap[tx.id];

      if (existingRow) {
        // UUID sudah ada di sheet → update baris
        writeTransactionToRow(sheet, existingRow, tx);
        changeCount++;
      } else {
        // UUID belum ada → tambahkan baris baru di akhir
        const newRow = findNextEmptyRow(sheet);
        writeTransactionToRow(sheet, newRow, tx);
        changeCount++;
      }
    }
  } finally {
    setSyncFlag(false);
  }

  if (changeCount > 0) {
    Logger.log(`📥 ${changeCount} transaksi dari app ditulis ke sheet "${sheetName}"`);
  }

  return changeCount;
}

/**
 * Membangun peta UUID → nomor baris dari kolom L di sheet.
 *
 * @param {Sheet} sheet — Objek sheet
 * @returns {Object} Objek peta { uuid: rowNumber }
 */
function buildUUIDRowMap(sheet) {
  const map = {};
  const lastRow = sheet.getLastRow();

  if (lastRow < TX_START_ROW) return map;

  const numRows = lastRow - TX_START_ROW + 1;
  const idRange = sheet.getRange(TX_START_ROW, ID_COL, numRows, 1);
  const idValues = idRange.getValues();

  for (let i = 0; i < idValues.length; i++) {
    const uuid = idValues[i][0] ? String(idValues[i][0]).trim() : '';
    if (uuid) {
      map[uuid] = TX_START_ROW + i;
    }
  }

  return map;
}

/**
 * Menulis data transaksi dari Supabase ke satu baris di sheet.
 *
 * @param {Sheet} sheet — Objek sheet
 * @param {number} row — Nomor baris tujuan
 * @param {Object} tx — Objek transaksi dari Supabase
 */
function writeTransactionToRow(sheet, row, tx) {
  // Tulis data ke kolom yang sesuai
  const rowData = [
    tx.tgl ? parseSupabaseDate(tx.tgl) : '',     // A: Tanggal
    tx.deskripsi || '',                           // B: Deskripsi
    '', '', '',                                   // C, D, E: kosong (formula/lainnya)
    tx.masuk || 0,                                // F: Masuk
    tx.keluar || 0,                               // G: Keluar
    '',                                           // H: kosong
    tx.tujuan || '',                              // I: Tujuan
    tx.kategori || '',                            // J: Kategori
    tx.kas || '',                                 // K: Kas
  ];

  sheet.getRange(row, 1, 1, 11).setValues([rowData]);

  // Tulis UUID ke kolom L
  sheet.getRange(row, ID_COL).setValue(tx.id);

  // Hitung dan tulis hash
  const txDataForHash = {
    tgl: tx.tgl,
    deskripsi: tx.deskripsi,
    masuk: tx.masuk,
    keluar: tx.keluar,
    tujuan: tx.tujuan,
    kategori: tx.kategori,
    kas: tx.kas
  };
  const hash = computeHash(txDataForHash);
  sheet.getRange(row, HASH_COL).setValue(hash);

  // Format tanggal di kolom A
  if (tx.tgl) {
    sheet.getRange(row, 1).setNumberFormat('dd-MM-yyyy');
  }
}

/**
 * Mencari baris kosong berikutnya di bawah data transaksi yang ada.
 *
 * @param {Sheet} sheet — Objek sheet
 * @returns {number} Nomor baris kosong berikutnya
 */
function findNextEmptyRow(sheet) {
  const lastRow = sheet.getLastRow();
  return Math.max(lastRow + 1, TX_START_ROW);
}

// ============================================================================
// 4. DETEKSI SHEET PROYEK BARU
// ============================================================================

/**
 * Memeriksa apakah ada sheet tab baru yang belum terdaftar sebagai proyek
 * di Supabase, dan membuatnya jika perlu.
 *
 * @param {Spreadsheet} ss — Objek spreadsheet aktif
 */
function detectNewSheets(ss) {
  const sheets = ss.getSheets();

  for (const sheet of sheets) {
    const name = sheet.getName();

    // Lewati sheet non-proyek
    if (SKIP_SHEETS.includes(name)) continue;

    // Cek apakah proyek sudah ada di cache atau Supabase
    if (_projectCache[name]) continue;

    const kontrak = sheet.getRange(KONTRAK_ROW, KONTRAK_COL).getValue();
    const dpMasuk = sheet.getRange(DP_MASUK_ROW, DP_MASUK_COL).getValue();
    const sheetGid = sheet.getSheetId().toString();
    const projectId = getOrCreateProject(name, toNumber(kontrak), toNumber(dpMasuk), sheetGid);

    if (projectId) {
      Logger.log(`📂 Proyek terdeteksi/dibuat: "${name}" (ID: ${projectId})`);
    }
  }
}

// ============================================================================
// 5. FUNGSI HELPER
// ============================================================================

// ---------------------------------------------------------------------------
// 5a. Supabase REST API Wrapper
// ---------------------------------------------------------------------------

/**
 * Melakukan HTTP request ke Supabase REST API.
 *
 * @param {string} path — Path endpoint (contoh: '/rest/v1/transactions')
 * @param {string} method — HTTP method: 'GET', 'POST', 'PATCH', 'DELETE'
 * @param {Object|Array|null} payload — Body request (untuk POST/PATCH)
 * @param {Object} extraHeaders — Header tambahan (opsional)
 * @returns {Object|Array|null} Response body yang di-parse, atau null
 */
function supaFetch(path, method, payload, extraHeaders) {
  const url = SUPABASE_URL + path;

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json',
  };

  // Tambahkan header Prefer untuk POST agar mengembalikan data yang diinsert
  if (method === 'POST') {
    headers['Prefer'] = 'return=representation';
  }
  if (method === 'PATCH') {
    headers['Prefer'] = 'return=minimal';
  }

  // Merge header tambahan
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(key => {
      headers[key] = extraHeaders[key];
    });
  }

  const options = {
    method: method.toLowerCase(),
    headers: headers,
    muteHttpExceptions: true,
  };

  if (payload && (method === 'POST' || method === 'PATCH')) {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const body = response.getContentText();

  // Cek status code
  if (code >= 200 && code < 300) {
    if (body && body.trim()) {
      try {
        return JSON.parse(body);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  // Error handling
  Logger.log(`⚠️ Supabase error [${code}] ${method} ${path}: ${body}`);
  throw new Error(`Supabase API error ${code}: ${body}`);
}

// ---------------------------------------------------------------------------
// 5b. Konversi Data
// ---------------------------------------------------------------------------

/**
 * Mengonversi nilai tanggal dari sel ke format ISO (YYYY-MM-DD).
 * Mendukung Date object dan string DD-MM-YYYY.
 *
 * @param {*} val — Nilai dari sel tanggal
 * @returns {string|null} Tanggal dalam format YYYY-MM-DD, atau null
 */
function toISO(val) {
  if (!val) return null;

  // Jika sudah berupa Date object
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Jika string format DD-MM-YYYY
  const str = String(val).trim();
  const match = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const dd = match[1].padStart(2, '0');
    const mm = match[2].padStart(2, '0');
    const yyyy = match[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // Jika string format YYYY-MM-DD (sudah ISO)
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return str;

  Logger.log(`⚠️ Format tanggal tidak dikenali: "${val}"`);
  return null;
}

/**
 * Mengonversi tanggal ISO dari Supabase ke Date object untuk Sheet.
 *
 * @param {string} isoDate — Tanggal format YYYY-MM-DD
 * @returns {Date|string} Date object atau string asli jika gagal
 */
function parseSupabaseDate(isoDate) {
  if (!isoDate) return '';
  try {
    const parts = String(isoDate).split('-');
    if (parts.length === 3) {
      return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    return isoDate;
  } catch (e) {
    return isoDate;
  }
}

/**
 * Mengonversi nilai sel ke angka. Menangani string, angka, dan nilai kosong.
 *
 * @param {*} val — Nilai dari sel
 * @returns {number} Angka hasil konversi (0 jika tidak valid)
 */
function toNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);

  // Bersihkan karakter non-numerik (kecuali minus dan titik)
  const cleaned = String(val).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num);
}

// ---------------------------------------------------------------------------
// 5c. Hash untuk Deteksi Perubahan
// ---------------------------------------------------------------------------

/**
 * Menghitung hash sederhana dari data transaksi untuk mendeteksi perubahan.
 * Menggunakan string concatenation + simple hash algorithm.
 *
 * @param {Object} txData — Data transaksi (objek dengan field tgl, deskripsi, dll)
 * @returns {string} Hash string (hex)
 */
function computeHash(txData) {
  const parts = [
    txData.tgl || '',
    txData.deskripsi || '',
    String(txData.masuk || 0),
    String(txData.keluar || 0),
    txData.tujuan || '',
    txData.kategori || '',
    txData.kas || ''
  ];

  const str = parts.join('|');

  // djb2 hash algorithm — sederhana dan cukup untuk deteksi perubahan
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xFFFFFFFF;
  }

  // Konversi ke hex string positif
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// 5d. Manajemen Proyek
// ---------------------------------------------------------------------------

/**
 * Mendapatkan UUID proyek dari Supabase berdasarkan nama.
 * Menggunakan cache in-memory untuk mengurangi API call.
 *
 * @param {string} name — Nama proyek (= nama sheet)
 * @returns {string|null} UUID proyek atau null jika tidak ditemukan
 */
function getProjectId(name) {
  // Cek cache dulu
  if (_projectCache[name]) return _projectCache[name].id;

  const result = supaFetch(
    `/rest/v1/projects?name=eq.${encodeURIComponent(name)}&select=id,total_kontrak,dp_masuk,sheet_gid`,
    'GET'
  );

  if (result && result.length > 0) {
    _projectCache[name] = result[0];
    return result[0].id;
  }

  return null;
}

/**
 * Mendapatkan UUID proyek yang sudah ada, atau membuat proyek baru di Supabase.
 * Jika proyek sudah ada tetapi total kontrak, DP masuk, atau sheet GID berbeda, perbarui di Supabase.
 *
 * @param {string} name — Nama proyek (= nama sheet)
 * @param {number} kontrak — Nilai total kontrak
 * @param {number} dpMasuk — Nilai DP masuk
 * @param {string} sheetGid — ID tab unik Google Sheets (untuk export langsung)
 * @returns {string|null} UUID proyek
 */
function getOrCreateProject(name, kontrak, dpMasuk, sheetGid) {
  // Coba dapatkan yang sudah ada
  let projectId = getProjectId(name);
  if (projectId) {
    const cachedProj = _projectCache[name];
    const targetKontrak = kontrak || 0;
    const targetDp = dpMasuk || 0;
    const targetGid = sheetGid || '';
    
    const needsKontrakUpdate = cachedProj && Number(cachedProj.total_kontrak) !== Number(targetKontrak);
    const needsDpUpdate = cachedProj && Number(cachedProj.dp_masuk) !== Number(targetDp);
    const needsGidUpdate = cachedProj && cachedProj.sheet_gid !== targetGid;

    if (needsKontrakUpdate || needsDpUpdate || needsGidUpdate) {
      const updates = {};
      if (needsKontrakUpdate) {
        Logger.log(`🔄 Memperbarui total kontrak proyek "${name}" dari Rp ${cachedProj.total_kontrak} ke Rp ${targetKontrak}`);
        updates.total_kontrak = targetKontrak;
        cachedProj.total_kontrak = targetKontrak;
      }
      if (needsDpUpdate) {
        Logger.log(`🔄 Memperbarui DP masuk proyek "${name}" dari Rp ${cachedProj.dp_masuk || 0} ke Rp ${targetDp}`);
        updates.dp_masuk = targetDp;
        cachedProj.dp_masuk = targetDp;
      }
      if (needsGidUpdate) {
        Logger.log(`🔄 Memperbarui sheet GID proyek "${name}" dari ${cachedProj.sheet_gid || 'kosong'} ke ${targetGid}`);
        updates.sheet_gid = targetGid;
        cachedProj.sheet_gid = targetGid;
      }

      supaFetch(`/rest/v1/projects?id=eq.${projectId}`, 'PATCH', updates);
    }
    return projectId;
  }

  // Buat proyek baru
  Logger.log(`🆕 Membuat proyek baru di Supabase: "${name}"`);
  const result = supaFetch('/rest/v1/projects', 'POST', {
    name: name,
    total_kontrak: kontrak || 0,
    dp_masuk: dpMasuk || 0,
    sheet_gid: sheetGid || ''
  }, { prefer: 'return=representation' });

  if (result && result.length > 0) {
    _projectCache[name] = result[0];
    Logger.log(`✅ Proyek "${name}" berhasil dibuat: ${result[0].id}`);
    return result[0].id;
  }

  Logger.log(`❌ Gagal membuat proyek: "${name}"`);
  return null;
}

// ---------------------------------------------------------------------------
// 5e. Pembangun Data Transaksi
// ---------------------------------------------------------------------------

/**
 * Membangun objek data transaksi dari array nilai baris sheet.
 *
 * @param {Array} rowValues — Array nilai dari baris sheet (kolom A sampai M)
 * @param {string} projectId — UUID proyek
 * @returns {Object} Objek data transaksi siap kirim ke Supabase
 */
function buildTransactionData(rowValues, projectId) {
  return {
    project_id: projectId,
    tgl: toISO(rowValues[0]),          // Kolom A: Tanggal
    deskripsi: String(rowValues[1] || '').trim(),  // Kolom B: Deskripsi
    masuk: toNumber(rowValues[5]),      // Kolom F: Masuk
    keluar: toNumber(rowValues[6]),     // Kolom G: Keluar
    tujuan: String(rowValues[8] || '').trim(),     // Kolom I: Tujuan
    kategori: String(rowValues[9] || '').trim(),   // Kolom J: Kategori
    kas: String(rowValues[10] || '').trim(),       // Kolom K: Kas
  };
}

// ---------------------------------------------------------------------------
// 5f. Mekanisme Kunci (Lock)
// ---------------------------------------------------------------------------

/**
 * Mencoba mendapatkan kunci sinkronisasi.
 * Jika kunci sudah ditahan dan belum timeout, return false.
 *
 * @param {PropertiesService.Properties} props — Script properties
 * @returns {boolean} true jika kunci berhasil didapat
 */
function acquireLock(props) {
  const lockTime = props.getProperty('SYNC_LOCK_TIME');

  if (lockTime) {
    const elapsed = Date.now() - parseInt(lockTime, 10);
    if (elapsed < LOCK_TIMEOUT_MS) {
      // Kunci masih aktif dan belum timeout
      return false;
    }
    // Kunci sudah timeout — paksa lepas
    Logger.log('⚠️ Kunci sinkronisasi sudah timeout, dipaksa dilepas.');
  }

  // Pasang kunci baru
  props.setProperty('SYNC_LOCK_TIME', String(Date.now()));
  props.setProperty('IS_SYNCING', 'true');
  return true;
}

/**
 * Melepaskan kunci sinkronisasi.
 *
 * @param {PropertiesService.Properties} props — Script properties
 */
function releaseLock(props) {
  props.deleteProperty('SYNC_LOCK_TIME');
  props.setProperty('IS_SYNCING', 'false');
}

/**
 * Mengatur flag IS_SYNCING untuk mencegah trigger onEdit saat menulis ke sheet.
 *
 * @param {boolean} syncing — true saat mulai menulis, false setelah selesai
 */
function setSyncFlag(syncing) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('IS_SYNCING', syncing ? 'true' : 'false');
}

// ---------------------------------------------------------------------------
// 5g. Pencatatan Log Sinkronisasi
// ---------------------------------------------------------------------------

/**
 * Mencatat satu entri ke tabel sync_log di Supabase.
 *
 * @param {string} projectName — Nama proyek
 * @param {string} direction — Arah sinkronisasi (e.g., 'bidirectional', 'sheet_to_db')
 * @param {number} count — Jumlah record yang disinkronkan
 */
function logSync(projectName, direction, count) {
  try {
    supaFetch('/rest/v1/sync_log', 'POST', {
      project_name: projectName,
      direction: direction,
      synced_count: count,
      synced_at: new Date().toISOString()
    });
  } catch (err) {
    // Jangan sampai error pencatatan log menghentikan proses utama
    Logger.log('⚠️ Gagal mencatat sync_log: ' + err.message);
  }
}

// ============================================================================
// 6. FUNGSI MANUAL — Dapat Dipanggil Langsung dari Editor
// ============================================================================

/**
 * Memaksa sinkronisasi penuh untuk semua proyek.
 * Mengabaikan waktu sinkronisasi terakhir — semua data diproses ulang.
 *
 * Panggil fungsi ini secara manual jika terjadi inkonsistensi data.
 */
function forceFullSync() {
  const lock = LockService.getScriptLock();
  try {
    const hasLock = lock.tryLock(30000); // Tunggu sampai 30 detik
    if (!hasLock) {
      Logger.log('⏳ Full sync dilewati — proses lain sedang berjalan.');
      return;
    }
  } catch (err) {
    Logger.log('❌ Gagal mendapatkan lock untuk full sync: ' + err.message);
    return;
  }

  const props = PropertiesService.getScriptProperties();
  props.setProperty('IS_SYNCING', 'true');

  try {
    // Reset semua timestamp sinkronisasi terakhir
    const allProps = props.getProperties();
    for (const key in allProps) {
      if (key.startsWith('LAST_SYNC_')) {
        props.deleteProperty(key);
      }
    }

    Logger.log('🔄 Memulai sinkronisasi penuh paksa...');

    const ss = SpreadsheetApp.getActive();
    detectNewSheets(ss);

    const sheets = ss.getSheets();
    let totalSynced = 0;

    for (const sheet of sheets) {
      const sheetName = sheet.getName();
      if (SKIP_SHEETS.includes(sheetName)) continue;

      try {
        const kontrak = sheet.getRange(KONTRAK_ROW, KONTRAK_COL).getValue();
        const dpMasuk = sheet.getRange(DP_MASUK_ROW, DP_MASUK_COL).getValue();
        const sheetGid = sheet.getSheetId().toString();
        const projectId = getOrCreateProject(sheetName, toNumber(kontrak), toNumber(dpMasuk), sheetGid);

        if (!projectId) continue;

        // Sheet → DB
        const s2d = syncSheetToSupabase(sheet, sheetName, projectId);

        // Untuk full sync, ambil SEMUA transaksi dari app (tidak hanya yang baru)
        const dbToSheetCount = syncAllFromSupabase(sheet, sheetName, projectId);

        totalSynced += s2d + dbToSheetCount;

        props.setProperty(`LAST_SYNC_${sheetName}`, new Date().toISOString());
        Logger.log(`📊 "${sheetName}": ${s2d} sheet→db, ${dbToSheetCount} db→sheet`);

      } catch (err) {
        Logger.log(`❌ Error full sync "${sheetName}": ${err.message}`);
      }
    }

    Logger.log(`🎉 Sinkronisasi penuh selesai. Total: ${totalSynced} perubahan.`);

  } finally {
    props.setProperty('IS_SYNCING', 'false');
    lock.releaseLock();
  }
}

/**
 * Menyinkronkan SEMUA transaksi dari Supabase ke sheet (untuk full sync).
 * Berbeda dengan syncSupabaseToSheet yang hanya mengambil yang baru.
 *
 * @param {Sheet} sheet — Objek sheet
 * @param {string} sheetName — Nama sheet
 * @param {string} projectId — UUID proyek
 * @returns {number} Jumlah perubahan
 */
function syncAllFromSupabase(sheet, sheetName, projectId) {
  // Ambil semua transaksi dari app
  const transactions = supaFetch(
    `/rest/v1/transactions?project_id=eq.${projectId}` +
    `&sync_source=eq.app` +
    `&order=tgl.asc,created_at.asc`,
    'GET'
  );

  if (!transactions || transactions.length === 0) return 0;

  const uuidRowMap = buildUUIDRowMap(sheet);
  let changeCount = 0;

  setSyncFlag(true);
  try {
    for (const tx of transactions) {
      const existingRow = uuidRowMap[tx.id];

      if (existingRow) {
        // Cek apakah data berubah sebelum menulis
        const currentHash = sheet.getRange(existingRow, HASH_COL).getValue();
        const txDataForHash = {
          tgl: tx.tgl,
          deskripsi: tx.deskripsi,
          masuk: tx.masuk,
          keluar: tx.keluar,
          tujuan: tx.tujuan,
          kategori: tx.kategori,
          kas: tx.kas
        };
        const newHash = computeHash(txDataForHash);

        if (String(currentHash).trim() !== newHash) {
          writeTransactionToRow(sheet, existingRow, tx);
          changeCount++;
        }
      } else {
        const newRow = findNextEmptyRow(sheet);
        writeTransactionToRow(sheet, newRow, tx);
        changeCount++;
      }
    }
  } finally {
    setSyncFlag(false);
  }

  return changeCount;
}

/**
 * Menampilkan status sinkronisasi saat ini di Logger.
 * Berguna untuk debugging dan monitoring.
 */
function checkStatus() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const ss = SpreadsheetApp.getActive();

  Logger.log('═══════════════════════════════════════════');
  Logger.log('  📊 STATUS SINKRONISASI FINTRACK');
  Logger.log('═══════════════════════════════════════════');

  // Status kunci
  const lockTime = allProps['SYNC_LOCK_TIME'];
  const isSyncing = allProps['IS_SYNCING'];
  if (lockTime) {
    const elapsed = Math.round((Date.now() - parseInt(lockTime)) / 1000);
    Logger.log(`🔒 Kunci: AKTIF (${elapsed} detik lalu)`);
  } else {
    Logger.log('🔓 Kunci: TIDAK AKTIF');
  }
  Logger.log(`📡 Status IS_SYNCING: ${isSyncing || 'false'}`);

  // Status trigger
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log(`⚙️ Jumlah trigger aktif: ${triggers.length}`);
  triggers.forEach((trigger, i) => {
    Logger.log(`   ${i + 1}. ${trigger.getHandlerFunction()} — ${trigger.getEventType()}`);
  });

  // Status per proyek
  Logger.log('───────────────────────────────────────────');
  Logger.log('  📁 STATUS PER PROYEK');
  Logger.log('───────────────────────────────────────────');

  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (SKIP_SHEETS.includes(name)) continue;

    const lastSync = allProps[`LAST_SYNC_${name}`] || 'Belum pernah';
    const lastRow = sheet.getLastRow();
    const txRows = Math.max(0, lastRow - TX_START_ROW + 1);

    Logger.log(`📂 ${name}`);
    Logger.log(`   Baris data: ${txRows}`);
    Logger.log(`   Terakhir sinkronisasi: ${lastSync}`);

    // Hitung baris yang sudah punya UUID
    if (txRows > 0) {
      const ids = sheet.getRange(TX_START_ROW, ID_COL, txRows, 1).getValues();
      const synced = ids.filter(r => r[0] && String(r[0]).trim()).length;
      Logger.log(`   Baris tersinkronisasi: ${synced}/${txRows}`);
    }
  }

  // Status Supabase
  Logger.log('───────────────────────────────────────────');
  Logger.log('  🗄️ STATUS SUPABASE');
  Logger.log('───────────────────────────────────────────');

  try {
    const projects = supaFetch('/rest/v1/projects?select=id,name', 'GET');
    Logger.log(`📂 Jumlah proyek: ${projects ? projects.length : 0}`);

    if (projects) {
      for (const p of projects) {
        const txCount = supaFetch(
          `/rest/v1/transactions?project_id=eq.${p.id}&select=id`,
          'GET'
        );
        Logger.log(`   ${p.name}: ${txCount ? txCount.length : 0} transaksi`);
      }
    }

    // Cek log sinkronisasi terakhir
    const recentLogs = supaFetch(
      '/rest/v1/sync_log?order=synced_at.desc&limit=5',
      'GET'
    );
    if (recentLogs && recentLogs.length > 0) {
      Logger.log('───────────────────────────────────────────');
      Logger.log('  📋 LOG SINKRONISASI TERAKHIR');
      Logger.log('───────────────────────────────────────────');
      for (const log of recentLogs) {
        Logger.log(`   ${log.synced_at} | ${log.project_name} | ${log.direction} | ${log.synced_count} record`);
      }
    }
  } catch (err) {
    Logger.log('⚠️ Gagal mengambil status dari Supabase: ' + err.message);
  }

  Logger.log('═══════════════════════════════════════════');
  Logger.log('  Selesai.');
  Logger.log('═══════════════════════════════════════════');
}

/**
 * Menghapus semua data sinkronisasi dan mereset status.
 * ⚠️ HATI-HATI: Ini akan menghapus semua UUID dan hash dari sheet!
 * Data di Supabase TIDAK dihapus.
 */
function resetSyncState() {
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActive();

  // Hapus semua properti sinkronisasi
  const allProps = props.getProperties();
  for (const key in allProps) {
    if (key.startsWith('LAST_SYNC_') || key === 'SYNC_LOCK_TIME' || key === 'IS_SYNCING') {
      props.deleteProperty(key);
    }
  }

  // Bersihkan kolom L dan M di semua sheet proyek
  const sheets = ss.getSheets();
  for (const sheet of sheets) {
    const name = sheet.getName();
    if (SKIP_SHEETS.includes(name)) continue;

    const lastRow = sheet.getLastRow();
    if (lastRow >= TX_START_ROW) {
      const numRows = lastRow - TX_START_ROW + 1;
      sheet.getRange(TX_START_ROW, ID_COL, numRows, 1).clearContent();
      sheet.getRange(TX_START_ROW, HASH_COL, numRows, 1).clearContent();
    }
  }

  Logger.log('🔄 Status sinkronisasi berhasil direset.');
  Logger.log('💡 Jalankan forceFullSync() untuk menyinkronkan ulang semua data.');
}
