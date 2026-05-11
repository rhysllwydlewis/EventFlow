(function () {
  'use strict';

  const rootSelector = '#wedding-website-dashboard-root';

  function esc(value) {
    return String(value || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  function injectControls(root) {
    const form = root.querySelector('#ww-builder');
    if (!form || form.querySelector('.ww-password-privacy-panel')) {
      return;
    }

    const preview = root.querySelector("a[href^='/wedding/']");
    const slug = preview ? preview.getAttribute('href').split('/').filter(Boolean).pop() : '';
    const privacyPanel = document.createElement('details');
    privacyPanel.className = 'ww-password-privacy-panel';
    privacyPanel.open = true;
    privacyPanel.innerHTML = `
      <summary>Privacy & password protection</summary>
      <div class="ww-privacy-card">
        <p class="small">Choose how guests access your wedding website. Password protected pages require guests to enter the password before viewing details or submitting an RSVP.</p>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="private_link"> <span><strong>Anyone with link</strong><small>Unlisted guest link. Search engines remain discouraged.</small></span></label>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="public"> <span><strong>Public</strong><small>Accessible to anyone who visits the link.</small></span></label>
        <label class="ww-radio-row"><input type="radio" name="visibility" value="password"> <span><strong>Password protected</strong><small>Guests must enter the password before the page or RSVP form loads.</small></span></label>
        <div class="ww-password-fields" hidden>
          <label>Website password<input type="password" name="password" autocomplete="new-password" minlength="6" placeholder="Set or change password"></label>
          <p class="small ww-password-help">Existing passwords are never displayed. Leave this blank to keep the current password; enter a new value to change it. Minimum 6 characters.</p>
        </div>
        <p class="small ww-password-state" data-slug="${esc(slug)}">Password protection is available for published sites and previews.</p>
      </div>`;
    form.prepend(privacyPanel);

    const refreshState = async () => {
      try {
        const match = location.href.match(/dashboard/);
        if (!match) return;
        const planId = preview?.href ? null : null;
        // The main dashboard save payload owns persistence. This panel only needs a sensible default.
      } catch (_err) {
        // Non-blocking enhancement.
      }
    };

    const visibilityInputs = Array.from(form.querySelectorAll("input[name='visibility']"));
    const passwordFields = form.querySelector('.ww-password-fields');
    const updateVisibilityUi = () => {
      const selected = form.querySelector("input[name='visibility']:checked")?.value || 'private_link';
      passwordFields.hidden = selected !== 'password';
      const passwordInput = form.querySelector("input[name='password']");
      if (passwordInput) {
        passwordInput.required = selected === 'password' && !form.dataset.passwordSet;
      }
    };
    visibilityInputs.forEach(input => input.addEventListener('change', updateVisibilityUi));
    const defaultVisibility = form.querySelector("input[name='visibility'][value='private_link']");
    if (defaultVisibility) {
      defaultVisibility.checked = true;
    }
    updateVisibilityUi();
    refreshState();
  }

  document.addEventListener(
    'click',
    event => {
      const saveButton = event.target.closest('#ww-save');
      if (!saveButton) {
        return;
      }
      const root = document.querySelector(rootSelector);
      const form = root?.querySelector('#ww-builder');
      if (!form) {
        return;
      }
      const visibility = form.querySelector("input[name='visibility']:checked")?.value;
      const passwordInput = form.querySelector("input[name='password']");
      if (visibility === 'password' && passwordInput && passwordInput.required && !passwordInput.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        passwordInput.focus();
        passwordInput.setCustomValidity('Please set a password before enabling password protection.');
        passwordInput.reportValidity();
        setTimeout(() => passwordInput.setCustomValidity(''), 800);
      }
    },
    true
  );

  const observer = new MutationObserver(() => {
    const root = document.querySelector(rootSelector);
    if (root) {
      injectControls(root);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.querySelector(rootSelector);
      if (root) injectControls(root);
    });
  } else {
    const root = document.querySelector(rootSelector);
    if (root) injectControls(root);
  }
})();
