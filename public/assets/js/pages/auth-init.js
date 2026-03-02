/**
 * Auth Page — Tab switcher + enhancements
 *
 * Responsibilities:
 *   1. ARIA tab-list keyboard navigation (ArrowLeft / ArrowRight / Home / End)
 *   2. Dynamic heading text sync with active tab
 *   3. URL hash / query-param routing (?tab=create or #create on page load)
 *   4. Role-picker active-class management (auth-role-option--active)
 *
 * Form submission, password toggle, and password-strength meter are handled
 * by app.js (which already has all CSRF / hCaptcha / API logic).
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

      // Update active state and aria-checked
      rolePicker.querySelectorAll('.role-pill, .auth-role-option').forEach(b => {
        b.classList.remove('is-active', 'auth-role-option--active');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-active', 'auth-role-option--active');
      btn.setAttribute('aria-checked', 'true');
    });
  }
})();
