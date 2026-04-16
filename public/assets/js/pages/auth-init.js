/**
 * Auth Page — Tab switcher + enhancements
 *
 * Responsibilities:
 *   1. ARIA tab-list keyboard navigation (ArrowLeft / ArrowRight / Home / End)
 *   2. Dynamic heading text sync with active tab
 *   3. URL hash / query-param routing (?tab=create or #create on page load)
 *   4. Role-picker active-class management (auth-role-option--active)
 *   5. Feature-flag pre-checks: hide Supplier option / disable registration tab
 *      when the corresponding flag is off, giving users a clear message before
 *      they attempt to submit.
 *
 * Form submission, password toggle, and password-strength meter are handled
 * by app.js (which already has all CSRF / ALTCHA / API logic).
 */
(function () {
  'use strict';

  // ── Tab elements ──────────────────────────────────────────────
  const tabSign = document.getElementById('tab-signin');
  const tabCreate = document.getElementById('tab-create');
  const panelSign = document.getElementById('panel-signin');
  const panelCreate = document.getElementById('panel-create');

  function activateTab(activeTab, activePanel, inactiveTab, inactivePanel, moveFocus) {
    activeTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('tabindex', '0');
    inactiveTab.setAttribute('aria-selected', 'false');
    inactiveTab.setAttribute('tabindex', '-1');
    activePanel.hidden = false;
    inactivePanel.hidden = true;

    if (moveFocus) {
      activeTab.focus();
    }

    // Sync page heading with the active tab
    const heading = document.querySelector('.auth-heading');
    if (heading) {
      heading.textContent = activeTab.id === 'tab-create' ? 'Create your account' : 'Welcome back';
    }
  }

  if (tabSign && tabCreate && panelSign && panelCreate) {
    tabSign.addEventListener('click', () => {
      activateTab(tabSign, panelSign, tabCreate, panelCreate, false);
    });

    tabCreate.addEventListener('click', () => {
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    });

    // Keyboard navigation: ArrowLeft / ArrowRight / Home / End
    [tabSign, tabCreate].forEach(tab => {
      tab.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (tab === tabSign) {
            activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
          } else {
            activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
        }
      });
    });

    // Activate the correct tab based on URL hash / query-param (no focus steal on load)
    if (window.location.hash === '#create' || window.location.search.includes('tab=create')) {
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    }
  }

  // ── Role-picker active class management ───────────────────────
  // Works for both `.role-pill` (legacy) and `.auth-role-option` (new)
  const rolePicker = document.querySelector('.auth-role-picker, .role-toggle');
  if (rolePicker) {
    rolePicker.addEventListener('click', e => {
      const btn = e.target.closest('.role-pill, .auth-role-option');
      if (!btn) {
        return;
      }

      // Ignore clicks on a disabled supplier option
      if (btn.dataset.role === 'supplier' && btn.dataset.disabled === 'true') {
        return;
      }

      // Update active state and aria-checked
      rolePicker.querySelectorAll('.role-pill, .auth-role-option').forEach(b => {
        b.classList.remove('is-active', 'auth-role-option--active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active', 'auth-role-option--active');
      btn.setAttribute('aria-checked', 'true');
    });
  }

  // ── Feature-flag pre-checks ────────────────────────────────────
  // Fetch the public feature flags once on page load, then adjust the UI
  // so users get clear feedback before attempting to submit forms.
  (async function applyFeatureFlags() {
    try {
      const resp = await fetch('/api/v1/public/features', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        return; // Silently skip — default (enabled) state is safe
      }
      const flags = await resp.json();

      // ── supplier applications disabled ──────────────────────
      if (flags.supplierApplications === false) {
        const supplierBtn = rolePicker ? rolePicker.querySelector('[data-role="supplier"]') : null;
        if (supplierBtn) {
          supplierBtn.disabled = true;
          supplierBtn.dataset.disabled = 'true';
          supplierBtn.setAttribute('aria-disabled', 'true');
          supplierBtn.title = 'Supplier applications are currently closed';
          // Add a small visual note beneath the button
          const note = document.createElement('span');
          note.className = 'auth-role-disabled-note';
          note.textContent = 'Applications closed';
          note.setAttribute('aria-hidden', 'true');
          supplierBtn.appendChild(note);
        }
      }

      // ── registration entirely disabled ──────────────────────
      if (flags.registration === false) {
        // Store flag for app.js to pick up on submit
        window.__registrationDisabled = true;

        if (tabCreate) {
          tabCreate.disabled = true;
          tabCreate.setAttribute('aria-disabled', 'true');
          tabCreate.title = 'New registrations are temporarily unavailable';
        }

        // If the user is already on the create tab, show a banner and switch
        // them to sign-in so the disabled form isn't the landing state.
        const isOnCreateTab =
          window.location.hash === '#create' || window.location.search.includes('tab=create');

        if (tabSign && panelSign && tabCreate && panelCreate) {
          if (isOnCreateTab) {
            activateTab(tabSign, panelSign, tabCreate, panelCreate, false);
          }
        }

        // Insert a visible banner at the top of the create panel
        if (panelCreate) {
          const banner = document.createElement('p');
          banner.id = 'reg-disabled-banner';
          banner.className = 'auth-status auth-status--warning';
          banner.setAttribute('role', 'status');
          banner.setAttribute('aria-live', 'polite');
          banner.textContent =
            'New account registrations are temporarily unavailable. Please check back later.';
          panelCreate.insertAdjacentElement('afterbegin', banner);
        }
      }
    } catch (_) {
      // Network error — silently leave the UI in its default (enabled) state
    }
  })();
})();
