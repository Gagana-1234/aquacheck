let allZones = [];

async function loadZones() {
  const tbody = document.getElementById('zones-tbody');
  tbody.innerHTML = '<tr><td colspan="8"><div class="spinner"></div></td></tr>';
  try {
    allZones = await api.getZones();
    renderZones();
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-text text-orange">${e.message}</p></div></td></tr>`;
  }
}

function renderZones() {
  const search = document.getElementById('search-input').value.toLowerCase();
  const statusF = document.getElementById('status-filter').value;
  const sortBy  = document.getElementById('sort-select').value;

  let zones = allZones.filter(z => {
    if (statusF && z.status !== statusF) return false;
    if (search && !z.name.toLowerCase().includes(search) && !z.region.toLowerCase().includes(search)) return false;
    return true;
  });

  zones.sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'consumption') return b.current_consumption - a.current_consumption;
    return Math.abs(b.deviation_pct) - Math.abs(a.deviation_pct); // default: deviation
  });

  document.getElementById('zone-count').textContent = `${zones.length} zones`;

  const tbody = document.getElementById('zones-tbody');
  if (zones.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-text">No zones match your filters</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = zones.map(z => {
    const devColor = deviationColor(z.deviation_pct);
    const sign = z.deviation_pct > 0 ? '+' : '';
    return `
      <tr class="zone-row" data-id="${z.id}" style="cursor:pointer">
        <td><span class="text-mono text-cyan">#${String(z.id).padStart(3,'0')}</span></td>
        <td style="font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:600;color:var(--text-primary)">${z.name}</td>
        <td>${z.region}</td>
        <td><span class="text-mono">${z.current_consumption.toFixed(1)}</span></td>
        <td><span class="text-mono text-muted">${z.baseline_consumption.toFixed(1)}</span></td>
        <td><span style="color:${devColor};font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600">${sign}${z.deviation_pct}%</span></td>
        <td>${badgeHTML(z.status)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="openDetail(${z.id}, event)">📈 Details</button></td>
      </tr>
    `;
  }).join('');
}

async function openDetail(zoneId, e) {
  e && e.stopPropagation();
  const panel = document.getElementById('zone-detail-panel');
  panel.style.display = 'block';

  const zone = allZones.find(z => z.id === zoneId);
  if (zone) {
    document.getElementById('detail-zone-name').textContent = `📈 ${zone.name} — 7-Day Trend`;
    document.getElementById('detail-stats').innerHTML = `
      <div class="stat-card" style="--accent-color:var(--accent-cyan);padding:16px">
        <div class="stat-label">Current Rate</div>
        <div class="stat-value" style="font-size:24px">${zone.current_consumption.toFixed(1)}</div>
        <div class="stat-sub">L/hr</div>
      </div>
      <div class="stat-card" style="--accent-color:var(--accent-green);padding:16px">
        <div class="stat-label">Baseline</div>
        <div class="stat-value" style="font-size:24px">${zone.baseline_consumption.toFixed(1)}</div>
        <div class="stat-sub">L/hr target</div>
      </div>
      <div class="stat-card" style="--accent-color:${Math.abs(zone.deviation_pct) > 20 ? 'var(--accent-red)' : 'var(--accent-orange)'};padding:16px">
        <div class="stat-label">Deviation</div>
        <div class="stat-value" style="font-size:24px;color:${deviationColor(zone.deviation_pct)}">${zone.deviation_pct > 0 ? '+' : ''}${zone.deviation_pct}%</div>
        <div class="stat-sub">from baseline</div>
      </div>
    `;
  }

  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const readings = await api.getZoneReadings(zoneId, 7);
    if (readings.length === 0) {
      document.getElementById('zone-trend-chart').parentElement.innerHTML = '<div class="empty-state"><div class="empty-icon">📉</div><p class="empty-text">No readings available for this period</p></div>';
    } else {
      createZoneTrendChart('zone-trend-chart', readings);
    }
  } catch (e) {
    document.getElementById('zone-trend-chart').parentElement.innerHTML = `<div class="empty-state"><p class="text-orange">${e.message}</p></div>`;
  }

  // Load 6-hour forecast
  const fcPanel = document.getElementById('forecast-panel');
  if (fcPanel) {
    fcPanel.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:12px auto"></div>';
    try {
      const forecast = await api.get(`/zones/${zoneId}/forecast?hours=6`);
      renderForecast(forecast, fcPanel);
    } catch (err) {
      fcPanel.innerHTML = `<p class="text-muted text-sm">Forecast unavailable</p>`;
    }
  }
}

function renderForecast(forecast, container) {
  if (!container) return;
  const trendIcon = {
    rising_fast: '🔴 Rising Fast',
    rising: '🟠 Rising',
    stable: '🟢 Stable',
    falling: '🔵 Falling',
    falling_fast: '🟣 Falling Fast',
    insufficient_data: '⬜ Insufficient Data',
  }[forecast.trend] || '—';

  const items = (forecast.forecast || []).map(pt => {
    const color = pt.predicted_value > 500 ? 'var(--accent-red)' : 'var(--accent-cyan)';
    return `<div class="forecast-item">
      <span class="forecast-hour">+${pt.hour}h</span>
      <span style="font-size:10px;color:var(--text-muted)">${new Date(pt.timestamp).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</span>
      <span class="forecast-val" style="color:${color}">${pt.predicted_value.toFixed(1)} <span style="font-size:10px;color:var(--text-muted)">L/hr</span></span>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
      <span style="font-size:12px;font-weight:600;color:var(--text-secondary);letter-spacing:1px">6-HOUR FORECAST</span>
      <span style="font-size:11px;color:var(--text-muted)">${trendIcon}</span>
    </div>
    ${items || '<p class="text-muted text-sm">No forecast data</p>'}
  `;
}

function closeDetail() {
  document.getElementById('zone-detail-panel').style.display = 'none';
}

// Check URL param for direct zone open
const urlParams = new URLSearchParams(window.location.search);
const zoneParam = urlParams.get('zone');

document.getElementById('search-input').addEventListener('input', renderZones);
document.getElementById('status-filter').addEventListener('change', renderZones);
document.getElementById('sort-select').addEventListener('change', renderZones);

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
loadZones().then(() => {
  if (zoneParam) openDetail(parseInt(zoneParam));
});
