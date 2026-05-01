// Global Chart.js dark theme defaults
Chart.defaults.color = '#7A9CC5';
Chart.defaults.borderColor = 'rgba(0,194,255,0.08)';
Chart.defaults.font.family = "'IBM Plex Mono', monospace";
Chart.defaults.font.size = 11;

const CHART_COLORS = {
  cyan:   '#00C2FF',
  orange: '#FF6B35',
  green:  '#00E5A0',
  red:    '#FF3B5C',
  yellow: '#FFD166',
  purple: '#A78BFA',
  pink:   '#F472B6',
};

const ZONE_COLORS = [
  '#00C2FF','#00E5A0','#FFD166','#FF6B35','#A78BFA',
  '#F472B6','#34D399','#60A5FA','#FBBF24','#FB7185',
];

function gradientFill(ctx, color, alpha = 0.25) {
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  gradient.addColorStop(0, color.replace(')', `, ${alpha})`).replace('rgb', 'rgba').replace('#', 'rgba(').replace('rgba(', 'rgba(') || `${color}${Math.round(alpha*255).toString(16).padStart(2,'0')}`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  return gradient;
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function makeGradient(ctx, color) {
  const grad = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
  grad.addColorStop(0, hexToRgba(color, 0.3));
  grad.addColorStop(1, hexToRgba(color, 0.0));
  return grad;
}

// ── Line Chart ──────────────────────────────────────────────────────────────
function createLineChart(canvasId, labels, datasets, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');

  // Destroy existing
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  const styledDatasets = datasets.map((ds, i) => {
    const color = ds.color || ZONE_COLORS[i % ZONE_COLORS.length];
    return {
      label: ds.label,
      data: ds.data,
      borderColor: color,
      backgroundColor: makeGradient(ctx, color),
      borderWidth: 2,
      pointRadius: ds.points !== false ? 3 : 0,
      pointHoverRadius: 6,
      pointBackgroundColor: color,
      pointBorderColor: '#0A0F1E',
      pointBorderWidth: 2,
      tension: 0.4,
      fill: ds.fill !== false,
      ...ds.extra,
    };
  });

  const chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: styledDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: '#7A9CC5', boxWidth: 10, padding: 16, font: { size: 11 } },
        },
        tooltip: {
          backgroundColor: 'rgba(13,27,42,0.95)',
          borderColor: 'rgba(0,194,255,0.3)',
          borderWidth: 1,
          titleColor: '#00C2FF',
          bodyColor: '#E8F0FE',
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,194,255,0.05)' },
          ticks: { color: '#3D5A7A', maxRotation: 0, maxTicksLimit: 8 },
        },
        y: {
          grid: { color: 'rgba(0,194,255,0.05)' },
          ticks: { color: '#3D5A7A' },
          ...options.yAxis,
        },
      },
      ...options.chart,
    },
  });

  canvas._chartInstance = chart;
  return chart;
}

// ── Bar Chart ───────────────────────────────────────────────────────────────
function createBarChart(canvasId, labels, data, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  const color = options.color || CHART_COLORS.cyan;

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: options.label || 'Count',
        data,
        backgroundColor: hexToRgba(color, 0.6),
        borderColor: color,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13,27,42,0.95)',
          borderColor: 'rgba(0,194,255,0.3)',
          borderWidth: 1,
          titleColor: '#00C2FF',
          bodyColor: '#E8F0FE',
          padding: 10,
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#3D5A7A', maxRotation: 45 } },
        y: { grid: { color: 'rgba(0,194,255,0.05)' }, ticks: { color: '#3D5A7A' }, beginAtZero: true },
      },
    },
  });

  canvas._chartInstance = chart;
  return chart;
}

// ── Multi-zone line chart helper ─────────────────────────────────────────────
function createZoneConsumptionChart(canvasId, readings24h) {
  // readings24h: array of {hour, total}
  const labels = readings24h.map(r => {
    const d = new Date(r.hour);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  });
  const data = readings24h.map(r => r.total);

  return createLineChart(canvasId, labels, [{
    label: 'Total Consumption (L/hr)',
    data,
    color: CHART_COLORS.cyan,
  }]);
}

// ── 7-day zone trend chart ───────────────────────────────────────────────────
function createZoneTrendChart(canvasId, readings) {
  // Sample to max 48 points for readability
  let pts = readings;
  if (pts.length > 48) {
    const step = Math.ceil(pts.length / 48);
    pts = pts.filter((_, i) => i % step === 0);
  }
  const labels = pts.map(r => {
    const d = new Date(r.timestamp);
    return d.toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit' });
  });
  const data = pts.map(r => r.consumption_value);

  return createLineChart(canvasId, labels, [{
    label: 'Consumption (L/hr)',
    data,
    color: CHART_COLORS.cyan,
  }]);
}

window.createLineChart = createLineChart;
window.createBarChart = createBarChart;
window.createZoneConsumptionChart = createZoneConsumptionChart;
window.createZoneTrendChart = createZoneTrendChart;
window.CHART_COLORS = CHART_COLORS;
window.ZONE_COLORS = ZONE_COLORS;
