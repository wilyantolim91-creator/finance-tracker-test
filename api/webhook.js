export default async function handler(request, response) {
  // Hanya menerima metode POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const data = request.body;
    
    // Pastikan ini adalah pesan teks dari Telegram
    if (!data || !data.message || !data.message.text) {
      return response.status(200).json({ status: 'ok', msg: 'Not a text message' });
    }

    const chatId = data.message.chat.id;
    const userText = data.message.text;

    // Ambil Environment Variables (dengan fallback)
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT;
    const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
    const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://derikfjxjsvhaxfqcqwb.supabase.co').trim();
    const SUPABASE_KEY = (process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC').trim();

    // Fungsi kecil untuk membalas ke Telegram
    const replyToTelegram = async (text) => {
      if (!TELEGRAM_TOKEN) return;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      });
    };

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY || !TELEGRAM_TOKEN) {
      console.error("Missing Environment Variables!");
      await replyToTelegram("Maaf, API Keys di server belum dikonfigurasi dengan lengkap.");
      return response.status(200).json({ error: 'Missing config' });
    }

    // 1. Panggil Gemini AI untuk mem-parsing pesan
    const prompt = `Kamu adalah asisten pengatur keuangan proyek bernama FinTrack.
Tugasmu ada 2:
1. Menjawab sapaan atau percakapan biasa dengan ramah dan natural.
2. Mengekstrak data transaksi jika user berniat mencatat pemasukan/pengeluaran keuangan.

Kamu WAJIB membalas dengan HANYA satu objek JSON murni (tanpa markdown backticks).
Gunakan tanggal hari ini (${new Date().toISOString().split('T')[0]}) jika user tidak menyebutkan tanggal untuk transaksi.

Format JSON yang diwajibkan:
{
  "is_transaction": boolean, // true jika user memerintahkan mencatat keuangan, false jika hanya ngobrol
  "reply_text": "Balasan bahasamu yang natural dan ramah ke user",
  "transaction_data": { // WAJIB ada jika is_transaction = true, jika false isi dengan null
    "tgl": "YYYY-MM-DD",
    "deskripsi": "deskripsi singkat transaksi",
    "volume": 1,
    "satuan": "ls",
    "harga_satuan": 0,
    "masuk": 0, // isi total uang masuk
    "keluar": 0, // isi total uang keluar
    "kategori": "Material", // Pilih salah satu: 'Material' | 'Upah' | 'Operasional' | 'Pemasukan' | 'Transfer' | 'Transfer Internal' | 'Lainnya'
    "kas": "KAS UTAMA", // contoh: 'KAS UTAMA', 'KAS WILY', dll, huruf kapital
    "project_name": "KARANTINA 59" // jika tidak disebutkan secara eksplisit, gunakan default "KARANTINA 59"
  }
}

Pesan user: "${userText}"`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const geminiData = await geminiRes.json();
    
    // Tangani jika API Key salah atau error dari Gemini
    if (geminiData.error) {
      console.error("Gemini Error:", geminiData.error);
      await replyToTelegram("Maaf, API Gemini mengalami gangguan: " + geminiData.error.message);
      return response.status(200).json({ error: geminiData.error });
    }

    let jsonResult;
    try {
      const textOutput = geminiData.candidates[0].content.parts[0].text;
      jsonResult = JSON.parse(textOutput);
    } catch (e) {
      console.error("Parsing error:", e, geminiData);
      await replyToTelegram("Maaf, format balasan AI tidak sesuai. Tolong ulangi pesan Anda.");
      return response.status(200).json({ error: 'Gagal parsing JSON' });
    }

    // Jika bukan transaksi, cukup balas chat-nya saja
    if (!jsonResult.is_transaction || !jsonResult.transaction_data) {
      await replyToTelegram(jsonResult.reply_text || "Halo! Ada yang bisa saya bantu catat?");
      return response.status(200).json({ status: 'chat_only' });
    }

    const tx = jsonResult.transaction_data;

    // 2. Dapatkan Project ID dari Supabase
    const projectName = tx.project_name || 'KARANTINA 59';
    const projRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?name=ilike.${encodeURIComponent(projectName)}&select=id`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    const projData = await projRes.json();
    if (!projData || projData.length === 0) {
      await replyToTelegram(`[Gagal] Proyek dengan nama "${projectName}" tidak ditemukan di database Anda.\n\nCatatan AI: ${jsonResult.reply_text}`);
      return response.status(200).json({ error: 'Project tidak ditemukan' });
    }
    const projectId = projData[0].id;

    // 3. Simpan ke Supabase Transactions
    const txData = {
      project_id: projectId,
      tgl: tx.tgl,
      deskripsi: tx.deskripsi,
      volume: tx.volume || 1,
      satuan: tx.satuan || 'ls',
      harga_satuan: tx.harga_satuan || 0,
      masuk: tx.masuk || 0,
      keluar: tx.keluar || 0,
      kategori: tx.kategori || 'Lainnya',
      kas: tx.kas || 'KAS UTAMA',
      tujuan: '',
      sync_source: 'app',
      updated_at: new Date().toISOString()
    };

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(txData)
    });

    if (!insertRes.ok) {
      const errTxt = await insertRes.text();
      console.error("Supabase error:", errTxt);
      await replyToTelegram("Maaf, terjadi kesalahan saat menyimpan ke database Supabase.\n" + errTxt);
      return response.status(200).json({ error: 'Gagal simpan db' });
    }

    // 4. Balas sukses ke Telegram
    await replyToTelegram(jsonResult.reply_text);

    return response.status(200).json({ status: 'success' });
  } catch (error) {
    console.error("Webhook Error:", error);
    return response.status(200).json({ error: error.message });
  }
}
