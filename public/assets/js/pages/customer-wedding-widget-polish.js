(function () {
  'use strict';

  const ROOT_ID = 'wedding-website-dashboard-root';
  const originalInit = window.initWeddingWebsiteDashboard;

  const isWeddingPlan = plan => String(plan?.eventType || '').toLowerCase() === 'wedding' || String(plan?.name || plan?.eventName || '').toLowerCase().includes('wedding');

  function injectStyles() {
    if (document.getElementById('ww-polish-enhancer-styles')) return;
    const style = document.createElement('style');
    style.id = 'ww-polish-enhancer-styles';
    style.textContent = `
      .customer-wedding-card.ww-card-launcher-only .card-collapse-toggle,
      .customer-wedding-card.ww-card-launcher-only [data-collapse-toggle],
      .customer-wedding-card.ww-card-launcher-only .cd-card-toggle { display: none !important; }
      .ww-launcher--clean { margin: .15rem 0; }
      .ww-stat-card { border-radius: 18px !important; padding: .85rem !important; display: grid; gap: .35rem; }
      .ww-stat-card strong { color: var(--ww-navy, #24436f); font-size: 1.15rem; }
      .ww-section-nav { display: flex; flex-wrap: wrap; gap: .45rem; margin-bottom: .75rem; padding: .65rem; border: 1px solid rgba(80,192,176,.16); border-radius: 16px; background: rgba(255,255,255,.64); }
      .ww-section-nav .ww-kicker { flex: 1 1 100%; }
      .ww-section-nav a { border: 1px solid rgba(80,192,176,.18); border-radius: 999px; color: var(--ww-navy, #24436f); font-size: .8rem; font-weight: 800; padding: .38rem .65rem; text-decoration: none; }
      .ww-sticky-actions { position: sticky; top: 0; z-index: 4; padding: .55rem; border: 1px solid rgba(80,192,176,.14); border-radius: 16px; background: rgba(249,254,253,.9); backdrop-filter: blur(14px); }
      .ww-seat-layout { display: grid; grid-template-columns: minmax(230px, .8fr) minmax(0, 1.6fr); gap: 1rem; margin-top: 1rem; }
      .ww-unseated-panel, .ww-table-board, .ww-qr-card { border: 1px solid rgba(80,192,176,.16); border-radius: 18px; background: rgba(255,255,255,.62); padding: .85rem; }
      .ww-draggable-guest { cursor: grab; }
      .ww-draggable-guest:active { cursor: grabbing; }
      .ww-table-card { transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
      .ww-table-card.is-drop-target { border-color: rgba(80,192,176,.58) !important; box-shadow: 0 18px 42px rgba(44,148,177,.16) !important; transform: translateY(-2px); }
      .ww-capacity-bar { height: 8px; overflow: hidden; border-radius: 999px; background: rgba(80,192,176,.12); margin: .55rem 0; }
      .ww-capacity-bar span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--ww-mint, #50c0b0), var(--ww-teal, #2c94b1)); }
      .ww-qr-placeholder { display: grid; grid-template-columns: repeat(2, 38px); grid-template-rows: repeat(2, 38px); gap: 8px; width: max-content; padding: 12px; border: 1px solid rgba(80,192,176,.18); border-radius: 16px; background: #fff; }
      .ww-qr-placeholder span { border-radius: 8px; background: linear-gradient(135deg, var(--ww-navy, #24436f), var(--ww-teal, #2c94b1)); }
      @media (max-width: 720px) { .ww-seat-layout { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function addDashboardLauncherMode() {
    injectStyles();
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
    panel.classList.add('ww-workspace-panel');
    panel.prepend(nav);
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
      setTimeout(() => {
        event.currentTarget.textContent = old;
      }, 1600);
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
      card.addEventListener('drop', event => {
        event.preventDefault();
        card.classList.remove('is-drop-target');
        const guestId = event.dataTransfer.getData('text/plain');
        const select = unseated.querySelector(`.assign-select[data-guest="${CSS.escape(guestId)}"]`);
        if (!select) return;
        select.value = tableId;
        select.dispatchEvent(new Event('change', { bubbles: true }));
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
    await originalInit?.(plans);
    if ((plans || []).some(isWeddingPlan)) addDashboardLauncherMode();
  };

  injectStyles();
  observeWidget();
})();
