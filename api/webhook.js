export default async function handler(request, response) {
  // Hanya menerima metode POST
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const data = request.body;
    
    // Pastikan ini adalah pesan valid dari Telegram (bisa berupa text atau foto)
    if (!data || !data.message || (!data.message.text && !data.message.photo)) {
      return response.status(200).json({ status: 'ok', msg: 'Not a text or photo message' });
    }

    const message = data.message;
    const chatId = message.chat.id;
    const chatType = message.chat.type || 'private';
    const userText = message.text || message.caption || "";
    const replyToMsg = message.reply_to_message && message.reply_to_message.text ? message.reply_to_message.text : "";

    // Ambil Environment Variables (dengan fallback)
    const TELEGRAM_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT || '').trim();
    const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || '').trim();
    const SUPABASE_URL = (process.env.REACT_APP_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://derikfjxjsvhaxfqcqwb.supabase.co').trim();
    const SUPABASE_KEY = (process.env.REACT_APP_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_wBxny-c-7GFsoIjS9Xaasw_IguFmgWC').trim();

    const cleanToken = TELEGRAM_TOKEN.replace(/^bot/i, '').replace(/["']/g, ''); // Hapus tulisan bot atau tanda kutip jika user terlanjur copas

    // Fungsi kecil untuk membalas ke Telegram
    const replyToTelegram = async (text) => {
      if (!TELEGRAM_TOKEN) return { error: "No Token" };
      
      const res = await fetch(`https://api.telegram.org/bot${cleanToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      const resData = await res.json();
      return resData;
    };

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_KEY || !TELEGRAM_TOKEN) {
      console.error("Missing Environment Variables!");
      await replyToTelegram("Maaf, API Keys di server belum dikonfigurasi dengan lengkap.");
      return response.status(200).json({ error: 'Missing config' });
    }

    // Filter pesan grup: Hanya proses jika private chat, atau reply ke bot, atau mengandung mention/command
    const isPrivate = chatType === 'private';
    const isReplyToBot = message.reply_to_message && message.reply_to_message.from && message.reply_to_message.from.is_bot;
    const isMentioned = userText && (userText.includes('@') || userText.startsWith('/'));

    if (!isPrivate && !isReplyToBot && !isMentioned) {
      return response.status(200).json({ status: 'ok', msg: 'Ignored group message (no mention or reply)' });
    }

    // Bersihkan mention/username bot agar tidak mengacaukan AI
    const cleanUserText = userText.replace(/@[a-zA-Z0-9_]+/g, '').trim();

    // Unduh foto jika ada
    let base64Image = null;
    let mimeType = null;
    if (message.photo && message.photo.length > 0) {
      try {
        const photo = message.photo[message.photo.length - 1]; // Resolusi terbesar
        const fileId = photo.file_id;
        
        const fileRes = await fetch(`https://api.telegram.org/bot${cleanToken}/getFile?file_id=${fileId}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          if (fileData.ok && fileData.result && fileData.result.file_path) {
            const filePath = fileData.result.file_path;
            const imgRes = await fetch(`https://api.telegram.org/file/bot${cleanToken}/${filePath}`);
            if (imgRes.ok) {
              const imgBuffer = await imgRes.arrayBuffer();
              base64Image = Buffer.from(imgBuffer).toString('base64');
              mimeType = 'image/jpeg';
            }
          }
        }
      } catch (err) {
        console.error("Gagal mendownload foto:", err);
      }
    }

    // 1. Panggil Gemini AI untuk mem-parsing pesan
    const prompt = `Kamu adalah asisten pengatur keuangan proyek bernama FinTrack.

ATURAN KERJA:
1. FASE INPUT (Belum dikonfirmasi): Jika pesan user saat ini berisi permintaan mencatat transaksi baru atau struk belanja, KAMU TIDAK BOLEH MENYIMPANNYA (set is_transaction = false).
Sebagai gantinya, buatlah Kartu Konfirmasi di bagian \`reply_text\` dengan format ini:
🧾 KONFIRMASI TRANSAKSI
-----------------------
📅 Tanggal: [isi]
📝 Deskripsi: [isi]
📦 Volume: [isi]
💰 Harga Satuan: Rp [isi]
💎 Total Harga: Rp [isi]
📂 Proyek: [isi]
💼 Kas: [isi]

⚠️ *Data ini BELUM tersimpan.* Balas (Reply) pesan ini dengan kata "YA" untuk menyimpan.

2. FASE KONFIRMASI (User setuju): Jika Pesan user saat ini adalah persetujuan (contoh: "Ya", "Simpan") DAN 'Pesan Bot Sebelumnya' berisi Kartu Konfirmasi Transaksi buatanmu, MAKA ini waktunya menyimpan! 
Set is_transaction = true. EKSTRAK semua angka dan data dari 'Pesan Bot Sebelumnya' dan masukkan ke dalam \`transaction_data\`. Di bagian \`reply_text\`, beri tahu: "✅ Data transaksi di atas berhasil disimpan ke database!"

3. Jika user berniat mencatat tapi kas/proyek belum disebutkan, set is_transaction = false dan tanyakan detailnya (jangan buat Kartu Konfirmasi jika data belum lengkap).
4. Jika ada gambar/foto struk transaksi yang dikirimkan, bacalah teks/OCR di dalam gambar tersebut untuk mengekstrak informasi nominal, deskripsi barang, kas/bank yang digunakan (jika ada), proyek (jika ada), dan tanggal transaksi secara otomatis. Gunakan informasi ini untuk membuat Kartu Konfirmasi Transaksi.

Kamu WAJIB membalas dengan HANYA satu objek JSON murni (tanpa markdown backticks).
Gunakan tanggal hari ini (${new Date().toISOString().split('T')[0]}) jika tanggal transaksi tidak disebut/tidak terbaca.

Format JSON yang diwajibkan:
{
  "is_transaction": boolean, // true HANYA JIKA sedang di Fase Konfirmasi (User membalas YA ke Kartu Transaksi).
  "reply_text": "Isi balasanmu (Kartu Konfirmasi ATAU Pesan Sukses ATAU obrolan biasa)",
  "transaction_data": { // Jika is_transaction = true, isi data ini secara akurat. Jika false, set null.
    "tgl": "YYYY-MM-DD",
    "deskripsi": "deskripsi singkat transaksi",
    "volume": 1,
    "satuan": "ls",
    "harga_satuan": 0,
    "masuk": 0,
    "keluar": 0,
    "kategori": "Material", // Pilihan: 'Material' | 'Upah' | 'Operasional' | 'Pemasukan' | 'Transfer' | 'Transfer Internal' | 'Lainnya'
    "kas": "Nama Kas",
    "project_name": "Nama Proyek"
  }
}

Pesan Bot Sebelumnya (yang di-reply user): "${replyToMsg}"
Pesan user saat ini: "${cleanUserText}"`;

    const contents = [{
      parts: [{ text: prompt }]
    }];

    if (base64Image && mimeType) {
      contents[0].parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Image
        }
      });
    }

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
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
      const tgRes = await replyToTelegram(jsonResult.reply_text || "Halo! Ada yang bisa saya bantu catat?");
      return response.status(200).json({ status: 'chat_only', tgRes });
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
