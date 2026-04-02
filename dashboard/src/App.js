import React, { useState, useEffect, useCallback } from 'react';

// In K8s, the Ingress routes /api/* to the API service and / to the dashboard.
// REACT_APP_API_URL can be set for local dev (http://localhost:3001).
// When empty/unset, use the current origin so /api requests go through Ingress.
const API_BASE = process.env.REACT_APP_API_URL || '';

function StatusBadge({ status }) {
  const colors = {
    provisioning: { bg: '#fef3c7', color: '#92400e', border: '#f59e0b' },
    ready: { bg: '#d1fae5', color: '#065f46', border: '#10b981' },
    failed: { bg: '#fee2e2', color: '#991b1b', border: '#ef4444' },
    deleting: { bg: '#e0e7ff', color: '#3730a3', border: '#6366f1' },
  };
  const c = colors[status] || colors.provisioning;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 12, fontWeight: 600, background: c.bg, color: c.color,
      border: `1px solid ${c.border}`,
    }}>
      {status === 'provisioning' && '⏳ '}{status === 'ready' && '✅ '}
      {status === 'failed' && '❌ '}{status === 'deleting' && '🗑 '}
      {status.toUpperCase()}
    </span>
  );
}

function MetricsBar({ metrics }) {
  if (!metrics) return null;
  const items = [
    { label: 'Total', value: metrics.totalStores, color: '#6366f1' },
    { label: 'Ready', value: metrics.readyStores, color: '#10b981' },
    { label: 'Provisioning', value: metrics.provisioningStores, color: '#f59e0b' },
    { label: 'Failed', value: metrics.failedStores, color: '#ef4444' },
  ];
  return (
    <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
      {items.map((m) => (
        <div key={m.label} style={{
          background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
          padding: '12px 20px', minWidth: 120, textAlign: 'center',
          borderTop: `3px solid ${m.color}`,
        }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: m.color }}>{m.value}</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

function EventLog({ events }) {
  if (!events || events.length === 0) return <div style={{ color: '#9ca3af', fontSize: 13 }}>No events yet</div>;
  return (
    <div style={{
      maxHeight: 200, overflowY: 'auto', fontSize: 12, fontFamily: 'monospace',
      background: '#1e1e2e', color: '#cdd6f4', borderRadius: 6, padding: 10,
    }}>
      {events.slice().reverse().map((e, i) => (
        <div key={i} style={{ marginBottom: 2 }}>
          <span style={{ color: '#6c7086' }}>{new Date(e.timestamp).toLocaleTimeString()}</span>{' '}
          <span style={{
            color: e.type === 'error' ? '#f38ba8' : e.type === 'warn' ? '#fab387' : '#a6e3a1',
          }}>[{e.type}]</span>{' '}
          {e.message}
        </div>
      ))}
    </div>
  );
}

function CreateStoreForm({ onCreated, disabled }) {
  const [name, setName] = useState('');
  const [engine, setEngine] = useState('woocommerce');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim()) { setError('Store name is required'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), engine }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create store');
      setName('');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
      padding: 20, marginBottom: 24,
    }}>
      <h3 style={{ margin: '0 0 12px', fontSize: 16, color: '#111827' }}>Create New Store</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Store Name</label>
          <input
            type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="my-awesome-store" maxLength={50}
            style={{
              width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
              borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
            }}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 13, color: '#374151', marginBottom: 4 }}>Engine</label>
          <select
            value={engine} onChange={(e) => setEngine(e.target.value)}
            style={{
              padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14,
              background: '#fff',
            }}
          >
            <option value="woocommerce">WooCommerce</option>
            <option value="medusa">MedusaJS</option>
          </select>
        </div>
        <button
          type="submit" disabled={disabled || loading}
          style={{
            padding: '8px 20px', background: disabled || loading ? '#9ca3af' : '#4f46e5',
            color: '#fff', border: 'none', borderRadius: 6, fontSize: 14,
            cursor: disabled || loading ? 'not-allowed' : 'pointer', fontWeight: 600,
          }}
        >
          {loading ? 'Creating...' : 'Create Store'}
        </button>
      </div>
      {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </form>
  );
}

function StoreCard({ store, onDelete, onSelect, selected }) {
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Delete store "${store.name}"? This will remove all resources.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`${API_BASE}/api/stores/${store.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      onClick={() => onSelect(store.id)}
      style={{
        background: selected ? '#f0f0ff' : '#fff',
        border: selected ? '2px solid #4f46e5' : '1px solid #e5e7eb',
        borderRadius: 8, padding: 16, cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h4 style={{ margin: 0, fontSize: 15, color: '#111827' }}>{store.name}</h4>
        <StatusBadge status={store.status} />
      </div>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        Engine: <strong>{store.engine}</strong> | Namespace: <code>{store.namespace}</code>
      </div>
      {store.storeUrl && (
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
          URL: <a href={store.storeUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{store.storeUrl}</a>
        </div>
      )}
      {store.error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 4 }}>Error: {store.error}</div>
      )}
      <div style={{ fontSize: 11, color: '#9ca3af' }}>
        Created: {new Date(store.createdAt).toLocaleString()}
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {store.adminUrl && (
          <a
            href={store.adminUrl} target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: 12, padding: '4px 10px', background: '#f3f4f6',
              borderRadius: 4, color: '#4f46e5', textDecoration: 'none',
              border: '1px solid #e5e7eb',
            }}
          >
            Admin Panel
          </a>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          disabled={deleting || store.status === 'deleting'}
          style={{
            fontSize: 12, padding: '4px 10px', background: '#fef2f2',
            borderRadius: 4, color: '#dc2626', border: '1px solid #fecaca',
            cursor: deleting ? 'not-allowed' : 'pointer',
          }}
        >
          {deleting ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [stores, setStores] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [apiError, setApiError] = useState('');

  const fetchStores = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/stores`);
      if (!res.ok) throw new Error('API unavailable');
      setStores(await res.json());
      setApiError('');
    } catch {
      setApiError('Cannot connect to API server. Make sure the backend is running on port 3001.');
    }
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/metrics`);
      if (res.ok) setMetrics(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchStores();
    fetchMetrics();
    const interval = setInterval(() => { fetchStores(); fetchMetrics(); }, 5000);
    return () => clearInterval(interval);
  }, [fetchStores, fetchMetrics]);

  const selectedStore = stores.find((s) => s.id === selectedId);

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{
        background: '#1e1b4b', color: '#fff', padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Store Provisioning Platform</h1>
          <div style={{ fontSize: 12, color: '#a5b4fc', marginTop: 2 }}>Kubernetes-based e-commerce store management</div>
        </div>
        <div style={{ fontSize: 12, color: '#c7d2fe' }}>
          {apiError ? '🔴 Disconnected' : '🟢 Connected'}
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {apiError && (
          <div style={{
            background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8,
            padding: 12, marginBottom: 16, color: '#991b1b', fontSize: 14,
          }}>
            {apiError}
          </div>
        )}

        <MetricsBar metrics={metrics} />

        <CreateStoreForm onCreated={() => { fetchStores(); fetchMetrics(); }} disabled={!!apiError} />

        <div style={{ display: 'grid', gridTemplateColumns: selectedStore ? '1fr 1fr' : '1fr', gap: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, color: '#111827', marginBottom: 12 }}>
              Stores ({stores.length})
            </h3>
            {stores.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: 40, color: '#9ca3af',
                background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb',
              }}>
                No stores yet. Create one above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {stores.map((s) => (
                  <StoreCard
                    key={s.id} store={s} onDelete={fetchStores}
                    onSelect={setSelectedId} selected={selectedId === s.id}
                  />
                ))}
              </div>
            )}
          </div>

          {selectedStore && (
            <div>
              <h3 style={{ fontSize: 16, color: '#111827', marginBottom: 12 }}>
                Events: {selectedStore.name}
              </h3>
              <EventLog events={selectedStore.events} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
