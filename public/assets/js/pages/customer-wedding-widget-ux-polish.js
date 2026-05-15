(function () {
  'use strict';

  const STYLE_ID = 'ww-widget-ux-polish-styles';
  let queued = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ww-app-dialog.ww-ux-polished .ww-product-next .cta {
        justify-self: end;
        min-width: 120px;
        border-color: rgba(20, 184, 166, 0.42) !important;
        background: linear-gradient(135deg, #21c7b4, #0f9f91) !important;
        color: #ffffff !important;
        box-shadow: 0 12px 26px rgba(15, 159, 145, 0.2);
      }

      .ww-app-dialog.ww-ux-polished .ww-product-next .cta:hover {
        box-shadow: 0 16px 30px rgba(15, 159, 145, 0.26);
        transform: translateY(-1px);
      }

      .ww-app-dialog.ww-ux-polished .ww-product-progress {
        align-content: center;
      }

      .ww-app-dialog.ww-ux-polished [data-pane='workspace'] .ww-app-panel {
        padding: 1rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-builder-actions.ww-glass-card {
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.65rem;
        padding: 0.58rem;
        border-radius: 18px;
      }

      .ww-app-dialog.ww-ux-polished .ww-builder-actions .cta {
        min-height: 40px;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace {
        gap: 0.55rem;
        margin-top: 0.65rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace details {
        overflow: hidden;
        padding: 0 !important;
        border-radius: 18px !important;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace summary {
        display: flex;
        min-height: 58px;
        align-items: center;
        justify-content: space-between;
        gap: 0.85rem;
        padding: 0.9rem 1rem;
        color: var(--ww-navy, #24436f);
        cursor: pointer;
        font-size: 0.94rem;
        font-weight: 820;
        letter-spacing: -0.018em;
        list-style: none;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace summary::-webkit-details-marker {
        display: none;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace summary::after {
        content: '⌄';
        display: inline-flex;
        width: 2rem;
        height: 2rem;
        flex: 0 0 auto;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(80, 192, 176, 0.22);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.84);
        color: #0f766e;
        font-size: 1rem;
        line-height: 1;
        transition: transform 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace details[open] summary::after {
        transform: rotate(180deg);
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace summary:hover::after {
        background: rgba(235, 251, 248, 0.95);
        box-shadow: 0 8px 18px rgba(36, 67, 111, 0.08);
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace details[open] {
        padding-bottom: 0.75rem !important;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace details[open] > :not(summary) {
        margin-right: 0.9rem;
        margin-left: 0.9rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace details[open] > label:first-of-type,
      .ww-app-dialog.ww-ux-polished .ww-product-workspace details[open] > div:first-of-type {
        margin-top: 0.2rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-product-workspace .rep-item {
        margin: 0.45rem 0;
        padding: 0.72rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .seat-grid {
        align-items: stretch;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .seat-card {
        min-height: 196px;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .seat-card__head {
        gap: 0.75rem;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .seat-row {
        align-items: center;
        min-height: 38px;
        padding: 0.45rem 0;
        border-top: 1px solid rgba(80, 192, 176, 0.1);
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .assign-select,
      .ww-app-dialog.ww-ux-polished .ww-seating-polished .ww-seat-assign-select {
        min-width: 170px;
        width: auto;
        max-width: 100%;
        border: 1px solid rgba(80, 192, 176, 0.24);
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.92);
        color: var(--ww-ink, #172033);
        font-weight: 760;
        box-shadow: 0 8px 18px rgba(36, 67, 111, 0.055);
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .unassign,
      .ww-app-dialog.ww-ux-polished .ww-seating-polished .ww-seat-unassign {
        display: inline-flex;
        min-height: 32px;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(245, 137, 124, 0.36);
        border-radius: 999px;
        background: rgba(255, 247, 247, 0.92);
        color: #a3362b;
        cursor: pointer;
        font-size: 0.78rem;
        font-weight: 820;
        padding: 0.42rem 0.7rem;
        transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .unassign:hover,
      .ww-app-dialog.ww-ux-polished .ww-seating-polished .ww-seat-unassign:hover {
        background: #fff1f1;
        box-shadow: 0 10px 20px rgba(163, 54, 43, 0.11);
        transform: translateY(-1px);
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .edit-table,
      .ww-app-dialog.ww-ux-polished .ww-seating-polished .del-table {
        width: max-content;
      }

      .ww-app-dialog.ww-ux-polished .ww-seating-polished .ww-unseated {
        display: grid;
        gap: 0.25rem;
      }

      @media (max-width: 760px) {
        .ww-app-dialog.ww-ux-polished .ww-product-next .cta {
          justify-self: stretch;
        }

        .ww-app-dialog.ww-ux-polished .ww-builder-actions.ww-glass-card {
          align-items: stretch;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function polishWorkspace(dialog) {
    const form = dialog.querySelector('[data-pane="workspace"] #ww-builder');
    if (!form || form.dataset.wwUxPolished === 'true') {
      return;
    }

    form.dataset.wwUxPolished = 'true';
    form.classList.add('ww-product-workspace');
    form.querySelectorAll('details').forEach(details => {
      details.open = false;
      details.dataset.wwDefaultCollapsed = 'true';
    });
  }

  function polishSeating(dialog) {
    const panel = dialog.querySelector('[data-pane="seating"] .ww-app-panel');
    if (!panel) {
      return;
    }

    panel.classList.add('ww-seating-polished');
    panel.querySelectorAll('.assign-select').forEach(select => {
      select.classList.add('ww-seat-assign-select');
      if (!select.getAttribute('aria-label')) {
        select.setAttribute('aria-label', 'Assign guest to a table');
      }
    });
    panel.querySelectorAll('.unassign').forEach(button => {
      button.classList.add('ww-seat-unassign');
    });
  }

  function polishDialog(dialog) {
    dialog.classList.add('ww-ux-polished');
    polishWorkspace(dialog);
    polishSeating(dialog);
  }

  function run() {
    injectStyles();
    document.querySelectorAll('.ww-app-dialog').forEach(polishDialog);
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      run();
    });
  }

  const observer = new MutationObserver(mutations => {
    if (
      mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(
          node =>
            node instanceof Element &&
            (node.matches('.ww-app-dialog,.ww-app-panel,#ww-builder,.seat-grid,.ww-unseated') ||
              node.querySelector?.('.ww-app-dialog,.ww-app-panel,#ww-builder,.seat-grid,.ww-unseated'))
        )
      )
    ) {
      schedule();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('.ww-app-tabs button,[data-tab]')) {
      [0, 120, 450].forEach(delay => window.setTimeout(schedule, delay));
    }
  }, true);

  schedule();
})();
