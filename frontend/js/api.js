// Use relative URLs so this works on any deployed server (local or cloud)
// When FastAPI serves both frontend and API, they share the same origin
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : '';

// Expose globally so community.js and other scripts can use it
window.API_BASE = API_BASE;

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'TypeError') throw new Error('Cannot reach backend. Is uvicorn running?');
    throw e;
  }
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }),

  // Zones
  getZones: () => api.get('/zones'),
  getZone: (id) => api.get(`/zones/${id}`),
  getZoneReadings: (id, days = 7) => api.get(`/zones/${id}/readings?days=${days}`),
  getZoneForecast: (id, hours = 6) => api.get(`/zones/${id}/forecast?hours=${hours}`),

  // Dashboard
  getDashboardStats: () => api.get('/dashboard/stats'),

  // Anomalies
  getAnomalies: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return api.get(`/anomalies${q ? '?' + q : ''}`);
  },
  explainAnomaly: (id) => api.get(`/anomalies/${id}/explain`),
  resolveAnomaly: (id) => api.post(`/anomalies/${id}/resolve`),

  // Redistribution
  getRedistSuggestion: () => api.get('/redistribution/suggest'),
  acceptRedistPlan: (transfers) => api.post('/redistribution/accept', transfers),
  getRedistHistory: () => api.get('/redistribution/history'),

  // Reports
  getReports: (from, to) => api.get(`/reports?from=${from}&to=${to}`),

  // Alerts
  getAlerts: (resolved) => api.get(`/alerts${resolved !== undefined ? '?resolved=' + resolved : ''}`),

  // Network Health
  getNetworkHealth: () => api.get('/network/health'),
};


// ── UI Helpers ─────────────────────────────────────────────────────────────

function showLoading(container, msg = 'Loading data...') {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p class="text-muted text-sm">${msg}</p></div>`;
}

function showError(container, msg) {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <p class="empty-text text-orange">${msg}</p>
      <p class="empty-sub text-muted">Check that the backend is running on port 8000</p>
    </div>`;
}

function showEmpty(container, msg = 'No data available', sub = '') {
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">💧</div>
      <p class="empty-text">${msg}</p>
      ${sub ? `<p class="empty-sub">${sub}</p>` : ''}
    </div>`;
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function badgeHTML(status) {
  const map = {
    Critical: 'badge-critical',
    Anomaly:  'badge-warning',
    Warning:  'badge-warning',
    Normal:   'badge-normal',
    Info:     'badge-info',
    Pending:  'badge-info',
    Accepted: 'badge-normal',
  };
  const cls = map[status] || 'badge-info';
  return `<span class="badge ${cls}">${status}</span>`;
}

function deviationColor(pct) {
  const abs = Math.abs(pct);
  if (abs > 50) return 'var(--accent-red)';
  if (abs > 20) return 'var(--accent-orange)';
  if (abs > 5)  return 'var(--accent-yellow)';
  return 'var(--accent-green)';
}

// Count-up animation
function countUp(el, target, suffix = '', duration = 1200) {
  const start = performance.now();
  const startVal = 0;
  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(startVal + (target - startVal) * eased).toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Live clock
function startClock(el) {
  function tick() {
    el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
  }
  tick();
  setInterval(tick, 1000);
}

window.api = api;
window.showLoading = showLoading;
window.showError = showError;
window.showEmpty = showEmpty;
window.formatTime = formatTime;
window.timeAgo = timeAgo;
window.badgeHTML = badgeHTML;
window.deviationColor = deviationColor;
window.countUp = countUp;
window.startClock = startClock;
