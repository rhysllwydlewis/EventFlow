'use strict';
(() => {
  if (!document.body.classList.contains('admin-homepage-manager')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'homepage-manager-hardening-styles';
  style.textContent = `
    @media (max-width: 1180px) {
      .admin-homepage-manager .homepage-manager-layout,
      .admin-homepage-manager .homepage-form-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .admin-homepage-manager .homepage-version-sidebar {
        position: static !important;
        top: auto !important;
      }
    }
    @media (max-width: 760px) {
      .admin-homepage-manager .homepage-media-item {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .admin-homepage-manager .homepage-media-actions {
        max-width: none !important;
      }
    }
    .homepage-dirty-notice {
      display: none;
      align-items: center;
      gap: 8px;
      margin-right: auto;
      padding: 8px 12px;
      border: 1px solid #f4c56a;
      border-radius: 10px;
      background: #fff8e7;
      color: #7a4b00;
      font-size: 0.85rem;
      font-weight: 750;
    }
    .admin-homepage-manager.is-dirty .homepage-dirty-notice {
      display: inline-flex;
    }
    .homepage-rename-panel {
      display: grid;
      gap: 8px;
      margin: 14px 0 16px;
      padding: 14px;
      border: 1px solid #dce5ed;
      border-radius: 12px;
      background: #f8fbfc;
    }
    .homepage-rename-panel label {
      color: #334155;
      font-size: 0.82rem;
      font-weight: 800;
    }
    .homepage-rename-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
    }
    .homepage-rename-row input {
      min-width: 0;
      min-height: 40px;
      border: 1px solid #cfd9e3;
      border-radius: 9px;
      padding: 8px 10px;
      font: inherit;
    }
    .homepage-rename-row input:focus-visible {
      outline: 3px solid rgba(13, 148, 136, 0.22);
      outline-offset: 1px;
      border-color: #0b8073;
    }
    .admin-homepage-manager[aria-busy='true'] .homepage-version-tab,
    .admin-homepage-manager[aria-busy='true'] .homepage-version-card button,
    .admin-homepage-manager[aria-busy='true'] .homepage-media-actions button {
      cursor: progress;
    }
    .homepage-operation-busy {
      position: relative;
      pointer-events: none;
      opacity: 0.68;
    }
    .homepage-operation-busy::after {
      content: '';
      width: 14px;
      height: 14px;
      margin-left: 8px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: homepage-hardening-spin 0.65s linear infinite;
    }
    @keyframes homepage-hardening-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .homepage-operation-busy::after { animation: none; }
    }
  `;
  document.head.appendChild(style);

  let dirty = false;
  let bypassDiscardGuard = false;
  let pendingRequests = 0;
  let lastFocusedElement = null;

  const form = document.getElementById('heroSettingsForm');
  const saveButton = document.getElementById('saveHeroSettings');
  const resetButton = document.getElementById('resetHeroSettings');
  const selectedTitle = document.getElementById('selectedHomepageTitle');
  const modal = document.getElementById('categoryModal');

  function showMessage(message, type = 'warning') {
    if (window.AdminShared?.showToast) {
      window.AdminShared.showToast(message, type);
      return;
    }
    const status = document.getElementById('homepageStatus');
    if (status) {
      status.textContent = message;
      status.hidden = false;
      status.classList.toggle('is-error', type === 'error' || type === 'warning');
    }
  }

  function selectedVersion() {
    return (
      document.querySelector('.homepage-version-tab.is-active[data-select-version]')?.dataset
        .selectVersion || 'v1'
    );
  }

  function syncDirtyUi() {
    document.body.classList.toggle('is-dirty', dirty);
    document
      .querySelectorAll('[data-publish-version], #publishSelectedHomepage')
      .forEach(button => {
        if (!(button instanceof HTMLButtonElement)) {
          return;
        }
        if (dirty) {
          button.dataset.hardeningDisabled = button.disabled ? 'already' : 'added';
          button.disabled = true;
          button.title = 'Save or reset the current homepage changes before publishing.';
        } else if (button.dataset.hardeningDisabled === 'added') {
          button.disabled = false;
          button.removeAttribute('title');
          delete button.dataset.hardeningDisabled;
        }
      });
  }

  function markDirty() {
    if (!dirty) {
      dirty = true;
      syncDirtyUi();
    }
  }

  function clearDirty() {
    dirty = false;
    syncDirtyUi();
  }

  function installDirtyNotice() {
    const actions = document.querySelector('.homepage-form-actions');
    if (!actions || actions.querySelector('.homepage-dirty-notice')) {
      return;
    }
    const notice = document.createElement('span');
    notice.className = 'homepage-dirty-notice';
    notice.setAttribute('role', 'status');
    notice.textContent = 'Unsaved changes';
    actions.prepend(notice);
  }

  function confirmDiscard() {
    return window.confirm('You have unsaved homepage changes. Discard them and continue?');
  }

  document.addEventListener(
    'click',
    event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }

      const publishControl = target.closest('[data-publish-version], #publishSelectedHomepage');
      if (publishControl && dirty) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showMessage('Save or reset your changes before setting a homepage live.', 'warning');
        saveButton?.focus();
        return;
      }

      const guardedControl = target.closest(
        '[data-select-version], [data-edit-version], [data-hero-use], [data-hero-primary], [data-hero-move], [data-hero-remove-target], [data-hero-delete], #backToDashboard, #refreshBtn, a[href]'
      );
      if (!guardedControl || !dirty || bypassDiscardGuard) {
        return;
      }

      const href = guardedControl.getAttribute('href');
      if (href?.startsWith('#')) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      if (!confirmDiscard()) {
        return;
      }

      clearDirty();
      bypassDiscardGuard = true;
      guardedControl.click();
      bypassDiscardGuard = false;
    },
    true
  );

  form?.addEventListener('input', markDirty);
  form?.addEventListener('change', markDirty);
  resetButton?.addEventListener('click', () => window.setTimeout(clearDirty, 0));

  window.addEventListener('beforeunload', event => {
    if (!dirty) {
      return;
    }
    event.preventDefault();
    event.returnValue = '';
  });

  function setBusy(elements, busy) {
    elements.filter(Boolean).forEach(element => {
      element.classList.toggle('homepage-operation-busy', busy);
      element.setAttribute('aria-busy', String(busy));
      if (element instanceof HTMLButtonElement) {
        if (busy) {
          element.dataset.wasDisabled = String(element.disabled);
          element.disabled = true;
        } else if (element.dataset.wasDisabled === 'false') {
          element.disabled = false;
          delete element.dataset.wasDisabled;
        }
      }
    });
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(
      init.method || (typeof input !== 'string' && input?.method) || 'GET'
    ).toUpperCase();
    const isManagerMutation = method !== 'GET' && /\/api\/v1\/admin\/homepage\/manager\//.test(url);
    let busyElements = [];

    if (isManagerMutation) {
      pendingRequests += 1;
      document.body.setAttribute('aria-busy', 'true');
      if (/\/publish\//.test(url)) {
        busyElements = Array.from(
          document.querySelectorAll('[data-publish-version], #publishSelectedHomepage')
        );
      } else if (/\/version\//.test(url)) {
        busyElements = [saveButton];
      } else {
        busyElements = Array.from(document.querySelectorAll('.homepage-media-actions button'));
      }
      setBusy(busyElements, true);
    }

    try {
      const response = await nativeFetch(input, init);
      if (response.ok && method === 'PUT' && /\/manager\/version\//.test(url)) {
        clearDirty();
      }
      return response;
    } finally {
      if (isManagerMutation) {
        pendingRequests = Math.max(0, pendingRequests - 1);
        setBusy(busyElements, false);
        if (pendingRequests === 0) {
          document.body.removeAttribute('aria-busy');
        }
      }
    }
  };

  function installRenamePanel() {
    const tabs = document.getElementById('heroVersionTabs');
    if (!tabs || document.getElementById('homepageRenameInput')) {
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'homepage-rename-panel';
    panel.innerHTML = `
      <label for="homepageRenameInput">Homepage tab name</label>
      <div class="homepage-rename-row">
        <input id="homepageRenameInput" type="text" maxlength="40" autocomplete="off">
        <button id="homepageRenameSave" class="ef-cta btn btn-secondary" type="button">Rename</button>
      </div>
    `;
    tabs.insertAdjacentElement('afterend', panel);

    const input = panel.querySelector('#homepageRenameInput');
    const button = panel.querySelector('#homepageRenameSave');

    const syncName = () => {
      if (document.activeElement !== input) {
        input.value = selectedTitle?.textContent?.trim() || '';
      }
    };

    button.addEventListener('click', async () => {
      if (dirty) {
        showMessage(
          'Save or reset the current hero changes before renaming this homepage.',
          'warning'
        );
        saveButton?.focus();
        return;
      }

      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!name || name.length > 40) {
        showMessage('Enter a homepage name between 1 and 40 characters.', 'warning');
        input.focus();
        return;
      }

      setBusy([button], true);
      try {
        const csrfResponse = await nativeFetch('/api/v1/csrf-token', { credentials: 'include' });
        const csrfData = await csrfResponse.json();
        const response = await nativeFetch(
          `/api/v1/admin/homepage/manager/version/${selectedVersion()}`,
          {
            method: 'PUT',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfData.csrfToken,
            },
            body: JSON.stringify({ tabName: name }),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Could not rename the homepage.');
        }
        showMessage('Homepage name updated.', 'success');
        document.getElementById('refreshBtn')?.click();
      } catch (error) {
        showMessage(error.message || 'Could not rename the homepage.', 'error');
      } finally {
        setBusy([button], false);
      }
    });

    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        button.click();
      }
    });

    new MutationObserver(syncName).observe(selectedTitle, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    new MutationObserver(() => window.setTimeout(syncDirtyUi, 0)).observe(tabs, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    syncName();
  }

  function focusableElements(container) {
    return Array.from(
      container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(element => !element.hidden && element.getClientRects().length > 0);
  }

  function syncModalAccessibility() {
    if (!modal) {
      return;
    }
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'categoryModalTitle');
    if (!modal.hidden) {
      lastFocusedElement = document.activeElement;
      window.setTimeout(() => focusableElements(modal)[0]?.focus(), 0);
    } else if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  modal?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      document.getElementById('closeCategoryModal')?.click();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = focusableElements(modal);
    if (!focusable.length) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (modal) {
    new MutationObserver(syncModalAccessibility).observe(modal, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
    syncModalAccessibility();
  }

  installDirtyNotice();
  installRenamePanel();
  syncDirtyUi();
})();
