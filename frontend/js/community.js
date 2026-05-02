/* community.js — AquaWatch Community Reporter & Rewards */

const API = window.API_BASE || 'http://localhost:8000';

/* ── State ── */
let currentStep = 1;
let selectedType = null;
let imageBase64 = '';
let imageFilename = '';
let typeChart = null;

const TYPE_ICONS  = { pipe_leak:'🔧', unauthorized_discharge:'🚫', water_wastage:'💦', other:'🔍' };
const TYPE_LABELS = { pipe_leak:'Pipe Leak', unauthorized_discharge:'Unauthorized Discharge', water_wastage:'Water Wastage', other:'Other' };
const SEV_COLORS  = { Low:'var(--accent-cyan)', Medium:'var(--accent-yellow)', High:'var(--accent-orange)', Critical:'var(--accent-red)' };

/* ── Clock ── */
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-US', {hour12:false});
  const el = document.getElementById('live-clock');
  const sb = document.getElementById('sidebar-time');
  if (el) el.textContent = t;
  if (sb) sb.textContent = t;
}
setInterval(updateClock, 1000); updateClock();

/* ── Init ── */
async function init() {
  await Promise.all([loadStats(), loadLeaderboard(), loadReports(), loadTypeChart()]);
}
init();

/* ── Community Stats ── */
async function loadStats() {
  try {
    const res = await fetch(`${API}/community/stats`);
    const d = await res.json();
    animateCount('stat-total', d.total_reports);
    animateCount('stat-verified', d.verified_reports);
    animateCount('stat-pending', d.pending_reports);
    animateCount('stat-coins', d.total_aqua_coins_distributed);
    animateCount('stat-citizens', d.active_citizens);
  } catch(e) {
    ['stat-total','stat-verified','stat-pending','stat-coins','stat-citizens'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.textContent = '0';
    });
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let start = 0;
  const step = Math.max(1, Math.floor(target / 40));
  const timer = setInterval(() => {
    start = Math.min(start + step, target);
    el.textContent = start.toLocaleString();
    if (start >= target) clearInterval(timer);
  }, 30);
}

/* ── Leaderboard ── */
async function loadLeaderboard() {
  const container = document.getElementById('leaderboard-body');
  if (!container) return;
  try {
    const res = await fetch(`${API}/community/leaderboard?limit=8`);
    const data = await res.json();
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><p class="empty-text">No citizens yet — be the first!</p></div>`;
      return;
    }
    container.innerHTML = data.map(c => `
      <div class="leaderboard-row">
        <div class="lb-rank rank-${c.rank}">${c.rank <= 3 ? ['🥇','🥈','🥉'][c.rank-1] : '#'+c.rank}</div>
        <div class="lb-info">
          <div class="lb-name">${escHtml(c.citizen_name)}</div>
          <div class="lb-meta">${c.verified_reports} verified · ${c.total_reports} total · <span class="tier-badge-chip chip-${c.tier}">${c.tier}</span></div>
        </div>
        <div class="lb-coins">
          <div>${c.total_aqua_coins.toLocaleString()} 🪙</div>
          <div class="lb-coins-label">AquaCoins</div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p class="empty-text">Could not load leaderboard</p></div>`;
  }
}

/* ── Report Feed ── */
async function loadReports() {
  const container = document.getElementById('report-feed');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';
  const filter = document.getElementById('feed-filter')?.value || '';
  try {
    const url = `${API}/community/reports?limit=20${filter ? '&report_type='+filter : ''}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p class="empty-text">No reports yet</p><p class="empty-sub">Be the first to report an issue!</p></div>`;
      return;
    }
    container.innerHTML = data.map(r => `
      <div class="report-feed-item">
        <div class="rf-icon">${TYPE_ICONS[r.report_type] || '🔍'}</div>
        <div class="rf-info">
          <div class="rf-type">${TYPE_LABELS[r.report_type] || r.report_type}</div>
          <div class="rf-meta">
            ${escHtml(r.reporter_name)} · ${r.zone_name !== 'Unknown Location' ? r.zone_name + ' · ' : ''}
            ${timeAgo(r.submitted_at)}
            ${r.has_image ? ' · 📷' : ''}
          </div>
          ${r.description ? `<div class="rf-desc">${escHtml(r.description)}</div>` : ''}
        </div>
        <div class="rf-right">
          ${r.aqua_coins_awarded > 0 ? `<div class="rf-coins">+${r.aqua_coins_awarded} 🪙</div>` : ''}
          <div class="rf-status">
            <span class="badge badge-${r.status === 'Verified' ? 'normal' : r.status === 'Pending' ? 'warning' : 'info'}">
              ${r.status}
            </span>
          </div>
          <div style="margin-top:4px">
            <span class="badge badge-${r.severity === 'Critical' ? 'critical' : r.severity === 'High' ? 'warning' : 'info'}" style="font-size:9px">
              ${r.severity}
            </span>
          </div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><p class="empty-text">Could not load reports</p></div>`;
  }
}

/* ── Type Breakdown Chart ── */
async function loadTypeChart() {
  try {
    const res = await fetch(`${API}/community/stats`);
    const d = await res.json();
    const byType = d.by_type || [];
    const legend = document.getElementById('type-legend');

    const labels = byType.map(t => TYPE_LABELS[t.type] || t.type);
    const counts = byType.map(t => t.count);
    const colors = ['#FF3B5C','#FF6B35','#00C2FF','#a78bfa'];

    if (!byType.length) {
      const canvas = document.getElementById('type-chart');
      if (canvas) canvas.style.display = 'none';
      if (legend) legend.innerHTML = `<div class="empty-state" style="padding:20px"><div class="empty-icon">📊</div><p class="empty-text">No data yet</p></div>`;
      return;
    }

    const ctx = document.getElementById('type-chart');
    if (!ctx) return;
    if (typeChart) typeChart.destroy();
    typeChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: counts, backgroundColor: colors.map(c => c+'44'), borderColor: colors, borderWidth: 2, hoverBackgroundColor: colors.map(c=>c+'88') }] },
      options: {
        cutout: '68%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} reports` } } },
        animation: { animateRotate: true, duration: 800 }
      }
    });

    if (legend) {
      legend.innerHTML = byType.map((t, i) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
          <span style="width:14px;height:14px;border-radius:4px;background:${colors[i]};flex-shrink:0;box-shadow:0 0 8px ${colors[i]}66"></span>
          <div>
            <div style="font-size:14px;font-weight:600;color:var(--text-primary)">${labels[i]}</div>
            <div style="font-size:12px;color:var(--text-muted);font-family:'IBM Plex Mono',monospace">${t.count} reports</div>
          </div>
        </div>
      `).join('');
    }
  } catch(e) { /* silently fail */ }
}

/* ── Modal Controls ── */
function openModal() {
  document.getElementById('modal-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
}

window.closeModal = function(e) {
  if (e && e.target) {
    // If the click originated INSIDE the modal, do NOT close
    if (e.target.closest && e.target.closest('.comm-modal')) return;
    // For browsers without closest, only close if clicking the backdrop itself
    if (!e.target.closest && e.target.id !== 'modal-backdrop') return;
  }
  document.getElementById('modal-backdrop').classList.remove('open');
  document.body.style.overflow = '';
}
window.openModal = openModal;

document.getElementById('modal-backdrop').addEventListener('click', function(e) {
  if (e.target === this) {
    this.classList.remove('open');
    document.body.style.overflow = '';
  }
});

function goStep(n) {
  if (n === 2 && !document.getElementById('inp-name').value.trim()) {
    flashInput('inp-name'); return;
  }
  if (n === 3 && !selectedType) {
    document.getElementById('issue-type-grid').style.animation = 'none';
    document.getElementById('issue-type-grid').style.border = '1px solid var(--accent-red)';
    setTimeout(() => { document.getElementById('issue-type-grid').style.border = ''; }, 1500);
    return;
  }
  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-'+n).classList.add('active');
  currentStep = n;
}
window.goStep = goStep;

function flashInput(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--accent-red)';
  el.style.boxShadow = '0 0 0 3px rgba(255,59,92,0.2)';
  el.focus();
  setTimeout(() => { el.style.borderColor = ''; el.style.boxShadow = ''; }, 1500);
}

function selectType(card) {
  document.querySelectorAll('.issue-type-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedType = card.dataset.type;
}
window.selectType = selectType;

/* ── File Upload ── */
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}
function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('upload-dropzone').classList.add('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('upload-dropzone').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) processFile(file);
}
window.handleFileSelect = handleFileSelect;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;

function processFile(file) {
  if (file.size > 5 * 1024 * 1024) { alert('File too large — max 5MB'); return; }
  imageFilename = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    imageBase64 = e.target.result.split(',')[1];
    document.getElementById('img-preview').src = e.target.result;
    document.getElementById('img-preview-wrap').style.display = 'block';
    document.getElementById('upload-icon').textContent = '✅';
    document.getElementById('upload-text').textContent = file.name;
    document.getElementById('upload-sub').textContent = `${(file.size/1024).toFixed(1)} KB`;
    document.getElementById('ai-badge-row').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

/* ── Submit Report ── */
async function submitReport() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '🤖 AI Analysing...';

  const name = document.getElementById('inp-name').value.trim();
  const email = document.getElementById('inp-email').value.trim();
  const severity = document.querySelector('input[name="severity"]:checked')?.value || 'Medium';
  const location = document.getElementById('inp-location').value.trim();
  const desc = document.getElementById('inp-desc').value.trim();

  const payload = {
    reporter_name: name,
    reporter_email: email,
    report_type: selectedType || 'other',
    severity,
    description: desc,
    location_text: location,
    image_data: imageBase64,
    image_filename: imageFilename,
  };

  try {
    const res = await fetch(`${API}/community/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error: ${res.status}`);
    }
    const data = await res.json();
    showSuccess(data);
    // Refresh stats & feed
    loadStats(); loadLeaderboard(); loadReports(); loadTypeChart();
  } catch(e) {
    alert('Submission failed: ' + (e.message || 'Make sure the backend server is running.'));
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Submit & Earn AquaCoins';
  }
}
window.submitReport = submitReport;

function showSuccess(data) {
  document.getElementById('modal-form-body').style.display = 'none';
  const panel = document.getElementById('success-panel');
  panel.style.display = 'block';

  const icon = data.auto_verified ? '🎉' : '⏳';
  document.getElementById('success-icon').textContent = icon;
  document.getElementById('success-title').textContent = data.auto_verified ? 'Verified! Coins Awarded!' : 'Report Submitted!';
  document.getElementById('success-msg').textContent = data.message;

  if (data.auto_verified && data.aqua_coins_awarded > 0) {
    const box = document.getElementById('coins-box');
    box.style.display = 'inline-block';
    document.getElementById('coins-number').textContent = `+${data.aqua_coins_awarded}`;
  }

  if (data.ai_tags && data.ai_tags.length) {
    const row = document.getElementById('ai-tags-row');
    row.style.display = 'flex';
    row.innerHTML = `<div style="font-size:11px;color:var(--text-muted);width:100%;margin-bottom:6px">🤖 AI detected:</div>` +
      data.ai_tags.map(t => `<span class="ai-tag">${t}</span>`).join('');
  }

  if (data.citizen_tier) {
    const tr = document.getElementById('success-tier-row');
    tr.style.display = 'block';
    tr.innerHTML = `Your current tier: <span class="tier-badge-chip chip-${data.citizen_tier}">${data.citizen_tier}</span>
      &nbsp;· Total: <strong style="color:#FFD166">${data.citizen_total_coins} 🪙</strong>`;
  }
}

function resetModal() {
  document.getElementById('modal-form-body').style.display = 'block';
  document.getElementById('success-panel').style.display = 'none';
  // Reset fields
  document.getElementById('inp-desc').value = '';
  document.getElementById('inp-location').value = '';
  document.getElementById('img-preview-wrap').style.display = 'none';
  document.getElementById('upload-icon').textContent = '📸';
  document.getElementById('upload-text').textContent = 'Click or drag photo here';
  document.getElementById('ai-badge-row').style.display = 'none';
  document.querySelectorAll('.issue-type-card').forEach(c => c.classList.remove('selected'));
  selectedType = null; imageBase64 = ''; imageFilename = '';
  goStep(1);
}
window.resetModal = resetModal;

/* ── Utility ── */
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function timeAgo(isoStr) {
  const ms = Date.now() - new Date(isoStr).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

window.loadLeaderboard = loadLeaderboard;
window.loadReports = loadReports;
