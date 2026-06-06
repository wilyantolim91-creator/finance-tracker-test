import React, { useState } from 'react';

function App() {
  const [transactions, setTransactions] = useState([
    { id: 1, date: '2026-06-05', desc: 'Gaji', amount: 5000000, type: 'income' },
    { id: 2, date: '2026-06-04', desc: 'Makan', amount: 50000, type: 'expense' },
  ]);
  const [newDesc, setNewDesc] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newType, setNewType] = useState('expense');

  const addTransaction = () => {
    if (!newDesc || !newAmount) return;
    
    const newTx = {
      id: Math.max(...transactions.map(t => t.id), 0) + 1,
      date: new Date().toISOString().split('T')[0],
      desc: newDesc,
      amount: parseInt(newAmount),
      type: newType
    };
    
    setTransactions([newTx, ...transactions]);
    setNewDesc('');
    setNewAmount('');
  };

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const totalExpense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const balance = totalIncome - totalExpense;

  return (
    <div style={{ 
      maxWidth: '600px', 
      margin: '0 auto', 
      padding: '20px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8f9fa',
      minHeight: '100vh'
    }}>
      {/* Header */}
      <div style={{ 
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        padding: '20px',
        borderRadius: '12px',
        marginBottom: '20px',
        textAlign: 'center'
      }}>
        <h1 style={{ margin: '0 0 10px 0' }}>💰 Finance Tracker</h1>
        <p style={{ margin: 0, fontSize: '14px', opacity: 0.9 }}>Simple Test App</p>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        <div style={{ 
          background: 'white', 
          padding: '15px', 
          borderRadius: '8px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Pemasukan</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#27ae60' }}>
            Rp {totalIncome.toLocaleString('id-ID')}
          </div>
        </div>
        
        <div style={{ 
          background: 'white', 
          padding: '15px', 
          borderRadius: '8px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Pengeluaran</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#e74c3c' }}>
            Rp {totalExpense.toLocaleString('id-ID')}
          </div>
        </div>
        
        <div style={{ 
          background: 'white', 
          padding: '15px', 
          borderRadius: '8px',
          border: '1px solid #e0e0e0'
        }}>
          <div style={{ fontSize: '12px', color: '#999', marginBottom: '5px' }}>Saldo</div>
          <div style={{ fontSize: '18px', fontWeight: 'bold', color: balance >= 0 ? '#667eea' : '#e74c3c' }}>
            Rp {balance.toLocaleString('id-ID')}
          </div>
        </div>
      </div>

      {/* Add Transaction Form */}
      <div style={{ 
        background: 'white',
        padding: '15px',
        borderRadius: '8px',
        border: '1px solid #e0e0e0',
        marginBottom: '20px'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px' }}>➕ Tambah Transaksi</h3>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>
            Deskripsi
          </label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Contoh: Makan, Gaji, dll"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>
            Jumlah (Rp)
          </label>
          <input
            type="number"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            placeholder="Contoh: 50000"
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '5px' }}>
            Tipe
          </label>
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box'
            }}
          >
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </div>

        <button
          onClick={addTransaction}
          style={{
            width: '100%',
            padding: '10px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          ✅ Tambah
        </button>
      </div>

      {/* Transaction List */}
      <div style={{ 
        background: 'white',
        padding: '15px',
        borderRadius: '8px',
        border: '1px solid #e0e0e0'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '15px' }}>📋 Riwayat Transaksi</h3>
        
        {transactions.length === 0 ? (
          <p style={{ color: '#999', textAlign: 'center' }}>Belum ada transaksi</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {transactions.map(tx => (
              <div 
                key={tx.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px',
                  background: '#f9f9f9',
                  borderRadius: '6px',
                  border: '1px solid #eee'
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>
                    {tx.type === 'income' ? '📥' : '📤'} {tx.desc}
                  </div>
                  <div style={{ fontSize: '12px', color: '#999' }}>{tx.date}</div>
                </div>
                <div style={{ 
                  fontSize: '14px', 
                  fontWeight: 'bold',
                  color: tx.type === 'income' ? '#27ae60' : '#e74c3c'
                }}>
                  {tx.type === 'income' ? '+' : '-'} Rp {tx.amount.toLocaleString('id-ID')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ 
        marginTop: '30px',
        padding: '15px',
        background: '#f0f4ff',
        borderRadius: '8px',
        textAlign: 'center',
        color: '#667eea',
        fontSize: '12px'
      }}>
        <p style={{ margin: 0 }}>✅ Deploy test dari Claude → GitHub → Vercel</p>
      </div>
    </div>
  );
}

export default App;
