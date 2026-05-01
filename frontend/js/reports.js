let reportData = null;

// Set default dates (last 7 days)
(function initDates() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  document.getElementById('to-date').value = to.toISOString().split('T')[0];
  document.getElementById('from-date').value = from.toISOString().split('T')[0];
})();

async function generateReport() {
  const from = document.getElementById('from-date').value;
  const to   = document.getElementById('to-date').value;
  if (!from || !to) { alert('Please select a date range.'); return; }

  // Show skeletons
  ['report-stats','report-charts','report-table-card'].forEach(id => {
    document.getElementById(id).style.display = id === 'report-charts' ? 'grid' : 'block';
  });

  try {
    reportData = await api.getReports(from, to);

    // Stat cards
    countUp(document.getElementById('rpt-readings'), reportData.total_readings);
    countUp(document.getElementById('rpt-anomalies'), reportData.total_anomalies);
    document.getElementById('rpt-rate').textContent = `${reportData.anomaly_rate_pct}%`;
    document.getElementById('rpt-zones').textContent = reportData.zone_consumption.length;

    // Anomaly bar chart
    const days   = reportData.anomaly_by_day.map(d => d.day);
    const counts = reportData.anomaly_by_day.map(d => d.count);
    createBarChart('anomaly-bar-chart', days, counts, {
      label: 'Anomalies',
      color: CHART_COLORS.orange,
    });

    // Heatmap
    renderHeatmap(reportData.zone_consumption);

    // Zone table
    const tbody = document.getElementById('report-zone-tbody');
    tbody.innerHTML = reportData.zone_consumption.map(z => {
      const devColor = deviationColor(z.deviation_pct);
      const sign = z.deviation_pct > 0 ? '+' : '';
      return `
        <tr>
          <td style="font-family:'Rajdhani',sans-serif;font-size:14px;font-weight:600;color:var(--text-primary)">${z.zone_name}</td>
          <td>${z.region}</td>
          <td><span class="text-mono">${z.avg_consumption.toFixed(1)}</span></td>
          <td><span class="text-mono text-muted">${z.baseline.toFixed(1)}</span></td>
          <td><span style="color:${devColor};font-family:'IBM Plex Mono',monospace;font-size:12px">${sign}${z.deviation_pct}%</span></td>
        </tr>
      `;
    }).join('');

    document.getElementById('export-btn').style.display = 'inline-flex';

  } catch (e) {
    showError(document.getElementById('report-stats'), e.message);
  }
}

function renderHeatmap(zones) {
  const container = document.getElementById('heatmap-container');
  const maxDev = Math.max(...zones.map(z => Math.abs(z.deviation_pct)), 1);

  container.innerHTML = `<div class="heatmap-grid">${zones.map(z => {
    const abs = Math.abs(z.deviation_pct);
    const intensity = Math.min(abs / 60, 1); // 0–1 scale
    let bg;
    if (z.deviation_pct > 20)      bg = `rgba(255,59,92,${0.2 + intensity * 0.6})`;
    else if (z.deviation_pct > 0)  bg = `rgba(255,107,53,${0.2 + intensity * 0.5})`;
    else if (z.deviation_pct < -20) bg = `rgba(0,229,160,${0.2 + intensity * 0.6})`;
    else                            bg = `rgba(0,194,255,${0.15 + intensity * 0.4})`;

    const sign = z.deviation_pct > 0 ? '+' : '';
    return `
      <div class="heatmap-cell" style="background:${bg}" title="${z.zone_name}: ${sign}${z.deviation_pct}%">
        <div class="heatmap-label">${z.zone_name.split(' ')[0]}</div>
        <div class="heatmap-val">${sign}${z.deviation_pct}%</div>
      </div>
    `;
  }).join('')}</div>`;
}

function exportCSV() {
  if (!reportData) return;
  const rows = [
    ['Zone', 'Region', 'Avg Consumption (L/hr)', 'Baseline (L/hr)', 'Deviation %'],
    ...reportData.zone_consumption.map(z => [
      z.zone_name, z.region, z.avg_consumption, z.baseline, z.deviation_pct
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `aquawatch_report_${document.getElementById('from-date').value}_${document.getElementById('to-date').value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
generateReport(); // auto-load with default 7-day range
