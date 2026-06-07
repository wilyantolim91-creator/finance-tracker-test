import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Wallet, TrendingDown, TrendingUp, ArrowDownLeft, ArrowUpRight,
  Search, LayoutDashboard, Receipt, Settings, Plus, Filter,
  Building2, ChevronDown, Sparkles, Send, Check, X, Loader2,
  Camera, Paperclip, Mic, Edit2, Trash2, FileText, File,
  LogOut, Users, KeyRound, ShieldCheck, Eye, RefreshCw,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from './db';
import { supabase } from './supabaseConfig';

/* ─── CONSTANTS ─── */
const KAS_LIST  = ['KAS UTAMA','KAS AWEN','KAS WILY'];
const REAL_CATS = ['Material','Upah','Labor','Lainnya'];
const ALL_CATS  = ['Material','Upah','Labor','Lainnya','Transfer','Transfer Internal'];
const fmt  = n => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
const fmtS = n => fmt(n);
const TODAY = () => new Date().toISOString().slice(0,10);

/* ─── METRICS ─── */
function computeMetrics(totalKontrak, txs=[], dpMasukDb=0) {
  const sorted=[...txs].sort((a,b)=>a.tgl.localeCompare(b.tgl));
  const dpMasuk=(dpMasukDb !== undefined && dpMasukDb !== null && dpMasukDb > 0)
    ? dpMasukDb
    : sorted.filter(t=>t.kategori==='Transfer'&&t.masuk>0).reduce((s,t)=>s+t.masuk,0);
  const perKas=Object.fromEntries(KAS_LIST.map(k=>[k,0]));
  sorted.forEach(t=>{perKas[t.kas]=(perKas[t.kas]||0)+t.masuk-t.keluar;});
  const perKat={};
  sorted.forEach(t=>{if(REAL_CATS.includes(t.kategori))perKat[t.kategori]=(perKat[t.kategori]||0)+t.keluar;});
  const totalBiaya=Object.values(perKat).reduce((s,v)=>s+v,0);
  const saldoAkhir=Object.values(perKas).reduce((s,v)=>s+v,0);
  return{totalKontrak,dpMasuk,sisaPembayaran:totalKontrak-dpMasuk,perKas,perKat,totalBiaya,saldoAkhir,txs:[...sorted].reverse()};
}

const SYS=()=>`Kamu adalah Asisten Finansial AI Mrlims yang ramah, tidak kaku, dan interaktif (AI Agent). Kamu membantu pengguna mencatat transaksi keuangan (pemasukan, pengeluaran, atau transfer).
Tugasmu adalah melakukan percakapan dua arah dengan pengguna secara santai (tidak formal/tidak baku, gunakan kata seperti 'aku', 'oke', 'siap', dll) untuk mengumpulkan rincian transaksi:
- tgl (format YYYY-MM-DD, default hari ini: ${TODAY()})
- desc (deskripsi singkat barang/jasa)
- volume (kuantitas, default 1)
- satuan (satuan unit, default 'ls', misal 'sak', 'pcs', 'hari')
- harga_satuan (harga per unit)
- type ('Pemasukan' atau 'Pengeluaran')
- kategori (salah satu dari [${ALL_CATS.join(', ')}])
- kas (salah satu dari [${KAS_LIST.join(', ')}], default 'KAS UTAMA')
- tujuan (supplier, penerima, atau kas tujuan jika transfer)

Aturan interaksi:
1. Jika pengguna memberikan informasi parsial (misal: 'beli semen 10 sak'), tanggapi dengan santai dan tanyakan detail yang kurang (misal: 'Oke, siap! Aku catat beli semen 10 sak sebagai pengeluaran ya. Berapa harganya per sak atau total harganya?').
2. Jika pengguna memberikan informasi baru (misal: 'totalnya 500rb pakai kas awen'), update data transaksi tersebut dan beri tahu mereka bahwa datanya sudah siap disimpan.
3. Selalu sertakan rincian transaksi yang sedang didevelop di field 'transaction' pada output JSON kamu.

Format output wajib berupa JSON dengan skema berikut:
{
  "reply": "Tanggapan kamu kepada pengguna dalam bahasa Indonesia yang santai, bersahabat, dan tidak baku (gunakan kata 'aku', 'kamu', 'oke', 'siap', dll)",
  "transaction": {
    "tgl": "YYYY-MM-DD",
    "desc": "deskripsi transaksi",
    "volume": 10,
    "satuan": "sak",
    "harga_satuan": 50000,
    "type": "Pengeluaran",
    "kategori": "Material",
    "kas": "KAS AWEN",
    "tujuan": "Supplier"
  }
}
Catatan: Jika transaksi belum mulai terbentuk sama sekali, set "transaction" ke null. Tetapi jika sudah ada data parsial (seperti deskripsi atau volume), buat objek "transaction" dengan field yang belum diketahui bernilai null atau default.`;
async function parseAI(history, newMsg){
  const apiKey = localStorage.getItem('gemini_api_key') || process.env.REACT_APP_GEMINI_KEY || '';
  if (!apiKey) {
    throw new Error('Gemini API Key tidak terkonfigurasi. Silakan isi API Key di Settings.');
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
  
  // Convert history messages to Gemini API contents structure
  const contents = [];
  history.forEach(m => {
    // Skip welcome/system messages
    if (m.text && m.text.includes('Aku asisten keuangan AI')) return;
    contents.push({
      role: m.sender === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    });
  });
  
  // Append new input
  let newParts = [];
  if (typeof newMsg === 'string') {
    newParts = [{ text: newMsg }];
  } else if (Array.isArray(newMsg)) {
    newParts = newMsg.map(item => {
      if (item.type === 'text') {
        return { text: item.text };
      } else if (item.type === 'image') {
        return {
          inlineData: {
            mimeType: item.source.media_type,
            data: item.source.data
          }
        };
      }
      return item;
    });
  }
  
  contents.push({
    role: 'user',
    parts: newParts
  });

  const payload = {
    contents: contents,
    systemInstruction: { parts: [{ text: SYS() }] },
    generationConfig: { responseMimeType: "application/json" }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const errText = await r.text();
    if (r.status === 404) {
      try {
        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const listRes = await fetch(listUrl);
        if (listRes.ok) {
          const listData = await listRes.json();
          const modelNames = listData.models.map(m => m.name.replace('models/', '')).join(', ');
          throw new Error(`Model gemini-3.5-flash tidak ditemukan. Model yang tersedia untuk API Key Anda: ${modelNames}`);
        }
      } catch (e) {
        if (e.message.includes('tidak ditemukan')) {
          throw e;
        }
      }
    }
    throw new Error(`Gemini API Error: ${errText}`);
  }
  const d = await r.json();
  const raw = d.candidates[0].content.parts[0].text.trim();
  const o = JSON.parse(raw);
  
  const isIncome = o.transaction ? (o.transaction.type === 'Pemasukan' || (Number(o.transaction.masuk) || 0) > 0) : false;
  const type = isIncome ? 'Pemasukan' : 'Pengeluaran';
  const vol = o.transaction ? (Number(o.transaction.volume) || 1) : 1;
  const sat = o.transaction ? (o.transaction.satuan || 'ls') : 'ls';
  let hs = o.transaction ? (Number(o.transaction.harga_satuan) || 0) : 0;
  
  if (o.transaction && hs === 0) {
    const total = isIncome ? (Number(o.transaction.masuk) || 0) : (Number(o.transaction.keluar) || 0);
    if (total > 0) {
      hs = Math.round(total / vol);
    }
  }
  
  return {
    reply: o.reply || 'Oke, siap!',
    transaction: o.transaction ? {
      tgl: o.transaction.tgl || TODAY(),
      desc: o.transaction.desc || '',
      volume: vol,
      satuan: sat,
      harga_satuan: hs,
      type: type,
      kategori: ALL_CATS.includes(o.transaction.kategori) ? o.transaction.kategori : 'Lainnya',
      kas: KAS_LIST.includes(o.transaction.kas) ? o.transaction.kas : 'KAS UTAMA',
      tujuan: o.transaction.tujuan || ''
    } : null
  };
}
const toB64=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(f);});

/* ─── UI ATOMS ─── */
const CAT_CLS={Material:'text-amber-300 bg-amber-400/10 ring-amber-400/20',Upah:'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20',Labor:'text-teal-300 bg-teal-400/10 ring-teal-400/20',Transfer:'text-sky-300 bg-sky-400/10 ring-sky-400/20','Transfer Internal':'text-violet-300 bg-violet-400/10 ring-violet-400/20',Lainnya:'text-slate-300 bg-slate-400/10 ring-slate-400/20'};

function Card({label,value,sub,icon:I,accent,glowClass}){return(<div className={`relative overflow-hidden rounded-2xl glass-card glass-card-hover ${glowClass||'glow-sky'} p-5`}><div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-40 transition-opacity duration-300 ${accent}`}/><div className="flex items-center gap-2 text-slate-400"><I className="h-4 w-4 text-cyan-400 animate-pulse-slow"/><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span></div><div className="mt-3 text-2xl font-bold text-white tabular-nums tracking-tight">{value}</div>{sub&&<div className="mt-1 text-xs text-slate-500 font-medium">{sub}</div>}</div>);}

function FInput({label,v,onChange,type='text',opts}){const cls='w-full rounded-lg border border-white/10 bg-slate-800 px-2 py-1.5 text-white placeholder-slate-500 outline-none focus:border-cyan-400/40';return(<label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">{label}</span>{opts?<select value={v} onChange={e=>onChange(e.target.value)} className={cls}>{opts.map(o=><option key={o} className="bg-slate-800">{o}</option>)}</select>:<input type={type} value={v} onChange={e=>onChange(e.target.value)} className={cls}/>}</label>);}

/* ─── LOGIN ─── */
function LoginScreen({onLogin}){
  const[u,setU]=useState('');const[p,setP]=useState('');const[err,setErr]=useState('');const[loading,setLoading]=useState(false);
  const go=async()=>{if(!u||!p){setErr('Lengkapi username & password.');return;}setLoading(true);setErr('');
    try{const user=await db.login(u,p);onLogin(user);}catch(e){setErr(e.message||'Login gagal.');}finally{setLoading(false);}};
  return(<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 px-4">
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/80 p-8 backdrop-blur">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950"><Wallet className="h-6 w-6"/></div>
        <div className="flex items-center justify-center gap-2"><h1 className="text-2xl font-bold text-white">FinTrack</h1><span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[10px] font-bold text-cyan-300 ring-1 ring-cyan-400/30">V1</span></div>
        <p className="mt-1 text-xs text-slate-500">By <span className="font-medium text-slate-400">Mrlims</span> · Creator</p>
      </div>
      <div className="space-y-4">
        <div><label className="mb-1.5 block text-sm font-medium text-slate-300">Username</label><input value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Masukkan username" className="w-full rounded-xl border border-white/10 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 outline-none focus:border-cyan-400"/></div>
        <div><label className="mb-1.5 block text-sm font-medium text-slate-300">Password</label><input type="password" value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Masukkan password" className="w-full rounded-xl border border-white/10 bg-white px-4 py-2.5 text-slate-900 placeholder-slate-400 outline-none focus:border-cyan-400"/></div>
        {err&&<p className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{err}</p>}
        <button onClick={go} disabled={loading} className="mt-2 w-full rounded-xl bg-gradient-to-r from-sky-400 to-cyan-500 py-2.5 text-sm font-semibold text-slate-950 hover:opacity-90 disabled:opacity-60">{loading?'Memverifikasi…':'Masuk'}</button>
      </div>
    </div>
  </div>);
}

/* ─── USER MODAL ─── */
function UserModal({title,init,allProjects,onSave,onClose,isSelf}){
  const[f,setF]=useState(init||{username:'',password:'',role:'staff',assignedProjects:[]});
  const toggle=pr=>setF(x=>({...x,assignedProjects:x.assignedProjects.includes(pr)?x.assignedProjects.filter(q=>q!==pr):[...x.assignedProjects,pr]}));
  return(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
      <div className="mb-5 flex items-center justify-between"><h3 className="text-base font-semibold text-white">{title}</h3><button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-5 w-5"/></button></div>
      <div className="space-y-3">
        <div><label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Username</label><input value={f.username} disabled={!!init} onChange={e=>setF({...f,username:e.target.value})} placeholder="username" className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none disabled:opacity-50"/></div>
        <div><label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Password{init?' (kosong = tidak diubah)':''}</label><input type="password" value={f.password} onChange={e=>setF({...f,password:e.target.value})} placeholder="••••••••" className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-white placeholder-slate-500 outline-none"/></div>
        {!isSelf&&<div><label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Role</label><select value={f.role} onChange={e=>setF({...f,role:e.target.value})} className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none"><option value="staff" className="bg-slate-800">Staff</option><option value="admin" className="bg-slate-800">Admin</option></select></div>}
        {f.role!=='admin'&&<div><label className="mb-2 block text-[10px] uppercase tracking-wider text-slate-500">Akses Project</label><div className="space-y-2">{allProjects.map(pr=>(<label key={pr} className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 px-3 py-2.5 hover:bg-white/5"><input type="checkbox" checked={f.assignedProjects.includes(pr)} onChange={()=>toggle(pr)} className="h-4 w-4 accent-cyan-400"/><span className="text-sm text-slate-200">{pr}</span></label>))}</div></div>}
      </div>
      <div className="mt-5 flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5">Batal</button>
        <button onClick={()=>{onSave(f);onClose();}} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"><Check className="h-4 w-4"/> Simpan</button>
      </div>
    </div>
  </div>);
}

/* ─── SETTINGS PAGE ─── */
function SettingsPage({users,allProjects,currentUser,onUsersChange}){
  const[addOpen,setAddOpen]=useState(false);const[editUser,setEditUser]=useState(null);const[toast,setToast]=useState('');
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),2500);};
  const saveGeminiKey = () => {
    localStorage.setItem('gemini_api_key', geminiKey.trim());
    showToast('Gemini API Key berhasil disimpan.');
  };
  const handleAdd=async f=>{if(!f.username||!f.password){showToast('Username & password wajib.');return;}if(users.find(u=>u.username===f.username)){showToast('Username sudah ada.');return;}try{const newU=await db.addUser(f.username,f.password,f.role);await db.setUserProjects(newU.id,f.role==='admin'?[]:f.assignedProjects);onUsersChange();showToast(`User "${f.username}" ditambahkan.`);}catch(e){showToast('Gagal: '+e.message);}};
  const handleEdit=async(uid,uname,f)=>{try{const upd={role:f.isSelf?undefined:f.role};if(f.password)upd.password=f.password;Object.keys(upd).forEach(k=>upd[k]===undefined&&delete upd[k]);if(Object.keys(upd).length>0)await db.updateUser(uid,upd);if(!f.isSelf||f.role!=='admin')await db.setUserProjects(uid,f.role==='admin'?[]:f.assignedProjects);onUsersChange();showToast(`User "${uname}" diupdate.`);}catch(e){showToast('Gagal: '+e.message);}};
  const handleDel=async(uid,uname)=>{if(uname==='admin'||uname===currentUser.username){showToast('Tidak bisa hapus akun ini.');return;}try{await db.deleteUser(uid);onUsersChange();showToast(`User "${uname}" dihapus.`);}catch(e){showToast('Gagal: '+e.message);}};
  return(<div className="space-y-5">
    {toast&&<div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-xl bg-slate-700 px-5 py-2.5 text-sm text-white shadow-xl">{toast}</div>}
    {addOpen&&<UserModal title="Tambah Staff" allProjects={allProjects} onSave={handleAdd} onClose={()=>setAddOpen(false)}/>}
    {editUser&&<UserModal title={`Edit: ${editUser.username}`} allProjects={allProjects} isSelf={editUser.username===currentUser.username} init={{username:editUser.username,password:'',role:editUser.role,assignedProjects:editUser.assignedProjects||[]}} onSave={f=>handleEdit(editUser.id,editUser.username,f)} onClose={()=>setEditUser(null)}/>}
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center gap-2"><KeyRound className="h-4 w-4 text-cyan-400"/><span className="text-sm font-semibold text-white">Akun Saya</span></div>
      <div className="flex items-center justify-between">
        <div><p className="text-sm font-medium text-white">{currentUser.username}</p><p className="mt-0.5 text-xs capitalize text-slate-400">{currentUser.role}</p></div>
        <button onClick={()=>setEditUser(users.find(u=>u.id===currentUser.id))} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"><KeyRound className="h-3.5 w-3.5"/> Ganti Password</button>
      </div>
    </div>
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyan-400"/><span className="text-sm font-semibold text-white">Konfigurasi AI Assistant</span></div>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">Masukkan Gemini API Key Anda untuk mengaktifkan fitur Asisten AI. Kunci ini akan disimpan secara lokal di browser Anda.</p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="AIzaSy..."
            value={geminiKey}
            onChange={e=>setGeminiKey(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-400/40"
          />
          <button
            onClick={saveGeminiKey}
            className="rounded-lg bg-gradient-to-r from-sky-400 to-cyan-500 px-4 py-1.5 text-xs font-semibold text-slate-950 hover:opacity-90"
          >
            Simpan Key
          </button>
        </div>
      </div>
    </div>
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2"><Users className="h-4 w-4 text-cyan-400"/><span className="text-sm font-semibold text-white">Manajemen User</span></div>
        <button onClick={()=>setAddOpen(true)} className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-400 to-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950"><Plus className="h-3.5 w-3.5"/> Tambah Staff</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="text-left text-[10px] uppercase tracking-wider text-slate-500"><th className="pb-3 pr-4">Username</th><th className="pb-3 pr-4">Role</th><th className="pb-3 pr-4">Akses</th><th className="pb-3 text-center">Aksi</th></tr></thead>
        <tbody>{users.map(ud=>(<tr key={ud.id} className="border-t border-white/5">
          <td className="py-3 pr-4"><div className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-full bg-cyan-400/10 text-xs font-bold text-cyan-300">{ud.username[0].toUpperCase()}</div><span className="font-medium text-white">{ud.username}</span>{ud.username===currentUser.username&&<span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] text-slate-400">Saya</span>}</div></td>
          <td className="py-3 pr-4"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${ud.role==='admin'?'bg-violet-400/10 text-violet-300 ring-violet-400/20':'bg-emerald-400/10 text-emerald-300 ring-emerald-400/20'}`}>{ud.role==='admin'?<ShieldCheck className="h-3 w-3"/>:<Eye className="h-3 w-3"/>}{ud.role==='admin'?'Admin':'Staff'}</span></td>
          <td className="py-3 pr-4">{ud.role==='admin'?<span className="text-xs text-slate-400">Semua project</span>:<div className="flex flex-wrap gap-1">{(ud.assignedProjects||[]).length===0?<span className="text-xs text-slate-500">Belum ada</span>:(ud.assignedProjects||[]).map(pr=><span key={pr} className="rounded-md bg-sky-400/10 px-2 py-0.5 text-[10px] text-sky-300">{pr}</span>)}</div>}</td>
          <td className="py-3 text-center"><div className="flex justify-center gap-1"><button onClick={()=>setEditUser(ud)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-cyan-300"><Edit2 className="h-3.5 w-3.5"/></button>{ud.username!=='admin'&&ud.username!==currentUser.username&&<button onClick={()=>handleDel(ud.id,ud.username)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5"/></button>}</div></td>
        </tr>))}</tbody></table>
      </div>
    </div>
  </div>);
}

/* ─── FORM MODAL ─── */
function FormModal({title,transaction,onSave,onClose}){
  const [f, setF] = useState(() => {
    if (transaction) {
      const isIncome = transaction.masuk > 0;
      return {
        tgl: transaction.tgl || TODAY(),
        desc: transaction.desc || '',
        volume: transaction.volume || 1,
        satuan: transaction.satuan || 'ls',
        harga_satuan: transaction.harga_satuan || 0,
        type: isIncome ? 'Pemasukan' : 'Pengeluaran',
        tujuan: transaction.tujuan || '',
        kategori: transaction.kategori || 'Material',
        kas: transaction.kas || 'KAS UTAMA'
      };
    }
    return {
      tgl: TODAY(),
      desc: '',
      volume: 1,
      satuan: 'ls',
      harga_satuan: 0,
      type: 'Pengeluaran',
      tujuan: '',
      kategori: 'Material',
      kas: 'KAS UTAMA'
    };
  });

  return(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e=>e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-white">{title}</h3><button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-5 w-5"/></button></div>
      <div className="grid grid-cols-2 gap-3">
        <FInput label="Tanggal" v={f.tgl} type="date" onChange={v=>setF({...f,tgl:v})}/><FInput label="Kas" v={f.kas} opts={KAS_LIST} onChange={v=>setF({...f,kas:v})}/>
        <div className="col-span-2"><FInput label="Deskripsi" v={f.desc} onChange={v=>setF({...f,desc:v})}/></div>
        <FInput label="Tipe" v={f.type} opts={['Pengeluaran','Pemasukan']} onChange={v=>setF({...f,type:v})}/><FInput label="Kategori" v={f.kategori} opts={ALL_CATS} onChange={v=>setF({...f,kategori:v})}/>
        <FInput label="Volume" v={f.volume} type="number" onChange={v=>setF({...f,volume:Number(v)||1})}/><FInput label="Satuan" v={f.satuan} onChange={v=>setF({...f,satuan:v})}/>
        <FInput label="Harga Satuan" v={f.harga_satuan} type="number" onChange={v=>setF({...f,harga_satuan:Number(v)||0})}/>
        <div className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Total (Terkunci)</span><div className="w-full rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 font-semibold">{fmt(f.volume * f.harga_satuan)}</div></div>
        <div className="col-span-2"><FInput label="Tujuan" v={f.tujuan||''} onChange={v=>setF({...f,tujuan:v})}/></div>
      </div>
      <div className="mt-5 flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5">Batal</button>
        <button onClick={()=>{
          const total = Math.round(f.volume * f.harga_satuan);
          onSave({
            tgl: f.tgl,
            desc: f.desc,
            volume: f.volume,
            satuan: f.satuan,
            harga_satuan: f.harga_satuan,
            masuk: f.type === 'Pemasukan' ? total : 0,
            keluar: f.type === 'Pengeluaran' ? total : 0,
            kategori: f.kategori,
            kas: f.kas,
            tujuan: f.tujuan
          });
          onClose();
        }} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"><Check className="h-4 w-4"/> Simpan</button>
      </div>
    </div>
  </div>);
}

/* ─── FLOATING AI ─── */
const SUGGESTIONS = [
  'beli semen 10 sak seharga 50rb',
  'bayar gaji tukang keramik 4 juta pakai kas wily',
  'DP proyek masuk 56 juta ke kas utama',
  'transfer 10 juta dari kas utama ke kas awen'
];

function FloatingAI({onAdd}){
  const[open,setOpen]=useState(false);
  const[text,setText]=useState('');
  const[status,setStatus]=useState('');
  const[messages,setMessages]=useState([
    { sender: 'ai', text: 'Halo! Aku asisten keuangan AI Mrlims. 👑\n\nKirimkan foto kuitansi/nota belanja, atau ketik rincian transaksi secara santai (misal: "beli semen 10 sak seharga 50rb"). Aku siap bantu catat!' }
  ]);
  const[parsed,setParsed]=useState(null);
  const[editDetails,setEditDetails]=useState(false);
  const[note,setNote]=useState('');
  const recRef=React.useRef(null);
  const messagesEndRef=React.useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, status]);

  const reset=()=>{
    setParsed(null);
    setEditDetails(false);
    setNote('');
    setStatus('');
    setMessages([
      { sender: 'ai', text: 'Halo! Aku asisten keuangan AI Mrlims. 👑\n\nKirimkan foto kuitansi/nota belanja, atau ketik rincian transaksi secara santai (misal: "beli semen 10 sak seharga 50rb"). Aku siap bantu catat!' }
    ]);
  };

  const handleSend=async(inputText, file=null)=>{
    let userMsg = '';
    let apiInput = '';

    if (file) {
      setStatus('thinking');
      setNote('');
      try {
        const b64 = await toB64(file);
        userMsg = 'Mengirim foto nota...';
        apiInput = [
          { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: b64 } },
          { type: 'text', text: 'Ekstrak rincian transaksi dari nota ini.' }
        ];
      } catch (err) {
        setNote('Gagal membaca file: ' + err.message);
        setStatus('');
        return;
      }
    } else {
      if (!inputText.trim()) return;
      userMsg = inputText;
      apiInput = inputText;
      setText('');
    }

    const updatedMessages = [...messages, { sender: 'user', text: userMsg }];
    setMessages(updatedMessages);
    setStatus('thinking');

    try {
      const res = await parseAI(messages, apiInput);
      setMessages(prev => [...prev, { sender: 'ai', text: res.reply }]);
      if (res.transaction) {
        setParsed(res.transaction);
        setEditDetails(false); // Default to clean summary view
      }
    } catch (err) {
      setMessages(prev => [...prev, { sender: 'ai', text: 'Aduh maaf, aku mengalami kendala saat memproses pesanmu. Bisa diulang?' }]);
      setNote(err.message || 'Error memproses.');
    } finally {
      setStatus('');
    }
  };

  const startVoice=()=>{
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){setNote('Browser belum support rekam suara.');return;}
    const rec=new SR();
    rec.lang='id-ID';
    rec.continuous=false;
    rec.onresult=e=>setText(Array.from(e.results).map(r=>r[0].transcript).join(''));
    rec.onend=()=>setStatus('');
    recRef.current=rec;
    try{rec.start();setStatus('listening');setNote('');}catch{}
  };

  const stopVoice=()=>{
    if(recRef.current)try{recRef.current.stop();}catch{}
    setStatus('');
  };

  return(<>
    {!open&&<button onClick={()=>setOpen(true)} className="fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 shadow-xl hover:scale-105 transition"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/40"/><Sparkles className="relative h-6 w-6"/></button>}
    {open&&<div className="fixed bottom-20 right-4 z-50 flex w-[min(92vw,400px)] h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 bg-slate-950/40">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 font-bold">
              <Sparkles className={`h-4.5 w-4.5 ${status === 'thinking' ? 'animate-spin' : ''}`} />
            </div>
            <span className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-slate-900 ${status === 'thinking' ? 'bg-amber-400' : status === 'listening' ? 'bg-rose-500 animate-ping' : 'bg-emerald-400'}`} />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Asisten Keuangan 👑</span>
            <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              {status === 'thinking' ? 'Sedang berpikir…' : status === 'listening' ? 'Mendengarkan…' : 'Online'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={reset} title="Reset Chat" className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"><RefreshCw className="h-4 w-4"/></button>
          <button onClick={()=>{setOpen(false);}} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition"><X className="h-4 w-4"/></button>
        </div>
      </div>

      {/* CHAT MESSAGES */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/20">
        {messages.map((m, idx) => (
          <div key={idx} className={`flex gap-2.5 items-start ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.sender === 'ai' && (
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-400/20">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
            )}
            <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-xs whitespace-pre-wrap shadow-lg ${m.sender === 'user' ? 'bg-gradient-to-br from-sky-500 to-cyan-500 text-slate-950 rounded-tr-none font-semibold' : 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'}`}>
              {m.text}
              
              {/* SUGGESTION CHIPS FOR GREETING */}
              {m.sender === 'ai' && idx === 0 && messages.length === 1 && (
                <div className="mt-4 space-y-2 border-t border-white/5 pt-3">
                  <p className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Rekomendasi Perintah:</p>
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTIONS.map((sug, sidx) => (
                      <button
                        key={sidx}
                        onClick={() => handleSend(sug)}
                        className="w-full text-left rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2 text-[11px] text-cyan-300 transition hover:bg-white/[0.08] hover:text-cyan-200 flex items-center gap-1.5"
                      >
                        <span className="text-cyan-500">✦</span>
                        <span>"{sug}"</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {status==='thinking'&& (
          <div className="flex gap-2.5 items-start justify-start">
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-400/20">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            </div>
            <div className="max-w-[78%] rounded-2xl rounded-tl-none border border-white/5 bg-slate-800 px-3.5 py-3 text-xs text-slate-200 shadow-lg">
              <div className="flex items-center gap-2">
                <div className="flex gap-1 items-center">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.3s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400 [animation-delay:-0.15s]"></span>
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400"></span>
                </div>
                <span className="text-slate-400 font-medium animate-pulse">Mrlims AI sedang mengetik…</span>
              </div>
            </div>
          </div>
        )}
        {note&&<div className="rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{note}</div>}
        <div ref={messagesEndRef} />
      </div>

      {/* DRAFT PROPOSAL CARD */}
      {parsed && (
        <div className="border-t border-white/10 bg-slate-900/95 p-3.5 shadow-2xl max-h-[42vh] overflow-y-auto backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-wider text-cyan-400 uppercase">📝 HASIL ANALISIS AI (DRAFT)</span>
            <button onClick={() => setParsed(null)} className="text-[10px] text-rose-400 hover:underline">Hapus Draft</button>
          </div>

          <div className="rounded-xl border border-cyan-400/20 bg-slate-950/40 p-3 shadow-inner">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-bold text-cyan-400 uppercase tracking-wider">DRAFT TRANSAKSI</span>
                <h4 className="mt-1 text-xs font-semibold text-white truncate">{parsed.desc || '(Belum ada deskripsi)'}</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {parsed.volume} {parsed.satuan} @ {fmt(parsed.harga_satuan)}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold text-cyan-300 tabular-nums">
                  {fmt(parsed.volume * parsed.harga_satuan)}
                </div>
                <div className="mt-1.5 flex gap-1 justify-end">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-300 border border-white/5">{parsed.kas}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-medium text-slate-300 border border-white/5">{parsed.kategori}</span>
                </div>
              </div>
            </div>
            
            <button onClick={() => setEditDetails(!editDetails)} className="mt-2 text-[10px] text-slate-400 hover:text-white flex items-center gap-1 transition">
              <Edit2 className="h-3 w-3" />
              {editDetails ? 'Sembunyikan Form Edit' : 'Edit Detail Transaksi'}
            </button>
          </div>

          {editDetails && (
            <div className="grid grid-cols-2 gap-2 mt-3 p-2 border border-white/5 rounded-xl bg-white/[0.01]">
              <FInput label="Tanggal" v={parsed.tgl} type="date" onChange={v=>setParsed({...parsed,tgl:v})}/>
              <FInput label="Kas" v={parsed.kas} opts={KAS_LIST} onChange={v=>setParsed({...parsed,kas:v})}/>
              <div className="col-span-2"><FInput label="Deskripsi" v={parsed.desc} onChange={v=>setParsed({...parsed,desc:v})}/></div>
              <FInput label="Tipe" v={parsed.type} opts={['Pengeluaran','Pemasukan']} onChange={v=>setParsed({...parsed,type:v})}/>
              <FInput label="Kategori" v={parsed.kategori} opts={ALL_CATS} onChange={v=>setParsed({...parsed,kategori:v})}/>
              <FInput label="Volume" v={parsed.volume} type="number" onChange={v=>setParsed({...parsed,volume:Number(v)||1})}/>
              <FInput label="Satuan" v={parsed.satuan} onChange={v=>setParsed({...parsed,satuan:v})}/>
              <FInput label="Harga Satuan" v={parsed.harga_satuan} type="number" onChange={v=>setParsed({...parsed,harga_satuan:Number(v)||0})}/>
              <div className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Total (Terkunci)</span><div className="w-full rounded-lg border border-white/10 bg-slate-800/50 px-2 py-1.5 text-xs text-slate-400 font-semibold">{fmt(parsed.volume * parsed.harga_satuan)}</div></div>
              <div className="col-span-2"><FInput label="Tujuan" v={parsed.tujuan} onChange={v=>setParsed({...parsed,tujuan:v})}/></div>
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button onClick={reset} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-slate-400 hover:bg-white/5 transition">Reset Chat</button>
            <button onClick={()=>{
              const total = Math.round(parsed.volume * parsed.harga_satuan);
              onAdd({
                tgl: parsed.tgl,
                desc: parsed.desc,
                volume: parsed.volume,
                satuan: parsed.satuan,
                harga_satuan: parsed.harga_satuan,
                masuk: parsed.type === 'Pemasukan' ? total : 0,
                keluar: parsed.type === 'Pengeluaran' ? total : 0,
                kategori: parsed.kategori,
                kas: parsed.kas,
                tujuan: parsed.tujuan
              });
              setMessages(prev => [...prev, { sender: 'ai', text: `✅ Siap bos! Transaksi "${parsed.desc}" sebesar ${fmt(total)} sudah berhasil dicatat dan disinkronkan ke Google Sheets.` }]);
              setParsed(null);
            }} className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 transition"><Check className="h-3.5 w-3.5"/> Simpan Transaksi</button>
          </div>
        </div>
      )}

      {/* INPUT PANEL */}
      <div className="border-t border-white/10 p-3 bg-slate-900">
        {status==='listening'&&<p className="mb-2 flex items-center gap-2 text-xs text-cyan-300"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400"/> Mendengarkan suara…</p>}
        <div className="flex items-end gap-2">
          <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 transition"><Camera className="h-4 w-4"/><input type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>handleSend('', e.target.files?.[0])}/></label>
          <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10 transition"><Paperclip className="h-4 w-4"/><input type="file" accept="image/*,application/pdf" className="hidden" onChange={e=>handleSend('', e.target.files?.[0])}/></label>
          <textarea value={text} onChange={e=>setText(e.target.value)} rows={1} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend(text);}}} placeholder="Tulis rincian transaksi..." className="max-h-24 min-h-[36px] flex-1 resize-none rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"/>
          <button onMouseDown={startVoice} onMouseUp={stopVoice} onMouseLeave={stopVoice} onTouchStart={e=>{e.preventDefault();startVoice();}} onTouchEnd={e=>{e.preventDefault();stopVoice();}} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition ${status==='listening'?'border-cyan-400 bg-cyan-400 text-slate-950':'border-white/10 bg-white/[0.04] text-slate-300'}`}><Mic className="h-4 w-4"/></button>
          <button onClick={()=>handleSend(text)} disabled={!text.trim()||status==='thinking'} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 disabled:opacity-40"><Send className="h-4 w-4"/></button>
        </div>
      </div>
    </div>}
  </>);
}

/* ─── ROOT ─── */
export default function App(){
  const[currentUser,setCurrentUser]=useState(null);
  if(!currentUser)return<LoginScreen onLogin={setCurrentUser}/>;
  return<MainApp currentUser={currentUser} onLogout={()=>setCurrentUser(null)}/>;
}

/* ─── MAIN APP ─── */
function MainApp({currentUser,onLogout}){
  const[projects,setProjects]=useState([]);const[users,setUsers]=useState([]);const[transactions,setTxs]=useState({});
  const[loading,setLoading]=useState(true);const[project,setProject]=useState('');const[tab,setTab]=useState('dashboard');
  const[kasFilter,setKasFilter]=useState('ALL');const[search,setSearch]=useState('');const[editTx,setEditTx]=useState(null);const[showAdd,setShowAdd]=useState(false);

  const isAdmin=currentUser.role==='admin';
  const visProj=projects.filter(p=>isAdmin||currentUser.assignedProjects.includes(p.name)).map(p=>p.name);
  const proj=visProj.includes(project)?project:(visProj[0]||'');

  const loadAll=useCallback(async()=>{setLoading(true);try{const[pList,uList]=await Promise.all([db.getProjects(),db.getUsers()]);setProjects(pList);setUsers(uList);if(!project&&pList.length>0)setProject(pList[0].name);}catch(e){console.error(e);}finally{setLoading(false);}},[]); // eslint-disable-line
  const loadTxs=useCallback(async pName=>{if(!pName)return;try{const data=await db.getTransactions(pName);setTxs(prev=>({...prev,[pName]:data}));}catch(e){console.error(e);}},[]); // eslint-disable-line

  useEffect(()=>{loadAll();},[loadAll]);
  useEffect(()=>{if(proj)loadTxs(proj);},[proj,loadTxs]);

  // ── Realtime subscription: auto-update when data changes ──
  useEffect(()=>{
    if(!proj)return;
    const channel=supabase
      .channel(`tx-realtime-${proj}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>{
        loadTxs(proj);
      })
      .subscribe();
    return()=>{supabase.removeChannel(channel);};
  },[proj,loadTxs]);

  // ── Realtime subscription: auto-update when projects change ──
  useEffect(()=>{
    const channel=supabase
      .channel('projects-realtime')
      .on('postgres_changes',{event:'*',schema:'public',table:'projects'},()=>{
        loadAll();
      })
      .subscribe();
    return()=>{supabase.removeChannel(channel);};
  },[loadAll]);

  const projData=projects.find(p=>p.name===proj);
  const txList=useMemo(()=>transactions[proj]||[],[transactions,proj]);
  const m=useMemo(()=>computeMetrics(projData?.total_kontrak||0,txList,projData?.dp_masuk||0),[projData,txList]);

  const handleAdd=async tx=>{try{await db.addTransaction(proj,tx);await loadTxs(proj);}catch(e){alert('Gagal simpan: '+e.message);}};
  const handleSave=async tx=>{try{if(editTx?.id){await db.updateTransaction(editTx.id,tx);}else{await db.addTransaction(proj,tx);}await loadTxs(proj);setEditTx(null);}catch(e){alert('Gagal: '+e.message);}};
  const handleDelete=async id=>{if(!window.confirm('Hapus transaksi ini?'))return;try{await db.deleteTransaction(id);await loadTxs(proj);}catch(e){alert('Gagal hapus: '+e.message);}};

  const dlXLS=()=>{
    if (projData?.sheet_gid) {
      const url = `https://docs.google.com/spreadsheets/d/1zdA8vm_aBmSXkVPXWZces2pfKfBDS0WtKbfSYAozDEs/export?format=xlsx&gid=${projData.sheet_gid}`;
      window.open(url, '_blank');
      return;
    }

    const wb=XLSX.utils.book_new();
    const rows = [];
    
    // Helper to format cells with thousands separator and write formulas
    const numCell = (val) => ({ v: Number(val) || 0, t: 'n', z: '#,##0' });
    const formulaCell = (formula) => ({ f: formula, t: 'n', z: '#,##0' });

    // Row 1: PROJECT: KARANTINA 59
    rows.push([`PROJECT: ${proj}`]);
    rows.push([]);
    
    // Row 3: REKAPAN PROJECT
    rows.push(['REKAPAN PROJECT']);
    // Row 4: Total Kontrak (E4)
    rows.push(['Total Kontrak:', '', '', '', numCell(m.totalKontrak)]);
    // Row 5: DP Masuk (E5)
    rows.push(['DP Masuk:', '', '', '', numCell(m.dpMasuk)]);
    // Row 6: Sisa Pembayaran Klien (E6 = E4-E5)
    rows.push(['Sisa Pembayaran Klien:', '', '', '', formulaCell('E4-E5')]);
    
    rows.push([]);
    rows.push([]);
    rows.push([]);
    
    // Row 10: SALDO AKHIR (E10 = E5 - E11)
    rows.push(['SALDO AKHIR:', '', '', '', formulaCell('E5-E11')]);
    // Row 11: TOTAL PENGELUARAN (E11 = SUM(G14:G[lastRow]))
    const lastRowIdx = 13 + txList.length;
    const totalPengeluaranFormula = txList.length > 0 ? `SUM(G14:G${lastRowIdx})` : '0';
    rows.push(['TOTAL PENGELUARAN:', '', '', '', formulaCell(totalPengeluaranFormula)]);
    
    rows.push([]);
    
    // Row 13: Table Header
    rows.push([
      'Tanggal',      // A
      'Description',  // B
      'Volume',       // C
      'Satuan',       // D
      'Nilai Satuan', // E
      'Masuk',        // F
      'Keluar',       // G
      'Saldo',        // H
      'Tujuan',       // I
      'Kategori',     // J
      'Kas'           // K
    ]);
    
    // Row 14+: Transactions
    const chronologicalTxs = [...txList].sort((a,b)=>a.tgl.localeCompare(b.tgl));
    
    chronologicalTxs.forEach((t, index) => {
      const currentRow = 14 + index;
      let saldoFormula;
      if (index === 0) {
        saldoFormula = `F${currentRow}-G${currentRow}`;
      } else {
        saldoFormula = `H${currentRow-1}+F${currentRow}-G${currentRow}`;
      }
      
      rows.push([
        t.tgl || '',
        t.desc || '',
        t.volume || 1,
        t.satuan || 'ls',
        numCell(t.harga_satuan || t.masuk || t.keluar || 0),
        numCell(t.masuk || 0),
        numCell(t.keluar || 0),
        formulaCell(saldoFormula),
        t.tujuan || '',
        t.kategori || '',
        t.kas || ''
      ]);
    });
    
    const ws = XLSX.utils.aoa_to_sheet(rows);
    
    // Set column widths
    ws['!cols'] = [
      { wch: 12 }, // A: Tanggal
      { wch: 30 }, // B: Description
      { wch: 8 },  // C: Volume
      { wch: 8 },  // D: Satuan
      { wch: 15 }, // E: Nilai Satuan
      { wch: 15 }, // F: Masuk
      { wch: 15 }, // G: Keluar
      { wch: 15 }, // H: Saldo
      { wch: 15 }, // I: Tujuan
      { wch: 15 }, // J: Kategori
      { wch: 15 }  // K: Kas
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, proj);
    XLSX.writeFile(wb, `${proj}_${TODAY()}.xlsx`);
  };
  const dlPDF=()=>{
    const doc=new jsPDF();
    
    // Page Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42); // slate-900
    doc.text(`LAPORAN KEUANGAN: ${proj.toUpperCase()}`, 14, 20);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`Tanggal Unduh: ${new Date().toLocaleDateString('id-ID')}`, 14, 26);
    
    // Divider line
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.5);
    doc.line(14, 30, 196, 30);
    
    // Summary Section styled as a clean table (resembling the top section of the spreadsheet)
    autoTable(doc, {
      startY: 35,
      theme: 'plain',
      styles: { fontSize: 10, cellPadding: 3, textColor: [51, 65, 85] },
      columnStyles: {
        0: { fontStyle: 'bold', width: 60 },
        1: { halign: 'right', fontStyle: 'bold', width: 40 }
      },
      body: [
        ['Total Kontrak', fmt(m.totalKontrak)],
        ['DP Masuk', fmt(m.dpMasuk)],
        ['Sisa Pembayaran', fmt(m.sisaPembayaran)],
        ['Total Pengeluaran', fmt(m.totalBiaya)],
        ['Saldo Akhir', fmt(m.saldoAkhir)]
      ],
      didParseCell: (data) => {
        if (data.row.index === 4) {
          data.cell.styles.fillColor = [241, 245, 249]; // light gray for Saldo Akhir
        }
        if (data.row.index === 2 && m.sisaPembayaran < 0) {
          data.cell.styles.textColor = [220, 38, 38]; // red for negative balance
        }
      }
    });

    let currentY = doc.lastAutoTable.finalY + 8;
    
    // Cash balances and categories in side-by-side columns
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Saldo per Kas', 14, currentY);
    doc.text('Pengeluaran per Kategori', 110, currentY);
    
    const kasRows = KAS_LIST.map(k=>[k, fmt(m.perKas[k])]);
    const katRows = Object.entries(m.perKat).map(([k,v])=>[k, fmt(v)]);
    const maxRows = Math.max(kasRows.length, katRows.length);
    
    const summaryBody = [];
    for (let i = 0; i < maxRows; i++) {
      const kas = kasRows[i] || ['', ''];
      const kat = katRows[i] || ['', ''];
      summaryBody.push([kas[0], kas[1], '', kat[0], kat[1]]);
    }
    
    autoTable(doc, {
      startY: currentY + 3,
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2.5, textColor: [71, 85, 105] },
      columnStyles: {
        0: { width: 40 },
        1: { halign: 'right', fontStyle: 'bold', width: 35 },
        2: { width: 20 },
        3: { width: 45 },
        4: { halign: 'right', fontStyle: 'bold', width: 35 }
      },
      body: summaryBody
    });
    
    currentY = doc.lastAutoTable.finalY + 10;
    
    // Transactions Table
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Daftar Transaksi', 14, currentY);
    
    let runningSaldo = 0;
    const chronologicalTxs = [...txList].sort((a,b)=>a.tgl.localeCompare(b.tgl));
    
    const tableBody = chronologicalTxs.map(t => {
      runningSaldo = runningSaldo + t.masuk - t.keluar;
      let descText = t.desc || '';
      if ((t.volume && t.volume > 1) || (t.satuan && t.satuan !== 'ls') || (t.harga_satuan && t.harga_satuan > 0)) {
        descText += `\n(${t.volume} ${t.satuan} @ ${fmt(t.harga_satuan)})`;
      }
      return [
        t.tgl ? new Date(t.tgl).toLocaleDateString('id-ID') : '', // Tanggal
        descText,               // Deskripsi
        t.kategori || '',       // Kategori
        t.kas || '',            // Kas
        t.masuk > 0 ? fmt(t.masuk) : '-',
        t.keluar > 0 ? fmt(t.keluar) : '-',
        fmt(runningSaldo)       // Saldo
      ];
    }).reverse(); // Latest first in list
    
    autoTable(doc, {
      startY: currentY + 3,
      head: [['Tanggal', 'Deskripsi', 'Kategori', 'Kas', 'Masuk', 'Keluar', 'Saldo']],
      body: tableBody,
      theme: 'striped',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' }, // slate-800
      styles: { fontSize: 8, cellPadding: 2.5, textColor: [51, 65, 85] },
      columnStyles: {
        0: { width: 20, halign: 'center' },
        1: { width: 52 },
        2: { width: 25, halign: 'center' },
        3: { width: 22, halign: 'center' },
        4: { width: 24, halign: 'right' },
        5: { width: 24, halign: 'right' },
        6: { width: 25, halign: 'right' }
      }
    });
    
    doc.save(`${proj}_${TODAY()}.pdf`);
  };

  const filtTxs=txList.filter(t=>(kasFilter==='ALL'||t.kas===kasFilter)&&(t.desc||'').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.tgl.localeCompare(a.tgl));
  const maxKat=Math.max(...Object.values(m.perKat),1);
  const navItems=[{id:'dashboard',label:'Dashboard',icon:LayoutDashboard},{id:'transactions',label:'Transaksi',icon:Receipt},...(isAdmin?[{id:'settings',label:'Pengaturan',icon:Settings}]:[])];

  if(loading)return(<div className="flex min-h-screen items-center justify-center bg-slate-950"><div className="flex flex-col items-center gap-3"><Loader2 className="h-8 w-8 animate-spin text-cyan-400"/><p className="text-sm text-slate-400">Memuat data…</p></div></div>);

  return(
    <div className="relative min-h-screen w-full bg-[#020617] text-slate-200 overflow-hidden font-sans">
      {/* Background Ambient Glowing Blobs */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[120px] pointer-events-none animate-pulse-slow" />
      <div className="absolute top-[30%] left-[20%] w-[350px] h-[350px] rounded-full bg-violet-600/5 blur-[100px] pointer-events-none animate-float-slow" />

      {isAdmin&&<FloatingAI onAdd={handleAdd}/>}
      {showAdd&&isAdmin&&<FormModal title="Tambah Transaksi" onSave={handleSave} onClose={()=>setShowAdd(false)}/>}
      {editTx&&isAdmin&&<FormModal title="Edit Transaksi" transaction={editTx} onSave={handleSave} onClose={()=>setEditTx(null)}/>}

      <div className="relative z-10 flex">
        {/* SIDEBAR */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col px-5 py-7 lg:flex glass-sidebar">
          <div className="mb-9 flex items-center gap-3 px-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20 animate-float-medium">
              <Wallet className="h-5.5 w-5.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold text-white tracking-tight">FinTrack</span>
                <span className="rounded-full bg-cyan-400/20 px-2 py-0.5 text-[9px] font-bold text-cyan-300 ring-1 ring-cyan-400/30">PRO</span>
              </div>
              <div className="text-[10px] text-slate-500 font-medium">By <span className="text-slate-400">Mrlims</span> · Creator</div>
            </div>
          </div>
          
          <nav className="flex flex-col gap-2">
            {navItems.map(it=>(
              <button 
                key={it.id} 
                onClick={()=>setTab(it.id)} 
                className={`relative flex items-center gap-3.5 rounded-xl px-4 py-3 text-sm font-semibold transition-all duration-300 group ${
                  tab===it.id 
                    ? 'bg-gradient-to-r from-sky-500/10 to-indigo-500/10 text-white border border-white/5 shadow-md' 
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                {tab===it.id && <span className="absolute left-0 top-2 bottom-2 w-1.5 bg-gradient-to-b from-sky-400 to-cyan-500 rounded-r-full" />}
                <it.icon className={`h-4.5 w-4.5 transition-transform duration-300 group-hover:scale-110 ${tab===it.id?'text-cyan-400':'text-slate-400'}`}/>
                {it.label}
              </button>
            ))}
          </nav>
          
          <div className="mt-auto rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs text-slate-400 backdrop-blur">
            <div className="flex items-center gap-2 font-semibold text-white">
              <div className="h-2 w-2 rounded-full bg-cyan-400" />
              {currentUser.username}
            </div>
            <div className="mt-1.5 text-[10px] text-slate-500 font-medium capitalize">
              {isAdmin?'Akses semua project':(currentUser.assignedProjects||[]).join(', ')}
            </div>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <main className="min-w-0 flex-1 px-4 lg:px-8">
          {/* FLOATING HEADER */}
          <header className="sticky top-4 z-10 my-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-slate-950/40 p-4 shadow-2xl backdrop-blur-md">
            <div className="flex items-center gap-3.5">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-sky-400/10 text-sky-400">
                <Building2 className="h-4.5 w-4.5"/>
              </div>
              <div className="relative">
                <select 
                  value={proj} 
                  onChange={e=>setProject(e.target.value)} 
                  className="appearance-none rounded-xl border border-white/10 bg-slate-900/80 py-2 pl-3.5 pr-10 text-sm font-bold text-white outline-none focus:border-cyan-400/40 cursor-pointer"
                >
                  {visProj.map(p=><option key={p} className="bg-slate-950 text-white">{p}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/>
              </div>
              <button onClick={()=>loadTxs(proj)} title="Refresh Data" className="rounded-xl p-2 text-slate-400 hover:bg-white/5 hover:text-white transition-all"><RefreshCw className="h-4 w-4"/></button>
            </div>
            
            <div className="flex items-center gap-2.5">
              {isAdmin&&<>
                <button onClick={()=>setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-lg shadow-cyan-400/10 hover:opacity-90 transition-all"><Plus className="h-4 w-4"/> Manual</button>
                <button onClick={dlXLS} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition-all"><FileText className="h-4 w-4"/> XLS</button>
                <button onClick={dlPDF} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition-all"><File className="h-4 w-4"/> PDF</button>
              </>}
              <div className="flex items-center gap-1.5 rounded-xl border border-white/5 bg-emerald-500/5 px-3 py-2 text-[10px] font-bold text-emerald-400 tracking-wider uppercase"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"/><span>Synced</span></div>
              <button onClick={onLogout} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 hover:text-rose-400 hover:border-rose-500/20 transition-all"><LogOut className="h-4 w-4"/> Keluar</button>
            </div>
          </header>

          <div className="py-4 pb-28 animate-fade-in-up">
            {tab==='settings'&&isAdmin&&<SettingsPage users={users} allProjects={projects.map(p=>p.name)} currentUser={currentUser} onUsersChange={loadAll}/>}

            {tab==='dashboard'&&<div className="space-y-6">
              {/* Cards Grid */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card label="Total Kontrak" value={fmtS(m.totalKontrak)} sub="Nilai kontrak proyek" icon={Wallet} accent="bg-sky-500/30" glowClass="glow-sky"/>
                <Card label="DP Masuk" value={fmtS(m.dpMasuk)} sub={`${m.totalKontrak?((m.dpMasuk/m.totalKontrak)*100).toFixed(0):0}% dari kontrak`} icon={ArrowDownLeft} accent="bg-emerald-500/30" glowClass="glow-emerald"/>
                <Card label="Sisa Pembayaran" value={fmtS(m.sisaPembayaran)} sub="Belum ditagih" icon={TrendingUp} accent="bg-amber-500/30" glowClass="glow-amber"/>
                <Card label="Saldo Akhir" value={fmtS(m.saldoAkhir)} sub={`Pengeluaran ${fmtS(m.totalBiaya)}`} icon={TrendingDown} accent="bg-violet-500/30" glowClass="glow-violet"/>
              </div>
              
              {/* Graphs / Detail Sections */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-2xl glass-card p-6 border border-white/5">
                  <div className="mb-5 flex items-center justify-between border-b border-white/5 pb-3">
                    <p className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/50" />
                      Saldo per Kas
                    </p>
                    <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Akun Aktif</span>
                  </div>
                  <div className="space-y-2.5">
                    {KAS_LIST.map(k=>(
                      <button 
                        key={k} 
                        onClick={()=>{setKasFilter(k);setTab('transactions');}} 
                        className="flex w-full items-center justify-between rounded-xl border border-white/[0.02] bg-white/[0.01] px-4 py-3 text-sm text-slate-400 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/5 hover:translate-x-1 group"
                      >
                        <span className="font-semibold text-slate-300 group-hover:text-cyan-400 transition-colors">{k}</span>
                        <span className={`font-bold tabular-nums ${m.perKas[k]<0?'text-rose-400':'text-white'}`}>{fmt(m.perKas[k])}</span>
                      </button>
                    ))}
                    <div className="flex justify-between border-t border-white/5 pt-4 mt-2 text-sm font-bold"><span className="text-slate-400">Total Keseluruhan</span><span className="text-cyan-400 tabular-nums">{fmt(m.saldoAkhir)}</span></div>
                  </div>
                </div>
                
                <div className="rounded-2xl glass-card p-6 border border-white/5">
                  <div className="mb-5 flex items-center justify-between border-b border-white/5 pb-3">
                    <p className="text-sm font-bold text-white tracking-tight flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-violet-400 shadow-lg shadow-violet-400/50" />
                      Pengeluaran per Kategori
                    </p>
                    <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Distribusi</span>
                  </div>
                  {Object.keys(m.perKat).length===0&&<p className="text-xs text-slate-500 py-4 text-center">Belum ada pengeluaran dicatat.</p>}
                  <div className="space-y-4">
                    {Object.entries(m.perKat).map(([c,v])=>(
                      <div key={c} className="group">
                        <div className="mb-1.5 flex justify-between text-xs font-semibold">
                          <span className="text-slate-400 group-hover:text-white transition-colors">{c}</span>
                          <span className="tabular-nums text-slate-300">{fmt(v)}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/5 shadow-inner">
                          <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-500 transition-all duration-500 shadow-lg shadow-cyan-500/20" style={{width:`${(v/maxKat)*100}%`}}/>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex justify-between border-t border-white/5 pt-4 text-sm font-bold"><span className="text-slate-400">Total Pengeluaran</span><span className="text-rose-400 tabular-nums">{fmt(m.totalBiaya)}</span></div>
                </div>
              </div>
            </div>}

            {tab==='transactions'&&<div className="rounded-2xl glass-card border border-white/5 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 p-5 bg-slate-950/20">
                <p className="text-sm font-bold text-white tracking-tight">Riwayat Transaksi <span className="text-slate-500 font-semibold text-xs ml-1">({filtTxs.length})</span></p>
                <div className="flex flex-wrap gap-2.5">
                  <div className="relative"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari deskripsi…" className="w-44 rounded-xl border border-white/10 bg-slate-900/60 py-2 pl-9 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-400/40"/></div>
                  <div className="relative"><Filter className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"/><select value={kasFilter} onChange={e=>setKasFilter(e.target.value)} className="appearance-none rounded-xl border border-white/10 bg-slate-900/60 py-2 pl-9 pr-8 text-xs text-white outline-none cursor-pointer focus:border-cyan-400/40"><option value="ALL" className="bg-slate-950">Semua Kas</option>{KAS_LIST.map(k=><option key={k} className="bg-slate-950">{k}</option>)}</select></div>
                  <button onClick={()=>setKasFilter('ALL')} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-white/5 transition-all">Reset</button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-white/5 bg-slate-950/30">
                      <th className="px-5 py-3.5">Tanggal</th>
                      <th className="px-5 py-3.5">Deskripsi</th>
                      <th className="px-5 py-3.5">Kategori</th>
                      <th className="px-5 py-3.5">Kas</th>
                      <th className="px-5 py-3.5 text-right">Jumlah</th>
                      {isAdmin&&<th className="px-5 py-3.5 text-center">Aksi</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtTxs.map((t,i)=>(
                      <tr key={t.id||i} className="border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition-colors duration-150">
                        <td className="whitespace-nowrap px-5 py-4 text-xs font-medium text-slate-400">{t.tgl}</td>
                        <td className="px-5 py-4 font-semibold text-slate-200">
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              {t.desc}
                              {t.sync_source === 'sheet' && <span className="rounded-md bg-emerald-400/10 px-2 py-0.5 text-[8px] font-bold text-emerald-400 ring-1 ring-emerald-400/20 uppercase tracking-wider">Sheet</span>}
                            </div>
                            {t.harga_satuan > 0 && t.kategori !== 'Transfer' && t.kategori !== 'Transfer Internal' && (
                              <div className="text-[10px] text-slate-400 font-medium mt-1">
                                {t.volume} {t.satuan} @ {fmt(t.harga_satuan)}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset ${CAT_CLS[t.kategori]||CAT_CLS.Lainnya}`}>
                            {t.kategori}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs font-semibold text-slate-400">{t.kas}</td>
                        <td className="px-5 py-4 text-right">
                          {t.masuk>0 ? (
                            <span className="inline-flex items-center gap-1 font-bold tabular-nums text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg">
                              <ArrowDownLeft className="h-3.5 w-3.5"/>{fmt(t.masuk)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-bold tabular-nums text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-lg">
                              <ArrowUpRight className="h-3.5 w-3.5"/>{fmt(t.keluar)}
                            </span>
                          )}
                        </td>
                        {isAdmin&&<td className="px-5 py-4 text-center">
                          <div className="flex justify-center gap-1.5">
                            <button onClick={()=>setEditTx(t)} title="Edit Transaksi" className="rounded-xl border border-white/5 bg-slate-900 p-2 text-slate-400 hover:bg-white/10 hover:text-cyan-400 transition-all"><Edit2 className="h-3.5 w-3.5"/></button>
                            <button onClick={()=>handleDelete(t.id)} title="Hapus Transaksi" className="rounded-xl border border-white/5 bg-slate-900 p-2 text-slate-400 hover:bg-white/10 hover:text-rose-400 transition-all"><Trash2 className="h-3.5 w-3.5"/></button>
                          </div>
                        </td>}
                      </tr>
                    ))}
                    {filtTxs.length===0&&<tr><td colSpan={isAdmin?6:5} className="px-5 py-12 text-center text-slate-500 font-medium">Belum ada transaksi dicatat untuk pencarian ini.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>}
          </div>
        </main>
      </div>

      {/* MOBILE NAV */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-slate-950/80 backdrop-blur-md lg:hidden">
        <div className="flex">
          {navItems.map(it=>(
            <button 
              key={it.id} 
              onClick={()=>setTab(it.id)} 
              className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-bold transition-all duration-300 ${tab===it.id?'text-cyan-400':'text-slate-500 hover:text-slate-300'}`}
            >
              <it.icon className="h-5 w-5"/>
              {it.label}
            </button>
          ))}
        </div>
        <div className="border-t border-white/5 py-1 text-center text-[9px] text-slate-600 font-semibold">FinTrack V1 · By Mrlims</div>
      </nav>
    </div>
  );
}
