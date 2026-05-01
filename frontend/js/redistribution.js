let currentPlan = null;

async function loadSuggestion() {
  const container = document.getElementById('plan-container');
  showLoading(container, 'Calculating optimal redistribution…');
  document.getElementById('accept-btn').style.display = 'none';
  try {
    currentPlan = await api.getRedistSuggestion();
    countUp(document.getElementById('surplus-count'), currentPlan.surplus_zones.length);
    countUp(document.getElementById('deficit-count'), currentPlan.deficit_zones.length);
    countUp(document.getElementById('total-litres'), Math.round(currentPlan.total_litres_redistributed));

    if (currentPlan.transfers.length === 0) {
      showEmpty(container, 'No redistribution needed', 'All zones within acceptable thresholds');
      return;
    }

    container.innerHTML = currentPlan.transfers.map((t, i) => `
      <div class="redist-flow" id="rf-${i}">
        <div class="redist-zone-card" style="border-color:rgba(0,229,160,0.35);background:rgba(0,229,160,0.05)">
          <div style="font-size:10px;color:var(--accent-green);font-weight:700;letter-spacing:1.2px;margin-bottom:6px">⬆ SURPLUS ZONE</div>
          <div class="redist-zone-name">${t.from_zone_name}</div>
          <div class="redist-zone-val">📍 ${t.from_zone_region}</div>
        </div>

        <div class="flow-arrow" style="min-width:100px">
          <svg width="100" height="48" viewBox="0 0 100 48" style="overflow:visible">
            <!-- Animated dashed line -->
            <line x1="0" y1="24" x2="80" y2="24" stroke="var(--accent-cyan)" stroke-width="2"
              stroke-dasharray="6 4" style="animation:waveDash 1.2s linear infinite"/>
            <!-- Arrowhead -->
            <polygon points="80,18 100,24 80,30" fill="var(--accent-cyan)" opacity="0.9"/>
            <!-- Water droplets -->
            <circle cx="20" cy="24" r="3" fill="var(--accent-cyan)" opacity="0.7" style="animation:dropFlow 1.2s linear infinite;animation-delay:0s"/>
            <circle cx="45" cy="24" r="3" fill="var(--accent-cyan)" opacity="0.7" style="animation:dropFlow 1.2s linear infinite;animation-delay:0.4s"/>
            <circle cx="65" cy="24" r="3" fill="var(--accent-cyan)" opacity="0.7" style="animation:dropFlow 1.2s linear infinite;animation-delay:0.8s"/>
          </svg>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--accent-cyan);text-align:center;margin-top:4px">
            💧 ${t.amount_litres.toFixed(1)} L/hr
          </div>
        </div>

        <div class="redist-zone-card" style="border-color:rgba(255,59,92,0.35);background:rgba(255,59,92,0.05)">
          <div style="font-size:10px;color:var(--accent-red);font-weight:700;letter-spacing:1.2px;margin-bottom:6px">⬇ DEFICIT ZONE</div>
          <div class="redist-zone-name">${t.to_zone_name}</div>
          <div class="redist-zone-val">📍 ${t.to_zone_region}</div>
        </div>
      </div>
    `).join('');

    // Stagger animation
    currentPlan.transfers.forEach((_, i) => {
      const el = document.getElementById(`rf-${i}`);
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(10px)';
        el.style.transition = 'opacity 0.4s, transform 0.4s';
        setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'none'; }, i * 120);
      }
    });

    document.getElementById('accept-btn').style.display = 'inline-flex';
  } catch (e) {
    showError(container, e.message);
  }
}

async function acceptPlan() {
  if (!currentPlan || !currentPlan.transfers.length) return;
  const btn = document.getElementById('accept-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving…';
  try {
    await api.acceptRedistPlan(currentPlan.transfers);
    btn.textContent = '✓ Plan Accepted!';
    btn.className = 'btn btn-ghost btn-sm';
    setTimeout(() => { btn.style.display = 'none'; loadHistory(); }, 1500);
  } catch (e) {
    alert(`Failed to accept plan: ${e.message}`);
    btn.disabled = false;
    btn.textContent = '✓ Accept Plan';
  }
}

async function loadHistory() {
  const tbody = document.getElementById('history-tbody');
  try {
    const plans = await api.getRedistHistory();
    if (plans.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state" style="padding:24px"><p class="empty-text">No redistribution history yet</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = plans.map(p => `
      <tr>
        <td><span class="text-mono text-cyan">#${p.id}</span></td>
        <td>${formatTime(p.created_at)}</td>
        <td><span style="color:var(--accent-green)">${p.from_zone_name}</span></td>
        <td><span style="color:var(--accent-red)">${p.to_zone_name}</span></td>
        <td><span class="text-mono">💧 ${p.amount_litres.toFixed(1)} L</span></td>
        <td>${badgeHTML(p.status)}</td>
      </tr>
    `).join('');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p class="text-orange">${e.message}</p></div></td></tr>`;
  }
}

startClock(document.getElementById('live-clock'));
startClock(document.getElementById('sidebar-time'));
loadSuggestion();
loadHistory();
