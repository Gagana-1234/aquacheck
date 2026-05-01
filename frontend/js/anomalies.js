let allAnomalies = [];
const resolvedIds = new Set();

async function loadAnomalies() {
  const listEl = document.getElementById('anomalies-list');
  showLoading(listEl, 'Fetching anomaly data…');
  try {
    const severity = document.getElementById('severity-filter').value;
    const params = severity ? { severity } : {};
    allAnomalies = await api.getAnomalies(params);
    renderAnomalies();
  } catch (e) {
    showError(listEl, e.message);
  }
}

function renderAnomalies() {
  const typeF = document.getElementById('type-filter').value;
  let list = allAnomalies.filter(a => {
    if (resolvedIds.has(a.id)) return false;
    if (typeF && a.anomaly_type !== typeF) return false;
    return true;
  });

  document.getElementById('anomaly-count').textContent = `${list.length} anomalies`;

  const listEl = document.getElementById('anomalies-list');
  if (list.length === 0) {
    showEmpty(listEl, 'No anomalies found', 'All zones operating within parameters');
    return;
  }

  listEl.innerHTML = list.map(a => {
    const scoreClass = a.anomaly_score >= 70 ? 'progress-critical' : a.anomaly_score >= 40 ? 'progress-warning' : 'progress-info';
    const typeLabel = {
      leak: '🚰 Leak',
      overconsumption: '📈 Overconsumption',
      unusual_pattern: '🔍 Unusual Pattern',
    }[a.anomaly_type] || '❓ Unknown';

    return `
      <div class="anomaly-row" id="anomaly-${a.id}">
        <div class="anomaly-header">
          <div>
            <div class="anomaly-zone">${a.zone_name} <span class="text-muted text-xs">— ${a.zone_region}</span></div>
            <div class="anomaly-meta mt-4">${formatTime(a.timestamp)} &nbsp;·&nbsp; ${typeLabel} &nbsp;·&nbsp; ${badgeHTML(a.severity)}</div>
          </div>
          <div style="text-align:right">
            <div class="anomaly-score-label">Score: <span style="color:${a.anomaly_score >= 70 ? 'var(--accent-red)' : a.anomaly_score >= 40 ? 'var(--accent-orange)' : 'var(--accent-cyan)'}">${a.anomaly_score.toFixed(0)}/100</span></div>
            <div class="anomaly-meta mt-4">${a.consumption_value.toFixed(1)} L/hr</div>
          </div>
        </div>
        <div class="progress-bar-wrap mt-8">
          <div class="progress-bar ${scoreClass}" style="width:${a.anomaly_score}%"></div>
        </div>
        <div class="anomaly-actions">
          <button class="btn btn-ghost btn-sm" onclick="explainAnomaly(${a.id})">🔍 Explain</button>
          <button class="btn btn-success btn-sm" onclick="resolveAnomaly(${a.id})">✓ Resolve</button>
          <button class="btn btn-ghost btn-sm" onclick="flagReview(${a.id})">🏷️ Flag for Review</button>
        </div>
        <div class="anomaly-explain-box" id="explain-${a.id}"></div>
      </div>
    `;
  }).join('');
}

async function explainAnomaly(id) {
  const box = document.getElementById(`explain-${id}`);
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = '<div class="spinner" style="width:20px;height:20px;margin:8px auto"></div>';
  try {
    const data = await api.explainAnomaly(id);
    box.innerHTML = `<strong style="color:var(--accent-cyan)">🤖 AI Analysis:</strong><br/>${data.explanation}`;
  } catch (e) {
    box.innerHTML = `<span style="color:var(--accent-red)">${e.message}</span>`;
  }
}

async function resolveAnomaly(id) {
  try {
    await api.resolveAnomaly(id);
    resolvedIds.add(id);
    const row = document.getElementById(`anomaly-${id}`);
    if (row) {
      row.style.opacity = '0';
      row.style.transition = 'opacity 0.4s';
      setTimeout(() => { row.remove(); }, 400);
    }
  } catch (e) {
    alert(`Failed to resolve: ${e.message}`);
  }
}

function flagReview(id) {
  const row = document.getElementById(`anomaly-${id}`);
  if (row) {
    const header = row.querySelector('.anomaly-zone');
    if (header && !header.querySelector('.flagged')) {
      header.insertAdjacentHTML('beforeend', ' <span class="badge badge-warning flagged">🏷️ Flagged</span>');
    }
  }
}

document.getElementById('severity-filter').addEventListener('change', loadAnomalies);
document.getElementById('type-filter').addEventListener('change', renderAnomalies);

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
loadAnomalies();
