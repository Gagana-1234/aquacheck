// Network Health page JS
async function loadNetworkHealth() {
  try {
    const health = await api.get('/network/health');
    renderGauge(health.score);
    renderFactors(health.factors);
    renderHealthStats(health.stats);
    renderRiskBadge(health.risk_level, health.grade);
  } catch (e) {
    showError(document.getElementById('health-container'), e.message);
  }
}

function renderGauge(score) {
  const canvas = document.getElementById('health-gauge');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const r = 110;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0,194,255,0.1)';
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Color by score
  const color = score >= 80 ? '#00E5A0' : score >= 60 ? '#FFD166' : '#FF3B5C';
  const end = Math.PI + (score / 100) * Math.PI;

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Glow
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Score text
  ctx.font = 'bold 48px IBM Plex Mono';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(score.toFixed(0), cx, cy - 10);

  ctx.font = '14px Rajdhani';
  ctx.fillStyle = '#7A9CC5';
  ctx.fillText('HEALTH SCORE', cx, cy + 28);
}

function renderFactors(factors) {
  const el = document.getElementById('factor-bars');
  if (!el) return;
  const items = [
    { label: 'Zone Status', key: 'zone_health', icon: '🗺️' },
    { label: 'Anomaly Rate', key: 'anomaly_health', icon: '⚠️' },
    { label: 'Deviation', key: 'deviation_health', icon: '📊' },
    { label: 'Alert Health', key: 'alert_health', icon: '🚨' },
  ];
  el.innerHTML = items.map(item => {
    const val = factors[item.key] || 0;
    const color = val >= 80 ? 'var(--accent-green)' : val >= 60 ? 'var(--accent-yellow)' : 'var(--accent-red)';
    return `
      <div style="margin-bottom:18px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:13px;color:var(--text-secondary)">${item.icon} ${item.label}</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:${color}">${val.toFixed(1)}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar" style="width:${val}%;background:${color};box-shadow:0 0 8px ${color}"></div>
        </div>
      </div>`;
  }).join('');
}

function renderHealthStats(stats) {
  const cards = [
    { id: 'hs-zones', label: 'Total Zones', val: stats.total_zones, color: 'var(--accent-cyan)' },
    { id: 'hs-critical', label: 'Critical Zones', val: stats.critical_zones, color: 'var(--accent-red)' },
    { id: 'hs-anomrate', label: 'Anomaly Rate', val: stats.anomaly_rate_24h + '%', color: 'var(--accent-orange)' },
    { id: 'hs-alerts', label: 'Unresolved Alerts', val: stats.unresolved_alerts, color: 'var(--accent-yellow)' },
  ];
  cards.forEach(c => {
    const el = document.getElementById(c.id);
    if (el) { el.textContent = c.val; el.style.color = c.color; }
  });
}

function renderRiskBadge(risk, grade) {
  const el = document.getElementById('risk-badge');
  if (!el) return;
  const color = risk === 'High' ? 'var(--accent-red)' : risk === 'Medium' ? 'var(--accent-orange)' : 'var(--accent-green)';
  el.innerHTML = `<span style="font-size:28px;font-weight:700;color:${color}">${grade}</span>
    <span class="badge" style="background:rgba(0,0,0,0.3);color:${color};border:1px solid ${color};margin-left:10px">${risk} Risk</span>`;
}

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
loadNetworkHealth();
setInterval(loadNetworkHealth, 30000);
