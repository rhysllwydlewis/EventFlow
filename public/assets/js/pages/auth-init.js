'use strict';

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
  // ── Tab elements ──────────────────────────────────────────────
  const tabSign = document.getElementById('tab-signin');
  const tabCreate = document.getElementById('tab-create');
  const panelSign = document.getElementById('panel-signin');
  const panelCreate = document.getElementById('panel-create');

  function isDisabledTab(tab) {
    return !!(tab && (tab.disabled || tab.getAttribute('aria-disabled') === 'true'));
  }

  function activateTab(activeTab, activePanel, inactiveTab, inactivePanel, moveFocus) {
    if (isDisabledTab(activeTab)) {
      return;
    }

    activeTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('tabindex', '0');
    inactiveTab.setAttribute('aria-selected', 'false');
    inactiveTab.setAttribute('tabindex', '-1');
    activePanel.hidden = false;
    inactivePanel.hidden = true;

    if (moveFocus) {
      activeTab.focus();
    }

    window.dispatchEvent(
      new CustomEvent('eventflow:auth-tab-change', {
        detail: { tab: activeTab.id === 'tab-create' ? 'create' : 'signin' },
      })
    );

    // Sync page heading and subtitle with the active tab
    const heading = document.querySelector('.auth-heading');
    if (heading) {
      heading.textContent = activeTab.id === 'tab-create' ? 'Create your account' : 'Welcome back';
    }
    const subtitle = document.querySelector('.auth-subtitle');
    if (subtitle) {
      subtitle.textContent =
        activeTab.id === 'tab-create'
          ? 'Join thousands of event planners and suppliers on EventFlow — it\u2019s free.'
          : 'Sign in to your EventFlow account to continue planning.';
    }
  }

  if (tabSign && tabCreate && panelSign && panelCreate) {
    tabSign.addEventListener('click', () => {
      activateTab(tabSign, panelSign, tabCreate, panelCreate, false);
    });

    tabCreate.addEventListener('click', () => {
      if (isDisabledTab(tabCreate)) {
        return;
      }
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    });

    // Keyboard navigation: ArrowLeft / ArrowRight / Home / End
    [tabSign, tabCreate].forEach(tab => {
      tab.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (tab === tabSign && !isDisabledTab(tabCreate)) {
            activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
          } else {
            activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          if (!isDisabledTab(tabCreate)) {
            activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
          }
        }
      });
    });

    // Activate the correct tab based on URL hash / query-param (no focus steal on load).
    // `role=` / `action=register` are what the "For suppliers" and "claim this
    // listing" CTAs send — without them here those links opened the sign-in tab
    // with the supplier choice hidden inside the collapsed create panel.
    const initialParams = new URLSearchParams(window.location.search);
    const initialTab = initialParams.get('tab');
    const initialRole = initialParams.get('role');
    const wantsRegister =
      window.location.hash === '#create' ||
      initialTab === 'create' ||
      initialParams.get('action') === 'register' ||
      initialRole === 'supplier' ||
      initialRole === 'customer';
    if (wantsRegister) {
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    }
  }

  // ── Role-picker active class management ───────────────────────
  //
  // Nothing is pre-selected: a signup that reaches the server with the
  // wrong role is a support ticket, so the choice has to be made rather
  // than inherited from a default.
  const rolePicker = document.querySelector('.auth-role-picker');
  const roleInput = document.getElementById('reg-role');
  const supplierFields = document.getElementById('supplier-fields');
  const supplierCompanyInput = document.getElementById('reg-company');
  const roleError = document.getElementById('reg-role-error');
  const roleRecap = document.getElementById('reg-role-recap');
  const roleRecapName = document.getElementById('reg-role-recap-name');
  const roleRecapDesc = document.getElementById('reg-role-recap-desc');
  const registerSubmit = document.querySelector('#register-form .auth-submit');

  const ROLE_COPY = {
    customer: {
      name: 'Customer',
      recap: 'plan an event, shortlist and message suppliers.',
      submit: 'Create your Customer account',
    },
    supplier: {
      name: 'Supplier',
      recap: 'list your business and manage enquiries.',
      submit: 'Create your Supplier account',
    },
  };

  function setSubmitLabel(label) {
    if (!registerSubmit) {
      return;
    }
    // app.js restores this label after a failed submit.
    registerSubmit.dataset.defaultLabel = label;
    const labelEl = registerSubmit.querySelector('.auth-submit-text');
    if (labelEl) {
      labelEl.textContent = label;
    }
  }

  function selectRole(btn) {
    if (!btn || btn.dataset.disabled === 'true' || btn.getAttribute('aria-disabled') === 'true') {
      return;
    }

    const selectedRole = btn.getAttribute('data-role');
    const copy = ROLE_COPY[selectedRole];
    if (!copy) {
      return;
    }

    rolePicker.querySelectorAll('.auth-role-option').forEach(option => {
      const isSelected = option === btn;
      option.classList.toggle('is-active', isSelected);
      option.classList.toggle('auth-role-option--active', isSelected);
      option.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      option.tabIndex = isSelected ? 0 : -1;
    });

    rolePicker.classList.toggle('is-customer-selected', selectedRole === 'customer');
    rolePicker.classList.toggle('is-supplier-selected', selectedRole === 'supplier');
    rolePicker.classList.add('is-role-chosen');
    rolePicker.classList.remove('is-role-missing');

    if (roleError) {
      roleError.textContent = '';
    }

    if (roleInput) {
      roleInput.value = selectedRole;
    }

    if (supplierFields) {
      supplierFields.style.display = selectedRole === 'supplier' ? 'block' : 'none';
    }
    if (supplierCompanyInput) {
      supplierCompanyInput.required = selectedRole === 'supplier';
      supplierCompanyInput.setAttribute(
        'aria-required',
        selectedRole === 'supplier' ? 'true' : 'false'
      );
    }

    if (roleRecap) {
      roleRecap.hidden = false;
    }
    if (roleRecapName) {
      roleRecapName.textContent = copy.name;
    }
    if (roleRecapDesc) {
      roleRecapDesc.textContent = copy.recap;
    }
    setSubmitLabel(copy.submit);

    window.dispatchEvent(
      new CustomEvent('eventflow:auth-role-change', { detail: { role: selectedRole } })
    );
  }

  function clearRole() {
    if (!rolePicker) {
      return;
    }

    rolePicker.querySelectorAll('.auth-role-option').forEach((option, index) => {
      option.classList.remove('is-active', 'auth-role-option--active');
      option.setAttribute('aria-checked', 'false');
      option.tabIndex = index === 0 ? 0 : -1;
    });
    rolePicker.classList.remove(
      'is-customer-selected',
      'is-supplier-selected',
      'is-role-chosen',
      'is-role-missing'
    );

    if (roleInput) {
      roleInput.value = '';
    }
    if (supplierFields) {
      supplierFields.style.display = 'none';
    }
    if (supplierCompanyInput) {
      supplierCompanyInput.required = false;
      supplierCompanyInput.setAttribute('aria-required', 'false');
    }
    if (roleRecap) {
      roleRecap.hidden = true;
    }
    setSubmitLabel('Create account');

    window.dispatchEvent(new CustomEvent('eventflow:auth-role-change', { detail: { role: '' } }));
  }

  function focusRolePicker() {
    const firstOption = rolePicker ? rolePicker.querySelector('.auth-role-option') : null;
    if (firstOption) {
      firstOption.focus();
      firstOption.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // Exposed so app.js can flag a submit attempted with no account type chosen.
  window.EventFlowAuthRole = {
    flagMissing(message) {
      if (rolePicker) {
        rolePicker.classList.add('is-role-missing');
      }
      if (roleError) {
        roleError.textContent = message;
      }
      focusRolePicker();
    },
  };

  if (rolePicker) {
    rolePicker.querySelectorAll('.auth-role-option').forEach(option => {
      option.tabIndex = option.getAttribute('aria-checked') === 'true' ? 0 : -1;
    });

    // With nothing selected the roving tabindex would leave the whole
    // radiogroup unreachable — keep the first option focusable.
    if (!rolePicker.querySelector('[aria-checked="true"]')) {
      const firstOption = rolePicker.querySelector('.auth-role-option');
      if (firstOption) {
        firstOption.tabIndex = 0;
      }
    }

    rolePicker.addEventListener('click', e => {
      selectRole(e.target.closest('.auth-role-option'));
    });

    rolePicker.addEventListener('keydown', e => {
      const current = e.target.closest('.auth-role-option');
      if (!current) {
        return;
      }
      const options = [...rolePicker.querySelectorAll('.auth-role-option')].filter(
        option =>
          option.dataset.disabled !== 'true' && option.getAttribute('aria-disabled') !== 'true'
      );
      const currentIndex = options.indexOf(current);
      if (currentIndex === -1) {
        return;
      }

      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % options.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + options.length) % options.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = options.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      const next = options[nextIndex];
      selectRole(next);
      next.focus();
    });
  }

  const roleRecapChange = document.getElementById('reg-role-recap-change');
  if (roleRecapChange) {
    roleRecapChange.addEventListener('click', () => {
      clearRole();
      focusRolePicker();
    });
  }

  // ── Profile picture: theme-styled file control ────────────────
  // The native input is visually hidden behind its <label>, so the chosen
  // filename has to be echoed back or the control looks like it did nothing.
  const avatarInput = document.getElementById('reg-avatar');
  const avatarName = document.getElementById('reg-avatar-name');
  if (avatarInput && avatarName) {
    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files && avatarInput.files[0];
      avatarName.textContent = file ? file.name : 'No image selected';
      avatarName.classList.toggle('has-file', !!file);
    });
  }

  // Deep-link support for /auth?tab=create&role=supplier&claimSupplierId=...,
  // used by the "claim this listing" link on unclaimed Supplier Bot
  // profile/package pages so a visiting business owner lands straight on the
  // supplier sign-up form, and so registration submits an explicit claim for
  // the exact listing they viewed rather than relying only on an email/website
  // match after the fact.
  if (rolePicker) {
    const requestedRole = new URLSearchParams(window.location.search).get('role');
    if (requestedRole === 'supplier' || requestedRole === 'customer') {
      const requestedRoleBtn = rolePicker.querySelector(`[data-role="${requestedRole}"]`);
      if (requestedRoleBtn) {
        selectRole(requestedRoleBtn);
      }
    }
  }

  const claimSupplierIdInput = document.getElementById('reg-claim-supplier-id');
  if (claimSupplierIdInput) {
    const claimSupplierId = new URLSearchParams(window.location.search).get('claimSupplierId');
    if (claimSupplierId) {
      claimSupplierIdInput.value = claimSupplierId.slice(0, 64);
    }
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
          // A deep link (?role=supplier, e.g. from the "claim this listing" banner)
          // pre-selects this button before the flag check above completes. If
          // applications just closed, clear the choice rather than quietly
          // switching them to customer — landing in the wrong account type
          // without noticing is the exact failure this picker guards against.
          if (supplierBtn.classList.contains('is-active')) {
            clearRole();
          }
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
          window.location.hash === '#create' ||
          new URLSearchParams(window.location.search).get('tab') === 'create';

        if (tabSign && panelSign && tabCreate && panelCreate) {
          if (isOnCreateTab) {
            activateTab(tabSign, panelSign, tabCreate, panelCreate, false);
          }
        }

        const registrationDisabledMessage =
          'New account registrations are temporarily unavailable. Please check back later.';
        const sharedStatus = document.getElementById('auth-status');
        if (sharedStatus) {
          sharedStatus.className = 'auth-status auth-status--warning is-visible';
          sharedStatus.textContent = registrationDisabledMessage;
        }

        // Insert a visible banner at the top of the create panel too, in case the tab
        // is re-enabled by an operator without a page refresh.
        if (panelCreate && !document.getElementById('reg-disabled-banner')) {
          const banner = document.createElement('p');
          banner.id = 'reg-disabled-banner';
          banner.className = 'auth-status auth-status--warning is-visible';
          banner.setAttribute('role', 'status');
          banner.setAttribute('aria-live', 'polite');
          banner.textContent = registrationDisabledMessage;
          panelCreate.insertAdjacentElement('afterbegin', banner);
        }
      }
    } catch {
      // Network error — silently leave the UI in its default (enabled) state
    }
  })();
})();
