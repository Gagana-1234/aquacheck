async function loadDashboard() {
  try {
    const stats = await api.getDashboardStats();

    // Stat cards count-up
    countUp(document.getElementById('stat-zones'), stats.total_zones);
    countUp(document.getElementById('stat-leaks'), stats.active_leaks);
    countUp(document.getElementById('stat-anomalies'), stats.anomalies_today);
    countUp(document.getElementById('stat-saved'), Math.round(stats.water_saved_litres), 'L');

    // Zone map
    const mapEl = document.getElementById('zone-map');
    mapEl.innerHTML = '';
    (stats.zone_summary || []).forEach(zone => {
      const cls = zone.status === 'Critical' ? 'critical' : zone.status === 'Anomaly' ? 'anomaly' : 'normal';
      const icon = zone.status === 'Critical' ? '🔴' : zone.status === 'Anomaly' ? '🟠' : '🟢';
      const div = document.createElement('div');
      div.className = `zone-cell ${cls.toLowerCase()}`;
      div.title = `${zone.name} — ${zone.deviation_pct > 0 ? '+' : ''}${zone.deviation_pct}% deviation`;
      div.innerHTML = `
        <div style="font-size:18px">${icon}</div>
        <div class="zone-cell-name">${zone.name.split(' ')[0]}</div>
        <div class="zone-cell-value">${zone.deviation_pct > 0 ? '+' : ''}${zone.deviation_pct}%</div>
      `;
      div.addEventListener('click', () => {
        window.location.href = `zones.html?zone=${zone.id}`;
      });
      mapEl.appendChild(div);
    });

    // Alerts panel
    const alertsEl = document.getElementById('alerts-panel');
    if (stats.recent_alerts && stats.recent_alerts.length > 0) {
      alertsEl.innerHTML = stats.recent_alerts.map(a => `
        <div class="alert-item">
          <div class="alert-dot ${a.severity.toLowerCase()}"></div>
          <div class="alert-content">
            <div class="alert-zone">${a.zone_name} <span class="badge badge-${a.severity === 'Critical' ? 'critical' : a.severity === 'Warning' ? 'warning' : 'info'}" style="font-size:9px">${a.severity}</span></div>
            <div class="alert-msg">${a.message}</div>
            <div class="alert-time">${timeAgo(a.created_at)}</div>
          </div>
        </div>
      `).join('');
    } else {
      showEmpty(alertsEl, 'No active alerts', 'All systems operating normally');
    }

    // Consumption chart
    if (stats.consumption_chart && stats.consumption_chart.length > 0) {
      createZoneConsumptionChart('consumption-chart', stats.consumption_chart);
      updateTicker(stats);
    }

  } catch (e) {
    showError(document.getElementById('alerts-panel'), e.message);
    document.getElementById('zone-map').innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:13px;padding:40px">⚠️ ${e.message}</div>`;
  }

  // Load network health mini
  try {
    const health = await api.get('/network/health');
    renderMiniGauge(health);
  } catch (_) {}
}

function updateTicker(stats) {
  const ticker = document.getElementById('ticker-text');
  if (!ticker) return;
  const parts = (stats.zone_summary || []).map(z =>
    `${z.name}: ${z.deviation_pct > 0 ? '+' : ''}${z.deviation_pct}% [${z.status.toUpperCase()}]`
  );
  parts.push(`🚨 Active Leaks: ${stats.active_leaks}`);
  parts.push(`⚠️ Anomalies Today: ${stats.anomalies_today}`);
  parts.push(`💧 Water Saved: ${Math.round(stats.water_saved_litres).toLocaleString()} L`);
  ticker.textContent = parts.join('   ·   ');
}

function renderMiniGauge(health) {
  const card = document.getElementById('health-mini-card');
  if (card) card.style.display = 'block';

  const canvas = document.getElementById('mini-gauge');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cx = 60, cy = 60, r = 42;
  ctx.clearRect(0, 0, 120, 120);

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0,194,255,0.1)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  const color = health.score >= 80 ? '#00E5A0' : health.score >= 60 ? '#FFD166' : '#FF3B5C';
  const end = Math.PI + (health.score / 100) * Math.PI;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, end);
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.font = 'bold 18px IBM Plex Mono';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(health.score.toFixed(0), cx, cy - 4);

  const statsEl = document.getElementById('health-mini-stats');
  if (statsEl) {
    const riskColor = health.risk_level === 'High' ? 'var(--accent-red)' : health.risk_level === 'Medium' ? 'var(--accent-orange)' : 'var(--accent-green)';
    statsEl.innerHTML = `
      <div style="font-size:22px;font-weight:700;color:${color};margin-bottom:6px">Grade ${health.grade}</div>
      <div class="badge" style="color:${riskColor};border-color:${riskColor};background:rgba(0,0,0,0.3);margin-bottom:10px">${health.risk_level} Risk</div>
      <div style="font-size:11px;color:var(--text-muted);font-family:'IBM Plex Mono',monospace">${health.stats.critical_zones} critical · ${health.stats.unresolved_alerts} alerts</div>
    `;
  }
}

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
loadDashboard();
setInterval(loadDashboard, 30000); // auto-refresh every 30s
