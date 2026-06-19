/**
 * AmazonEnhanced — sidepanel.js
 * Persistent side panel showing price history and alerts.
 * Uses chrome.sidePanel API (Chrome 114+).
 */
(function () {
  'use strict';

  let currentView = 'history';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function sendMessage(msg) {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage(msg, response => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (e) { resolve(null); }
    });
  }

  function renderSparklineSvg(points, w, h) {
    if (!points || points.length < 2) return null;
    const prices = points.map(p => p.p);
    const min = Math.min(...prices), max = Math.max(...prices);
    const range = max - min || 1;
    const stepX = w / (points.length - 1);
    let d = '';
    points.forEach((pt, i) => {
      const x = i * stepX;
      const y = h - ((pt.p - min) / range) * (h - 4) - 2;
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1) + ' ';
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(w));
    svg.setAttribute('height', String(h));
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Price range: $${min.toFixed(2)} to $${max.toFixed(2)}`);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d.trim());
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#89b4fa');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  async function loadHistory() {
    const list = $('#sp-list');
    const empty = $('#sp-empty');
    list.innerHTML = '';

    const res = await sendMessage({ type: 'AMZE_IDB_GET_ALL_PRICE_HISTORY' });
    const entries = (res && res.entries) || [];

    if (!entries.length) {
      empty.style.display = '';
      empty.textContent = 'Browse Amazon product pages to build your price history.';
      return;
    }

    empty.style.display = 'none';
    // Sort by most recent point
    entries.sort((a, b) => {
      const aLast = a.points && a.points.length ? a.points[a.points.length - 1].t : 0;
      const bLast = b.points && b.points.length ? b.points[b.points.length - 1].t : 0;
      return bLast - aLast;
    });

    for (const entry of entries) {
      if (!entry.points || !entry.points.length) continue;
      const prices = entry.points.map(p => p.p);
      const min = Math.min(...prices), max = Math.max(...prices);
      const current = prices[prices.length - 1];
      const lastDate = new Date(entry.points[entry.points.length - 1].t);

      const item = document.createElement('div');
      item.className = 'amze-sp-item';

      const title = document.createElement('div');
      title.className = 'amze-sp-item-title';
      const link = document.createElement('a');
      link.href = `https://www.amazon.com/dp/${entry.asin}`;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = entry.asin;
      title.appendChild(link);
      item.appendChild(title);

      const priceRow = document.createElement('div');
      priceRow.className = 'amze-sp-prices';
      priceRow.innerHTML = '';
      const addStat = (label, value) => {
        const span = document.createElement('span');
        const strong = document.createElement('strong');
        strong.textContent = value;
        span.textContent = label + ' ';
        span.appendChild(strong);
        priceRow.appendChild(span);
      };
      addStat('Now:', '$' + current.toFixed(2));
      addStat('Low:', '$' + min.toFixed(2));
      addStat('High:', '$' + max.toFixed(2));
      addStat('Pts:', String(entry.points.length));
      item.appendChild(priceRow);

      const sparkContainer = document.createElement('div');
      sparkContainer.className = 'amze-sp-sparkline';
      const svg = renderSparklineSvg(entry.points, 240, 30);
      if (svg) sparkContainer.appendChild(svg);
      item.appendChild(sparkContainer);

      list.appendChild(item);
    }
  }

  async function loadAlerts() {
    const list = $('#sp-list');
    const empty = $('#sp-empty');
    list.innerHTML = '';

    const res = await sendMessage({ type: 'AMZE_GET_PRICE_ALERTS' });
    const alerts = (res && res.alerts) || {};
    const keys = Object.keys(alerts);

    if (!keys.length) {
      empty.style.display = '';
      empty.textContent = 'No price alerts set. Set alerts on product pages.';
      return;
    }

    empty.style.display = 'none';
    for (const asin of keys) {
      const alert = alerts[asin];
      const item = document.createElement('div');
      item.className = 'amze-sp-item';

      const title = document.createElement('div');
      title.className = 'amze-sp-item-title';
      const link = document.createElement('a');
      link.href = `https://www.amazon.com/dp/${asin}`;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.textContent = alert.title || asin;
      title.appendChild(link);
      item.appendChild(title);

      const status = document.createElement('div');
      status.className = 'amze-sp-alert';
      status.textContent = alert.notified
        ? 'Triggered! Target: $' + alert.target.toFixed(2)
        : 'Watching for: $' + alert.target.toFixed(2);
      item.appendChild(status);

      list.appendChild(item);
    }
  }

  function refresh() {
    if (currentView === 'history') loadHistory();
    else loadAlerts();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $$('.amze-sp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.amze-sp-tab').forEach(t => t.classList.toggle('active', t === tab));
        currentView = tab.dataset.view;
        refresh();
      });
    });
    refresh();
    // Auto-refresh every 30 seconds while panel is open
    setInterval(refresh, 30000);
  });
})();
