import { supabase } from './supabaseConfig';

function mapTx(t) {
  return { id: t.id, tgl: t.tgl, desc: t.deskripsi, masuk: t.masuk, keluar: t.keluar, kategori: t.kategori, kas: t.kas, tujuan: t.tujuan || '' };
}

export const db = {
  async getUsers() {
    const { data, error } = await supabase.from('users').select('*').order('created_at');
    if (error) throw error;
    return data || [];
  },
  async addUser(username, password, role) {
    const { data, error } = await supabase.from('users').insert({ username, password, role }).select().single();
    if (error) throw error;
    return data;
  },
  async updateUser(id, updates) {
    const { error } = await supabase.from('users').update(updates).eq('id', id);
    if (error) throw error;
  },
  async deleteUser(id) {
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
  },
  async getProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('created_at');
    if (error) throw error;
    return data || [];
  },
  async getUserProjects() {
    const { data, error } = await supabase.from('user_projects').select('*');
    if (error) throw error;
    return data || [];
  },
  async setUserProjects(userId, projectIds) {
    await supabase.from('user_projects').delete().eq('user_id', userId);
    if (projectIds.length > 0) {
      const { error } = await supabase.from('user_projects').insert(projectIds.map(pid => ({ user_id: userId, project_id: pid })));
      if (error) throw error;
    }
  },
  async getTransactions() {
    const { data, error } = await supabase.from('transactions').select('*').order('tgl');
    if (error) throw error;
    return (data || []).map(mapTx);
  },
  async addTransaction(projectId, tx) {
    const { data, error } = await supabase.from('transactions').insert({
      project_id: projectId, tgl: tx.tgl, deskripsi: tx.desc,
      masuk: tx.masuk, keluar: tx.keluar, kategori: tx.kategori, kas: tx.kas, tujuan: tx.tujuan || ''
    }).select().single();
    if (error) throw error;
    return mapTx(data);
  },
  async updateTransaction(id, tx) {
    const { error } = await supabase.from('transactions').update({
      tgl: tx.tgl, deskripsi: tx.desc, masuk: tx.masuk,
      keluar: tx.keluar, kategori: tx.kategori, kas: tx.kas, tujuan: tx.tujuan || ''
    }).eq('id', id);
    if (error) throw error;
  },
  async deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  },
};
