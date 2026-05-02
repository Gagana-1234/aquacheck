/* community.js — AquaWatch Community Reporter & Rewards */

// Fix: API_BASE is '' on production (relative URL). '' is falsy so must check explicitly.
const API = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8000'
  : '';


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
  if (file.size > 10 * 1024 * 1024) { alert('File too large — max 10MB'); return; }
  imageFilename = file.name;

  const reader = new FileReader();
  reader.onload = (e) => {
    // Compress image using canvas before sending to backend
    const img = new Image();
    img.onload = () => {
      const MAX_W = 800;
      const scale = img.width > MAX_W ? MAX_W / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // Compress to JPEG at 70% quality
      const compressed = canvas.toDataURL('image/jpeg', 0.70);
      imageBase64 = compressed.split(',')[1];

      const compressedKB = Math.round(imageBase64.length * 0.75 / 1024);
      document.getElementById('img-preview').src = compressed;
      document.getElementById('img-preview-wrap').style.display = 'block';
      document.getElementById('upload-icon').textContent = '✅';
      document.getElementById('upload-text').textContent = file.name;
      document.getElementById('upload-sub').textContent = `${compressedKB} KB (compressed)`;
      document.getElementById('ai-badge-row').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}


/* ── Fetch with timeout helper ── */
async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/* ── Wake up Render server before submitting ── */
async function wakeServer(btn) {
  try {
    btn.textContent = '⏳ Waking server...';
    await fetchWithTimeout(`${API}/dashboard/stats`, {}, 55000);
  } catch (_) { /* ignore — just trying to wake it */ }
}

/* ── Submit Report ── */
async function submitReport() {
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '🤖 AI Analysing...';

  const name     = document.getElementById('inp-name').value.trim();
  const email    = document.getElementById('inp-email').value.trim();
  const severity = document.querySelector('input[name="severity"]:checked')?.value || 'Medium';
  const location = document.getElementById('inp-location').value.trim();
  const desc     = document.getElementById('inp-desc').value.trim();

  const buildPayload = (withImage) => ({
    reporter_name:  name,
    reporter_email: email,
    report_type:    selectedType || 'other',
    severity,
    description:    desc,
    location_text:  location,
    image_data:     withImage ? imageBase64 : '',
    image_filename: withImage ? imageFilename : '',
  });

  async function doSubmit(payload, label) {
    btn.textContent = label;
    const res = await fetchWithTimeout(`${API}/community/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 60000);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server error: ${res.status}`);
    }
    return res.json();
  }

  try {
    // Step 1: Wake sleeping server (Render free tier)
    await wakeServer(btn);

    let data;
    try {
      // Step 2a: Try with image
      data = await doSubmit(buildPayload(true), '🚀 Submitting...');
    } catch (e1) {
      if (imageBase64) {
        // Step 2b: Auto-retry WITHOUT image if image upload failed
        btn.textContent = '🔄 Retrying without photo...';
        try {
          data = await doSubmit(buildPayload(false), '🔄 Retrying without photo...');
          // Warn user image was dropped
          setTimeout(() => {
            const warn = document.createElement('div');
            warn.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#FF6B35;color:#fff;padding:12px 18px;border-radius:10px;font-size:13px;z-index:9999;max-width:300px';
            warn.textContent = '⚠️ Photo could not be uploaded — report submitted without image.';
            document.body.appendChild(warn);
            setTimeout(() => warn.remove(), 5000);
          }, 300);
        } catch (e2) {
          throw e2; // Both attempts failed
        }
      } else {
        throw e1;
      }
    }

    showSuccess(data);
    loadStats(); loadLeaderboard(); loadReports(); loadTypeChart();

  } catch(e) {
    if (e.name === 'AbortError') {
      alert('⏱️ Timed out.\n\nThe server is still starting up on Render.\nPlease wait 60 seconds then try again.');
    } else {
      alert('Submission failed: ' + (e.message || 'Network error. Try again in 30 seconds.'));
    }
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

/* ══════════════════════════════════════════════════════
   REDEEM AQUACOINS MODAL
══════════════════════════════════════════════════════ */

let redeemCitizenName = '';
let redeemCitizenCoins = 0;
let catalogData = [];
let zonesData = [];

/* ── Open / Close ── */
window.openRedeemModal = function() {
  document.getElementById('redeem-backdrop').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Load zones for donate tab
  loadZonesForDonate();
};
window.closeRedeemModal = function(e) {
  if (e && e.target) {
    if (e.target.closest && e.target.closest('.comm-modal')) return;
    if (!e.target.closest && e.target.id !== 'redeem-backdrop') return;
  }
  document.getElementById('redeem-backdrop').classList.remove('open');
  document.body.style.overflow = '';
};
document.getElementById('redeem-backdrop').addEventListener('click', function(e) {
  if (e.target === this) { this.classList.remove('open'); document.body.style.overflow = ''; }
});

/* ── Citizen Lookup ── */
window.lookupCitizen = async function() {
  const name = document.getElementById('redeem-name-inp').value.trim();
  const errEl = document.getElementById('redeem-lookup-err');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Please enter your name.'; errEl.style.display = 'block'; return; }
  try {
    const res = await fetchWithTimeout(`${API}/community/citizen/${encodeURIComponent(name)}`, {}, 55000);
    if (!res.ok) { errEl.textContent = 'Citizen not found. Submit a report first to earn coins!'; errEl.style.display = 'block'; return; }
    const data = await res.json();
    redeemCitizenName = data.citizen_name;
    redeemCitizenCoins = data.total_aqua_coins;
    document.getElementById('redeem-coin-display').textContent = `${redeemCitizenCoins.toLocaleString()} 🪙`;
    document.getElementById('redeem-tier-display').textContent = `Tier: ${data.tier} · ${data.verified_reports} verified reports`;
    document.getElementById('redeem-balance-bar').style.display = 'block';
    document.getElementById('redeem-tabs').style.display = 'block';
    loadCatalog();
    loadRedemptionHistory();
  } catch(e) {
    errEl.textContent = 'Server error. Please try again.';
    errEl.style.display = 'block';
  }
};

/* ── Tab Switching ── */
window.switchTab = function(tab) {
  document.querySelectorAll('.redeem-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.redeem-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
};

/* ── Bill Discount ── */
window.updateBillPreview = function() {
  const coins = parseInt(document.getElementById('bill-coins-inp').value) || 0;
  const disc = Math.floor(coins / 100) * 10;
  document.getElementById('bill-discount-preview').textContent = `₹${disc} Off`;
};

window.redeemBillDiscount = async function() {
  const coins = parseInt(document.getElementById('bill-coins-inp').value);
  if (!redeemCitizenName) return;
  if (coins > redeemCitizenCoins) { alert(`Insufficient coins! You have ${redeemCitizenCoins}.`); return; }
  const btn = document.getElementById('bill-redeem-btn');
  btn.disabled = true; btn.textContent = '⏳ Generating...';
  try {
    const res = await fetchWithTimeout(`${API}/community/redeem/bill-discount`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ citizen_name: redeemCitizenName, coins })
    }, 55000);
    const data = await res.json();
    if (!res.ok) { alert(data.detail || 'Error'); return; }
    redeemCitizenCoins = data.remaining_coins;
    document.getElementById('redeem-coin-display').textContent = `${redeemCitizenCoins.toLocaleString()} 🪙`;
    document.getElementById('bill-coupon-code').textContent = data.coupon_code;
    document.getElementById('bill-coupon-msg').textContent = data.message;
    document.getElementById('bill-result').style.display = 'block';
    loadCatalog();
  } catch(e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '🧾 Generate Coupon Code'; }
};

/* ── Rewards Catalog ── */
async function loadCatalog() {
  const grid = document.getElementById('catalog-grid');
  if (!catalogData.length) {
    try {
      const res = await fetchWithTimeout(`${API}/community/redeem/catalog`, {}, 55000);
      catalogData = await res.json();
    } catch(e) { grid.innerHTML = '<div style="color:var(--text-muted)">Could not load catalog.</div>'; return; }
  }
  grid.innerHTML = catalogData.map(r => {
    const canAfford = redeemCitizenCoins >= r.coins;
    return `
      <div class="catalog-card ${canAfford ? '' : 'insufficient'}" onclick="${canAfford ? `redeemReward('${r.id}','${escHtml(r.name)}',${r.coins})` : ''}">
        <div class="catalog-icon">${r.icon}</div>
        <div class="catalog-name">${escHtml(r.name)}</div>
        <div class="catalog-desc">${escHtml(r.description)}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
          <div class="catalog-cost">${r.coins.toLocaleString()} 🪙</div>
          <span class="catalog-cat">${r.category}</span>
        </div>
        ${!canAfford ? '<div style="font-size:10px;color:var(--accent-red);margin-top:4px">Need '+(r.coins-redeemCitizenCoins)+' more coins</div>' : ''}
      </div>`;
  }).join('');
}

window.redeemReward = async function(rewardId, rewardName, cost) {
  if (!confirm(`Redeem "${rewardName}" for ${cost} AquaCoins?`)) return;
  try {
    const res = await fetchWithTimeout(`${API}/community/redeem/reward`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ citizen_name: redeemCitizenName, reward_id: rewardId })
    }, 55000);
    const data = await res.json();
    if (!res.ok) { alert(data.detail || 'Error'); return; }
    redeemCitizenCoins = data.remaining_coins;
    document.getElementById('redeem-coin-display').textContent = `${redeemCitizenCoins.toLocaleString()} 🪙`;
    document.getElementById('catalog-result-msg').textContent = data.message;
    document.getElementById('catalog-result').style.display = 'block';
    loadCatalog();
    loadRedemptionHistory();
  } catch(e) { alert('Error: ' + e.message); }
};

/* ── Donate to Zone ── */
async function loadZonesForDonate() {
  if (zonesData.length) return;
  try {
    const res = await fetchWithTimeout(`${API}/zones`, {}, 55000);
    zonesData = await res.json();
    const sel = document.getElementById('donate-zone-sel');
    sel.innerHTML = '<option value="">Select a zone...</option>' +
      zonesData.map(z => `<option value="${z.id}">${z.name} (${z.status}) — ${z.region}</option>`).join('');
  } catch(e) { /* silently fail */ }
}

window.updateDonatePreview = function() {
  const coins = parseInt(document.getElementById('donate-coins-inp').value) || 0;
  const boost = Math.floor(coins / 50) * 5;
  document.getElementById('donate-boost-preview').textContent = `+${boost}% Priority`;
};

window.redeemDonate = async function() {
  const zoneId = parseInt(document.getElementById('donate-zone-sel').value);
  const coins  = parseInt(document.getElementById('donate-coins-inp').value);
  if (!zoneId) { alert('Please select a zone.'); return; }
  if (coins > redeemCitizenCoins) { alert(`Insufficient coins! You have ${redeemCitizenCoins}.`); return; }
  const btn = document.getElementById('donate-redeem-btn');
  btn.disabled = true; btn.textContent = '⏳ Donating...';
  try {
    const res = await fetchWithTimeout(`${API}/community/redeem/donate`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ citizen_name: redeemCitizenName, zone_id: zoneId, coins })
    }, 55000);
    const data = await res.json();
    if (!res.ok) { alert(data.detail || 'Error'); return; }
    redeemCitizenCoins = data.remaining_coins;
    document.getElementById('redeem-coin-display').textContent = `${redeemCitizenCoins.toLocaleString()} 🪙`;
    document.getElementById('donate-result-msg').textContent = data.message;
    document.getElementById('donate-result').style.display = 'block';
    loadCatalog();
    loadRedemptionHistory();
  } catch(e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = '💧 Donate & Boost Zone'; }
};

/* ── Redemption History ── */
async function loadRedemptionHistory() {
  const el = document.getElementById('history-list');
  el.innerHTML = '<div class="spinner" style="margin:20px auto"></div>';
  try {
    const res = await fetchWithTimeout(`${API}/community/redeem/history/${encodeURIComponent(redeemCitizenName)}`, {}, 55000);
    const data = await res.json();
    if (!data.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:10px 0">No redemptions yet.</div>'; return; }
    const typeMap = { bill_discount: ['🧾','Bill Discount'], reward: ['🎁','Reward'], donation: ['💧','Zone Donation'] };
    el.innerHTML = data.map(r => {
      const [icon, label] = typeMap[r.type] || ['🪙','Redemption'];
      let detail = '';
      if (r.type === 'bill_discount') detail = `Coupon: ${r.coupon_code} · ₹${r.discount_amount} off`;
      if (r.type === 'reward')        detail = r.reward_name;
      if (r.type === 'donation')      detail = `Donated to ${r.donated_to_zone} · +${r.priority_boost_pct}% boost`;
      return `
        <div class="history-item">
          <div class="history-icon">${icon}</div>
          <div class="history-info">
            <div class="history-title">${label}</div>
            <div class="history-sub">${escHtml(detail)} · ${timeAgo(r.created_at)}</div>
          </div>
          <div class="history-coins">-${r.coins_spent} 🪙</div>
        </div>`;
    }).join('');
  } catch(e) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Could not load history.</div>'; }
}
