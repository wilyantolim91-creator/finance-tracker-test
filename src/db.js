import { supabase } from './supabaseConfig';

function mapTx(t) {
  return { id: t.id, tgl: t.tgl, desc: t.deskripsi, masuk: t.masuk, keluar: t.keluar, kategori: t.kategori, kas: t.kas, tujuan: t.tujuan || '', sync_source: t.sync_source || '', updated_at: t.updated_at || '' };
}

export const db = {
  // AUTH
  async login(username, password) {
    const { data, error } = await supabase.from('users').select('*').eq('username', username).eq('password', password).single();
    if (error || !data) throw new Error('Username atau password salah.');
    // get assigned project names
    const { data: up } = await supabase.from('user_projects').select('project_id').eq('user_id', data.id);
    const projectIds = (up || []).map(x => x.project_id);
    let assignedProjects = [];
    if (projectIds.length > 0) {
      const { data: projs } = await supabase.from('projects').select('name').in('id', projectIds);
      assignedProjects = (projs || []).map(p => p.name);
    }
    return { ...data, assignedProjects };
  },

  // USERS
  async getUsers() {
    const { data: users, error } = await supabase.from('users').select('*').order('created_at');
    if (error) throw error;
    const { data: up } = await supabase.from('user_projects').select('user_id, project_id');
    const { data: projs } = await supabase.from('projects').select('id, name');
    const projMap = Object.fromEntries((projs || []).map(p => [p.id, p.name]));
    return (users || []).map(u => ({
      ...u,
      assignedProjects: (up || []).filter(x => x.user_id === u.id).map(x => projMap[x.project_id]).filter(Boolean)
    }));
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

  // PROJECTS
  async getProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('created_at');
    if (error) throw error;
    return data || [];
  },

  // USER-PROJECT ASSIGNMENT
  async setUserProjects(userId, projectNames) {
    await supabase.from('user_projects').delete().eq('user_id', userId);
    if (projectNames.length === 0) return;
    const { data: projs } = await supabase.from('projects').select('id, name').in('name', projectNames);
    if (!projs || projs.length === 0) return;
    const rows = projs.map(p => ({ user_id: userId, project_id: p.id }));
    const { error } = await supabase.from('user_projects').insert(rows);
    if (error) throw error;
  },

  // TRANSACTIONS
  async getTransactions(projectName) {
    const { data: proj } = await supabase.from('projects').select('id').eq('name', projectName).single();
    if (!proj) return [];
    const { data, error } = await supabase.from('transactions').select('*').eq('project_id', proj.id).order('tgl');
    if (error) throw error;
    return (data || []).map(mapTx);
  },
  async addTransaction(projectName, tx) {
    const { data: proj } = await supabase.from('projects').select('id').eq('name', projectName).single();
    if (!proj) throw new Error('Project tidak ditemukan');
    const { data, error } = await supabase.from('transactions').insert({
      project_id: proj.id, tgl: tx.tgl, deskripsi: tx.desc,
      masuk: tx.masuk || 0, keluar: tx.keluar || 0, kategori: tx.kategori, kas: tx.kas, tujuan: tx.tujuan || '', sync_source: 'app'
    }).select().single();
    if (error) throw error;
    return mapTx(data);
  },
  async updateTransaction(id, tx) {
    const { error } = await supabase.from('transactions').update({
      tgl: tx.tgl, deskripsi: tx.desc, masuk: tx.masuk || 0,
      keluar: tx.keluar || 0, kategori: tx.kategori, kas: tx.kas, tujuan: tx.tujuan || '', sync_source: 'app'
    }).eq('id', id);
    if (error) throw error;
  },
  async deleteTransaction(id) {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  },

  // SYNC HELPERS
  async addProject(name, totalKontrak) {
    const { data, error } = await supabase.from('projects').insert({ name, total_kontrak: totalKontrak || 0 }).select().single();
    if (error) throw error;
    return data;
  },
  async getLastSyncTime(projectName) {
    const { data, error } = await supabase.from('sync_log').select('synced_at').eq('project_name', projectName).order('synced_at', { ascending: false }).limit(1).single();
    if (error || !data) return null;
    return data.synced_at;
  },
  async forceSyncTrigger(projectName) {
    const { error } = await supabase.from('sync_log').insert({ project_name: projectName, direction: 'db_to_sheet', synced_count: 0, synced_at: new Date().toISOString() });
    if (error) throw error;
  }
};
