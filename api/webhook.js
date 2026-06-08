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

    // Ambil Environment Variables
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

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
Ekstrak data transaksi dari pesan user berikut menjadi format JSON yang valid.
Gunakan tanggal hari ini (${new Date().toISOString().split('T')[0]}) jika user tidak menyebutkan tanggal.
Penting: JANGAN gunakan markdown backticks, kembalikan hanya teks JSON murni.

Struktur JSON yang wajib:
{
  "tgl": "YYYY-MM-DD",
  "deskripsi": "deskripsi singkat transaksi",
  "volume": 1,
  "satuan": "ls",
  "harga_satuan": 0,
  "masuk": 0, // isi jika uang masuk
  "keluar": 0, // isi jika uang keluar
  "kategori": "Material", // 'Material' | 'Upah' | 'Operasional' | 'Pemasukan' | 'Transfer' | 'Transfer Internal' | 'Lainnya'
  "kas": "KAS UTAMA", // contoh: 'KAS UTAMA', 'KAS WILY', dll, huruf kapital
  "project_name": "KARANTINA 59" // jika tidak disebutkan secara eksplisit, gunakan default "KARANTINA 59"
}

Pesan user: "${userText}"`;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    const geminiData = await geminiRes.json();
    let jsonResult;
    try {
      const textOutput = geminiData.candidates[0].content.parts[0].text;
      jsonResult = JSON.parse(textOutput);
    } catch (e) {
      await replyToTelegram("Maaf, saya tidak mengerti maksud pesan tersebut. Bisa diulangi dengan format yang lebih jelas?");
      return response.status(200).json({ error: 'Gagal parsing JSON dari Gemini' });
    }

    // 2. Dapatkan Project ID dari Supabase
    const projectName = jsonResult.project_name || 'KARANTINA 59';
    const projRes = await fetch(`${SUPABASE_URL}/rest/v1/projects?name=ilike.${encodeURIComponent(projectName)}&select=id`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    
    const projData = await projRes.json();
    if (!projData || projData.length === 0) {
      await replyToTelegram(`Proyek dengan nama "${projectName}" tidak ditemukan di database.`);
      return response.status(200).json({ error: 'Project tidak ditemukan' });
    }
    const projectId = projData[0].id;

    // 3. Simpan ke Supabase Transactions
    const txData = {
      project_id: projectId,
      tgl: jsonResult.tgl,
      deskripsi: jsonResult.deskripsi,
      volume: jsonResult.volume || 1,
      satuan: jsonResult.satuan || 'ls',
      harga_satuan: jsonResult.harga_satuan || 0,
      masuk: jsonResult.masuk || 0,
      keluar: jsonResult.keluar || 0,
      kategori: jsonResult.kategori || 'Lainnya',
      kas: jsonResult.kas || 'KAS UTAMA',
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
      await replyToTelegram("Maaf, terjadi kesalahan saat menyimpan ke database.");
      return response.status(200).json({ error: 'Gagal simpan db' });
    }

    // 4. Balas sukses ke Telegram
    const amount = txData.keluar > 0 ? txData.keluar : txData.masuk;
    const verb = txData.keluar > 0 ? "Pengeluaran" : "Pemasukan";
    const finalReply = `✅ *${verb} Berhasil Dicatat!*\n\n📝 ${txData.deskripsi}\n💰 Rp ${new Intl.NumberFormat('id-ID').format(amount)}\n💼 ${txData.kas}\n📁 Proyek: ${projectName}`;
    
    await replyToTelegram(finalReply);

    return response.status(200).json({ status: 'success' });
  } catch (error) {
    console.error("Webhook Error:", error);
    return response.status(200).json({ error: error.message });
  }
}
