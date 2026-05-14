(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  let currentWeddingPlanId = null;
  const originalInit = window.initWeddingWebsiteDashboard;

  const isWeddingPlan = plan => String(plan?.eventType || '').toLowerCase() === 'wedding' || String(plan?.name || plan?.eventName || '').toLowerCase().includes('wedding');
  const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || decodeURIComponent((document.cookie.match(/(?:^|; )csrfToken=([^;]+)/) || [])[1] || '');

  async function postJson(path, payload) {
    const token = csrf();
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'X-CSRF-Token': token } : {}),
      },
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      const json = await response.json().catch(() => ({}));
      throw new Error(json.error || json.message || 'Request failed');
    }
  }

  function addDashboardLauncherMode() {
    const card = document.getElementById('wedding-website-dashboard-card');
    const root = document.getElementById(ROOT_ID);
    card?.classList.add('ww-card-launcher-only');
    root?.querySelector('.ww-launcher')?.classList.add('ww-launcher--clean');
  }

  function enhanceStats(root) {
    root.querySelectorAll('.ww-tiles > div').forEach(card => card.classList.add('ww-stat-card'));
  }

  function enhanceWorkspace(root) {
    const form = root.querySelector('#ww-builder');
    const panel = root.querySelector('.ww-app-panel');
    if (!form || panel?.querySelector('.ww-section-nav')) return;
    const nav = document.createElement('aside');
    nav.className = 'ww-section-nav';
    nav.innerHTML = '<p class="ww-kicker">Build sections</p><a href="#ww-essentials">Essentials</a><a href="#ww-travel">Travel</a><a href="#ww-party">Wedding party</a><a href="#ww-rsvp-form">RSVP form</a>';
    const labels = ['ww-essentials', 'ww-travel', 'ww-party', 'ww-rsvp-form'];
    form.querySelectorAll('details').forEach((details, index) => {
      if (labels[index]) details.id = labels[index];
    });
    panel?.classList.add('ww-workspace-panel');
    panel?.prepend(nav);
    root.querySelector('.ww-builder-actions')?.classList.add('ww-sticky-actions');
  }

  function enhanceShare(root) {
    const input = root.querySelector('.ww-share-card input[readonly]');
    const actions = root.querySelector('.ww-share-card .ww-actions');
    if (!input || !actions || root.querySelector('.ww-qr-card')) return;
    const url = input.value;
    const extra = document.createElement('div');
    extra.className = 'ww-share-layout-extra';
    extra.innerHTML = `<div class="ww-actions"><a class="cta secondary small" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(url)}">Share to WhatsApp</a><a class="cta secondary small" href="mailto:?subject=Wedding%20details&body=${encodeURIComponent(url)}">Share by email</a></div><div class="ww-qr-card"><div class="ww-qr-placeholder" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p>QR code placeholder</p><small>Designed for a lightweight QR utility in the next pass.</small></div>`;
    actions.after(extra);
    root.querySelector('#ww-copy-link')?.addEventListener('click', event => {
      const old = event.currentTarget.textContent;
      event.currentTarget.textContent = 'Copied';
      setTimeout(() => { event.currentTarget.textContent = old; }, 1600);
    });
  }

  function enhanceSeating(root) {
    const panel = root.querySelector('.ww-app-panel');
    const grid = root.querySelector('.seat-grid');
    const unseated = root.querySelector('.ww-unseated');
    if (!panel || !grid || !unseated || panel.classList.contains('ww-seating-enhanced')) return;
    panel.classList.add('ww-seating-enhanced');

    const layout = document.createElement('div');
    layout.className = 'ww-seat-layout';
    const unseatedPanel = document.createElement('aside');
    unseatedPanel.className = 'ww-unseated-panel';
    unseatedPanel.innerHTML = '<h4>Unseated attending guests</h4><p class="small">Drag a guest onto a table, or use the dropdown fallback.</p>';
    unseatedPanel.appendChild(unseated);
    const board = document.createElement('div');
    board.className = 'ww-table-board';
    board.appendChild(grid);
    layout.appendChild(unseatedPanel);
    layout.appendChild(board);
    panel.appendChild(layout);

    unseated.querySelectorAll('.seat-row').forEach(row => {
      const select = row.querySelector('.assign-select');
      if (!select?.dataset.guest) return;
      row.classList.add('ww-draggable-guest');
      row.draggable = true;
      row.dataset.guest = select.dataset.guest;
      row.addEventListener('dragstart', event => event.dataTransfer.setData('text/plain', row.dataset.guest));
    });

    grid.querySelectorAll('.seat-card').forEach(card => {
      const tableId = card.querySelector('.edit-table, .del-table')?.dataset.id;
      if (!tableId) return;
      card.classList.add('ww-table-card');
      card.dataset.table = tableId;
      const cap = card.querySelector('.seat-cap')?.textContent || '0/0';
      const parts = cap.split('/').map(value => Number(value.trim()) || 0);
      const percent = parts[1] ? Math.min(100, Math.round((parts[0] / parts[1]) * 100)) : 0;
      const bar = document.createElement('div');
      bar.className = 'ww-capacity-bar';
      bar.innerHTML = `<span style="width:${percent}%"></span>`;
      card.querySelector('.seat-card__head')?.after(bar);
      card.addEventListener('dragover', event => {
        event.preventDefault();
        card.classList.add('is-drop-target');
      });
      card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
      card.addEventListener('drop', async event => {
        event.preventDefault();
        card.classList.remove('is-drop-target');
        const guestId = event.dataTransfer.getData('text/plain');
        if (!guestId || !currentWeddingPlanId) return;
        await postJson(`/api/me/plans/${encodeURIComponent(currentWeddingPlanId)}/tables/${encodeURIComponent(tableId)}/assign-guest`, { guestId });
        window.initWeddingWebsiteDashboard.__lastToast?.('Guest assigned');
        card.closest('[data-pane="seating"]')?.querySelector('[aria-live]')?.remove();
        root.querySelector('.ww-app-tabs [data-tab="seating"]')?.click();
      });
    });
  }

  function observeWidget() {
    const observer = new MutationObserver(() => {
      addDashboardLauncherMode();
      document.querySelectorAll('.ww-app-dialog').forEach(dialog => {
        enhanceStats(dialog);
        enhanceWorkspace(dialog);
        enhanceSeating(dialog);
        enhanceShare(dialog);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.initWeddingWebsiteDashboard = async function patchedWeddingWebsiteDashboard(plans) {
    currentWeddingPlanId = (plans || []).find(isWeddingPlan)?.id || null;
    await originalInit?.(plans);
    addDashboardLauncherMode();
  };

  window.initWeddingWebsiteDashboard.__lastToast = message => {
    const el = document.createElement('div');
    el.className = 'ww-toast ww-toast--ok';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 240); }, 2200);
  };

  observeWidget();
})();
