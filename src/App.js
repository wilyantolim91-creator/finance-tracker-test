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
import { db } from './db';
import { supabase } from './supabaseConfig';

/* ─── CONSTANTS ─── */
const KAS_LIST  = ['KAS UTAMA','KAS AWEN','KAS WILY'];
const REAL_CATS = ['Material','Upah','Labor','Lainnya'];
const ALL_CATS  = ['Material','Upah','Labor','Lainnya','Transfer','Transfer Internal'];
const fmt  = n => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n));
const fmtS = n => { const a=Math.abs(n),s=n<0?'-':''; if(a>=1e9)return`${s}Rp ${(a/1e9).toFixed(1)}M`; if(a>=1e6)return`${s}Rp ${(a/1e6).toFixed(1)}jt`; if(a>=1e3)return`${s}Rp ${(a/1e3).toFixed(0)}rb`; return`Rp ${n}`; };
const TODAY = () => new Date().toISOString().slice(0,10);

/* ─── METRICS ─── */
function computeMetrics(totalKontrak, txs=[]) {
  const sorted=[...txs].sort((a,b)=>a.tgl.localeCompare(b.tgl));
  const dpMasuk=sorted.filter(t=>t.kategori==='Transfer'&&t.masuk>0).reduce((s,t)=>s+t.masuk,0);
  const perKas=Object.fromEntries(KAS_LIST.map(k=>[k,0]));
  sorted.forEach(t=>{perKas[t.kas]=(perKas[t.kas]||0)+t.masuk-t.keluar;});
  const perKat={};
  sorted.forEach(t=>{if(REAL_CATS.includes(t.kategori))perKat[t.kategori]=(perKat[t.kategori]||0)+t.keluar;});
  const totalBiaya=Object.values(perKat).reduce((s,v)=>s+v,0);
  const saldoAkhir=Object.values(perKas).reduce((s,v)=>s+v,0);
  return{totalKontrak,dpMasuk,sisaPembayaran:totalKontrak-dpMasuk,perKas,perKat,totalBiaya,saldoAkhir,txs:[...sorted].reverse()};
}

/* ─── AI PARSER ─── */
const SYS=()=>`Kamu parser transaksi keuangan. Hasilkan SATU JSON dari input. Field: tgl(YYYY-MM-DD default ${TODAY()}),desc,masuk(0 jika pengeluaran),keluar(0 jika pemasukan),kategori(${ALL_CATS.join('/')}),kas(${KAS_LIST.join('/')} default KAS UTAMA),tujuan. Konversi jt=1e6 rb=1e3. HANYA JSON.`;
async function parseAI(content){
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:500,system:SYS(),messages:[{role:'user',content}]})});
  const d=await r.json();
  const raw=d.content.filter(c=>c.type==='text').map(c=>c.text).join('').replace(/```json|```/g,'').trim();
  const o=JSON.parse(raw);
  return{tgl:o.tgl||TODAY(),desc:o.desc||'',masuk:Number(o.masuk)||0,keluar:Number(o.keluar)||0,
    kategori:ALL_CATS.includes(o.kategori)?o.kategori:'Lainnya',kas:KAS_LIST.includes(o.kas)?o.kas:'KAS UTAMA',tujuan:o.tujuan||''};
}
const toB64=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(',')[1]);r.onerror=rej;r.readAsDataURL(f);});

/* ─── UI ATOMS ─── */
const CAT_CLS={Material:'text-amber-300 bg-amber-400/10 ring-amber-400/20',Upah:'text-emerald-300 bg-emerald-400/10 ring-emerald-400/20',Labor:'text-teal-300 bg-teal-400/10 ring-teal-400/20',Transfer:'text-sky-300 bg-sky-400/10 ring-sky-400/20','Transfer Internal':'text-violet-300 bg-violet-400/10 ring-violet-400/20',Lainnya:'text-slate-300 bg-slate-400/10 ring-slate-400/20'};

function Card({label,value,sub,icon:I,accent}){return(<div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-white/[0.06] to-transparent p-5"><div className={`absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl ${accent}`}/><div className="flex items-center gap-2 text-slate-400"><I className="h-4 w-4"/><span className="text-xs font-medium uppercase tracking-wider">{label}</span></div><div className="mt-3 text-2xl font-semibold text-white tabular-nums">{value}</div>{sub&&<div className="mt-1 text-xs text-slate-500">{sub}</div>}</div>);}

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
  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(''),2500);};
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
  const[f,setF]=useState(transaction||{tgl:TODAY(),desc:'',masuk:0,keluar:0,kategori:'Material',kas:'KAS UTAMA',tujuan:''});
  return(<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
    <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6" onClick={e=>e.stopPropagation()}>
      <div className="mb-4 flex items-center justify-between"><h3 className="text-base font-semibold text-white">{title}</h3><button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-5 w-5"/></button></div>
      <div className="grid grid-cols-2 gap-3">
        <FInput label="Tanggal" v={f.tgl} type="date" onChange={v=>setF({...f,tgl:v})}/><FInput label="Kas" v={f.kas} opts={KAS_LIST} onChange={v=>setF({...f,kas:v})}/>
        <div className="col-span-2"><FInput label="Deskripsi" v={f.desc} onChange={v=>setF({...f,desc:v})}/></div>
        <FInput label="Kategori" v={f.kategori} opts={ALL_CATS} onChange={v=>setF({...f,kategori:v})}/><FInput label="Tujuan" v={f.tujuan||''} onChange={v=>setF({...f,tujuan:v})}/>
        <FInput label="Masuk" v={f.masuk} type="number" onChange={v=>setF({...f,masuk:Number(v)||0})}/><FInput label="Keluar" v={f.keluar} type="number" onChange={v=>setF({...f,keluar:Number(v)||0})}/>
      </div>
      <div className="mt-5 flex gap-3">
        <button onClick={onClose} className="flex-1 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-300 hover:bg-white/5">Batal</button>
        <button onClick={()=>{onSave(f);onClose();}} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"><Check className="h-4 w-4"/> Simpan</button>
      </div>
    </div>
  </div>);
}

/* ─── FLOATING AI ─── */
function FloatingAI({onAdd}){
  const[open,setOpen]=useState(false);const[text,setText]=useState('');const[status,setStatus]=useState('');const[parsed,setParsed]=useState(null);const[note,setNote]=useState('');const recRef=React.useRef(null);
  const reset=()=>{setParsed(null);setNote('');setStatus('');};
  const runText=async t=>{if(!t.trim())return;setStatus('thinking');setParsed(null);setNote('');try{setParsed(await parseAI(t));}catch{setNote('Gagal memproses.');}finally{setStatus('');setText('');}};
  const runImg=async file=>{if(!file)return;setStatus('thinking');setParsed(null);setNote('');try{const b64=await toB64(file);setParsed(await parseAI([{type:'image',source:{type:'base64',media_type:file.type||'image/jpeg',data:b64}},{type:'text',text:'Ekstrak transaksi dari nota ini.'}]));}catch{setNote('Gagal membaca file.');}finally{setStatus('');}};
  const startVoice=()=>{const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){setNote('Browser belum support rekam suara.');return;}const rec=new SR();rec.lang='id-ID';rec.continuous=false;rec.onresult=e=>setText(Array.from(e.results).map(r=>r[0].transcript).join(''));rec.onend=()=>setStatus('');recRef.current=rec;try{rec.start();setStatus('listening');setNote('');}catch{}};
  const stopVoice=()=>{if(recRef.current)try{recRef.current.stop();}catch{}setStatus('');};
  return(<>
    {!open&&<button onClick={()=>setOpen(true)} className="fixed bottom-20 right-4 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 shadow-xl hover:scale-105"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400/40"/><Sparkles className="relative h-6 w-6"/></button>}
    {open&&<div className="fixed bottom-20 right-4 z-50 flex w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-cyan-400"/><span className="text-sm font-semibold text-white">Asisten AI</span></div><button onClick={()=>{setOpen(false);reset();setText('');}} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-5 w-5"/></button></div>
      <div className="max-h-[55vh] overflow-y-auto p-4">
        {!parsed&&status!=='thinking'&&<p className="text-xs text-slate-400">Ketik, foto nota, lampirkan file, atau tahan mik untuk bicara.</p>}
        {status==='thinking'&&<div className="flex items-center gap-2 text-sm text-cyan-300"><Loader2 className="h-4 w-4 animate-spin"/> Memproses…</div>}
        {note&&<div className="mt-2 rounded-lg bg-rose-500/10 p-3 text-xs text-rose-300">{note}</div>}
        {parsed&&<div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <p className="mb-2 text-[10px] font-semibold text-cyan-400">CEK SEBELUM SIMPAN</p>
          <div className="grid grid-cols-2 gap-2">
            <FInput label="Tanggal" v={parsed.tgl} type="date" onChange={v=>setParsed({...parsed,tgl:v})}/><FInput label="Kas" v={parsed.kas} opts={KAS_LIST} onChange={v=>setParsed({...parsed,kas:v})}/>
            <div className="col-span-2"><FInput label="Deskripsi" v={parsed.desc} onChange={v=>setParsed({...parsed,desc:v})}/></div>
            <FInput label="Kategori" v={parsed.kategori} opts={ALL_CATS} onChange={v=>setParsed({...parsed,kategori:v})}/><FInput label="Tujuan" v={parsed.tujuan} onChange={v=>setParsed({...parsed,tujuan:v})}/>
            <FInput label="Masuk" v={parsed.masuk} type="number" onChange={v=>setParsed({...parsed,masuk:Number(v)||0})}/><FInput label="Keluar" v={parsed.keluar} type="number" onChange={v=>setParsed({...parsed,keluar:Number(v)||0})}/>
          </div>
          <div className="mt-3 flex gap-2"><button onClick={reset} className="flex-1 rounded-xl border border-white/10 py-2 text-sm font-medium text-slate-300 hover:bg-white/5">Batal</button><button onClick={()=>{onAdd(parsed);reset();}} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-sm font-semibold text-slate-950"><Check className="h-4 w-4"/> Simpan</button></div>
        </div>}
      </div>
      <div className="border-t border-white/10 p-3">
        {status==='listening'&&<p className="mb-2 flex items-center gap-2 text-xs text-cyan-300"><span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400"/> Mendengarkan…</p>}
        <div className="flex items-end gap-2">
          <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"><Camera className="h-4 w-4"/><input type="file" accept="image/*" capture="environment" className="hidden" onChange={e=>runImg(e.target.files?.[0])}/></label>
          <label className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"><Paperclip className="h-4 w-4"/><input type="file" accept="image/*,application/pdf" className="hidden" onChange={e=>runImg(e.target.files?.[0])}/></label>
          <textarea value={text} onChange={e=>setText(e.target.value)} rows={1} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();runText(text);}}} placeholder="Ketik…" className="max-h-24 min-h-[36px] flex-1 resize-none rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/50"/>
          <button onMouseDown={startVoice} onMouseUp={stopVoice} onMouseLeave={stopVoice} onTouchStart={e=>{e.preventDefault();startVoice();}} onTouchEnd={e=>{e.preventDefault();stopVoice();}} className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition ${status==='listening'?'border-cyan-400 bg-cyan-400 text-slate-950':'border-white/10 bg-white/[0.04] text-slate-300'}`}><Mic className="h-4 w-4"/></button>
          <button onClick={()=>runText(text)} disabled={!text.trim()||status==='thinking'} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 disabled:opacity-40"><Send className="h-4 w-4"/></button>
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

  const projData=projects.find(p=>p.name===proj);
  const txList=useMemo(()=>transactions[proj]||[],[transactions,proj]);
  const m=useMemo(()=>computeMetrics(projData?.total_kontrak||0,txList),[projData,txList]);

  const handleAdd=async tx=>{try{await db.addTransaction(proj,tx);await loadTxs(proj);}catch(e){alert('Gagal simpan: '+e.message);}};
  const handleSave=async tx=>{try{if(editTx?.id){await db.updateTransaction(editTx.id,tx);}else{await db.addTransaction(proj,tx);}await loadTxs(proj);setEditTx(null);}catch(e){alert('Gagal: '+e.message);}};
  const handleDelete=async id=>{if(!window.confirm('Hapus transaksi ini?'))return;try{await db.deleteTransaction(id);await loadTxs(proj);}catch(e){alert('Gagal hapus: '+e.message);}};

  const dlXLS=()=>{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[`Laporan: ${proj}`],[`Tanggal: ${new Date().toLocaleDateString('id-ID')}`],[],['Total Kontrak',m.totalKontrak],['DP Masuk',m.dpMasuk],['Sisa Pembayaran',m.sisaPembayaran],['Total Pengeluaran',m.totalBiaya],['Saldo Akhir',m.saldoAkhir],[],['Saldo per Kas'],...KAS_LIST.map(k=>[k,m.perKas[k]])]),'Summary');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Tanggal','Deskripsi','Kategori','Kas','Masuk','Keluar','Tujuan'],...txList.map(t=>[t.tgl,t.desc,t.kategori,t.kas,t.masuk,t.keluar,t.tujuan])]),'Transactions');
    XLSX.writeFile(wb,`${proj}_${TODAY()}.xlsx`);
  };
  const dlPDF=()=>{
    const doc=new jsPDF();let y=15;
    doc.setFontSize(14);doc.text(`Laporan: ${proj}`,10,y);y+=8;doc.setFontSize(10);doc.text(`Tanggal: ${new Date().toLocaleDateString('id-ID')}`,10,y);y+=8;
    doc.setFontSize(11);doc.text('Ringkasan',10,y);y+=6;doc.setFontSize(9);
    [['Total Kontrak',fmt(m.totalKontrak)],['DP Masuk',fmt(m.dpMasuk)],['Sisa Pembayaran',fmt(m.sisaPembayaran)],['Total Pengeluaran',fmt(m.totalBiaya)],['Saldo Akhir',fmt(m.saldoAkhir)]].forEach(([l,v])=>{doc.text(`${l}: ${v}`,10,y);y+=5;});
    y+=3;doc.setFontSize(11);doc.text('Saldo per Kas',10,y);y+=6;doc.setFontSize(9);KAS_LIST.forEach(k=>{doc.text(`${k}: ${fmt(m.perKas[k])}`,10,y);y+=5;});
    y+=3;doc.setFontSize(11);doc.text('Pengeluaran per Kategori',10,y);y+=6;doc.setFontSize(9);Object.entries(m.perKat).forEach(([k,v])=>{doc.text(`${k}: ${fmt(v)}`,10,y);y+=5;});
    doc.save(`${proj}_${TODAY()}.pdf`);
  };

  const filtTxs=txList.filter(t=>(kasFilter==='ALL'||t.kas===kasFilter)&&(t.desc||'').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.tgl.localeCompare(a.tgl));
  const maxKat=Math.max(...Object.values(m.perKat),1);
  const navItems=[{id:'dashboard',label:'Dashboard',icon:LayoutDashboard},{id:'transactions',label:'Transaksi',icon:Receipt},...(isAdmin?[{id:'settings',label:'Pengaturan',icon:Settings}]:[])];

  if(loading)return(<div className="flex min-h-screen items-center justify-center bg-slate-950"><div className="flex flex-col items-center gap-3"><Loader2 className="h-8 w-8 animate-spin text-cyan-400"/><p className="text-sm text-slate-400">Memuat data…</p></div></div>);

  return(<div className="min-h-screen w-full bg-slate-950 text-slate-200" style={{fontFamily:"'Plus Jakarta Sans',ui-sans-serif,system-ui"}}>
    {isAdmin&&<FloatingAI onAdd={handleAdd}/>}
    {showAdd&&isAdmin&&<FormModal title="Tambah Transaksi" onSave={handleSave} onClose={()=>setShowAdd(false)}/>}
    {editTx&&isAdmin&&<FormModal title="Edit Transaksi" transaction={editTx} onSave={handleSave} onClose={()=>setEditTx(null)}/>}

    <div className="flex">
      {/* SIDEBAR */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-white/5 bg-slate-950/80 px-4 py-6 lg:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950"><Wallet className="h-5 w-5"/></div>
          <div><div className="flex items-center gap-2"><span className="text-sm font-bold text-white">FinTrack</span><span className="rounded-full bg-cyan-400/20 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 ring-1 ring-cyan-400/30">V1</span></div><div className="text-[10px] text-slate-500">By <span className="text-slate-400">Mrlims</span> · Creator</div></div>
        </div>
        <nav className="flex flex-col gap-1">{navItems.map(it=>(<button key={it.id} onClick={()=>setTab(it.id)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${tab===it.id?'bg-white/10 text-white':'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`}><it.icon className="h-4 w-4"/>{it.label}</button>))}</nav>
        <div className="mt-auto rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs text-slate-400"><span className="text-cyan-300">{currentUser.username}</span><div className="mt-1 text-[10px] capitalize">{isAdmin?'Akses semua project':(currentUser.assignedProjects||[]).join(', ')}</div></div>
      </aside>

      {/* MAIN */}
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-white/5 bg-slate-950/80 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-sky-400"/>
            <div className="relative"><select value={proj} onChange={e=>setProject(e.target.value)} className="appearance-none rounded-xl border border-white/10 bg-slate-800 py-2 pl-3 pr-9 text-sm font-semibold text-white outline-none">{visProj.map(p=><option key={p} className="bg-slate-800 text-white">{p}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/></div>
            <button onClick={()=>loadTxs(proj)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"><RefreshCw className="h-4 w-4"/></button>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin&&<><button onClick={()=>setShowAdd(true)} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90"><Plus className="h-4 w-4"/> Manual</button><button onClick={dlXLS} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5"><FileText className="h-4 w-4"/> XLS</button><button onClick={dlPDF} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5"><File className="h-4 w-4"/> PDF</button></>}
            <button onClick={onLogout} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/5"><LogOut className="h-4 w-4"/> Keluar</button>
          </div>
        </header>

        <div className="px-5 py-6 pb-28">
          {tab==='settings'&&isAdmin&&<SettingsPage users={users} allProjects={projects.map(p=>p.name)} currentUser={currentUser} onUsersChange={loadAll}/>}

          {tab==='dashboard'&&<div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Card label="Total Kontrak" value={fmtS(m.totalKontrak)} sub={fmt(m.totalKontrak)} icon={Wallet} accent="bg-sky-500/30"/>
              <Card label="DP Masuk" value={fmtS(m.dpMasuk)} sub={`${m.totalKontrak?((m.dpMasuk/m.totalKontrak)*100).toFixed(0):0}% dari kontrak`} icon={ArrowDownLeft} accent="bg-emerald-500/30"/>
              <Card label="Sisa Pembayaran" value={fmtS(m.sisaPembayaran)} sub="Belum ditagih" icon={TrendingUp} accent="bg-amber-500/30"/>
              <Card label="Saldo Akhir" value={fmtS(m.saldoAkhir)} sub={`Pengeluaran ${fmtS(m.totalBiaya)}`} icon={TrendingDown} accent="bg-violet-500/30"/>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="mb-4 text-sm font-semibold text-white">Saldo per Kas</p>
                <div className="space-y-2">
                  {KAS_LIST.map(k=>(<button key={k} onClick={()=>{setKasFilter(k);setTab('transactions');}} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"><span className="font-medium">{k}</span><span className={`font-semibold tabular-nums ${m.perKas[k]<0?'text-rose-400':'text-white'}`}>{fmt(m.perKas[k])}</span></button>))}
                  <div className="flex justify-between border-t border-white/5 pt-3 text-sm"><span className="text-slate-400">Total</span><span className="font-semibold text-white">{fmt(m.saldoAkhir)}</span></div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-5">
                <p className="mb-4 text-sm font-semibold text-white">Pengeluaran per Kategori</p>
                {Object.keys(m.perKat).length===0&&<p className="text-xs text-slate-500">Belum ada pengeluaran.</p>}
                {Object.entries(m.perKat).map(([c,v])=>(<div key={c} className="mb-2.5"><div className="mb-1 flex justify-between text-xs"><span className="text-slate-400">{c}</span><span className="tabular-nums text-slate-300">{fmt(v)}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-500" style={{width:`${(v/maxKat)*100}%`}}/></div></div>))}
                <div className="mt-3 flex justify-between border-t border-white/5 pt-3 text-sm"><span className="text-slate-300">Total Pengeluaran</span><span className="font-semibold text-white">{fmt(m.totalBiaya)}</span></div>
              </div>
            </div>
          </div>}

          {tab==='transactions'&&<div className="rounded-2xl border border-white/5 bg-white/[0.03]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 p-4">
              <p className="text-sm font-semibold text-white">Transaksi <span className="text-slate-500">({filtTxs.length})</span></p>
              <div className="flex flex-wrap gap-2">
                <div className="relative"><Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Cari…" className="w-40 rounded-lg border border-white/10 bg-slate-800 py-1.5 pl-8 pr-2 text-xs text-white placeholder-slate-500 outline-none"/></div>
                <div className="relative"><Filter className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"/><select value={kasFilter} onChange={e=>setKasFilter(e.target.value)} className="appearance-none rounded-lg border border-white/10 bg-slate-800 py-1.5 pl-8 pr-7 text-xs text-white outline-none"><option value="ALL" className="bg-slate-800">Semua Kas</option>{KAS_LIST.map(k=><option key={k} className="bg-slate-800">{k}</option>)}</select></div>
                <button onClick={()=>setKasFilter('ALL')} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5">Reset</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-slate-500"><th className="px-4 py-2.5">Tanggal</th><th className="px-4 py-2.5">Deskripsi</th><th className="px-4 py-2.5">Kategori</th><th className="px-4 py-2.5">Kas</th><th className="px-4 py-2.5 text-right">Jumlah</th>{isAdmin&&<th className="px-4 py-2.5 text-center">Aksi</th>}</tr></thead>
                <tbody>
                  {filtTxs.map((t,i)=>(<tr key={t.id||i} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-400">{t.tgl}</td>
                    <td className="px-4 py-3 font-medium text-slate-200">{t.desc}</td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${CAT_CLS[t.kategori]||CAT_CLS.Lainnya}`}>{t.kategori}</span></td>
                    <td className="px-4 py-3 text-slate-400">{t.kas}</td>
                    <td className="px-4 py-3 text-right">{t.masuk>0?<span className="inline-flex items-center gap-1 font-semibold tabular-nums text-emerald-400"><ArrowDownLeft className="h-3.5 w-3.5"/>{fmt(t.masuk)}</span>:<span className="inline-flex items-center gap-1 font-semibold tabular-nums text-rose-400"><ArrowUpRight className="h-3.5 w-3.5"/>{fmt(t.keluar)}</span>}</td>
                    {isAdmin&&<td className="px-4 py-3 text-center"><div className="flex justify-center gap-1"><button onClick={()=>setEditTx(t)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-cyan-300"><Edit2 className="h-4 w-4"/></button><button onClick={()=>handleDelete(t.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-rose-300"><Trash2 className="h-4 w-4"/></button></div></td>}
                  </tr>))}
                  {filtTxs.length===0&&<tr><td colSpan={isAdmin?6:5} className="px-4 py-10 text-center text-slate-500">Tidak ada transaksi.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>}
        </div>
      </main>
    </div>

    {/* MOBILE NAV */}
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-slate-950/95 backdrop-blur lg:hidden">
      <div className="flex">{navItems.map(it=>(<button key={it.id} onClick={()=>setTab(it.id)} className={`flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-medium transition ${tab===it.id?'text-cyan-400':'text-slate-500'}`}><it.icon className="h-5 w-5"/>{it.label}</button>))}</div>
      <div className="border-t border-white/5 py-1 text-center text-[9px] text-slate-600">FinTrack <span className="text-cyan-800">V1</span> · By Mrlims</div>
    </nav>
  </div>);
}
