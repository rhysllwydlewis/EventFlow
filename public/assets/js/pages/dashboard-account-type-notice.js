'use strict';

/**
 * Account type recovery notice (customer dashboard)
 *
 * Signing up as a customer when you meant supplier is the most common
 * registration mistake we get tickets for. The fix already exists in
 * Settings → Account Type; this just puts a link to it where the mistake is
 * actually noticed. Dismissed state is per-browser and deliberately sticky.
 */
(function () {
  const STORAGE_KEY = 'ef_account_type_notice_dismissed';

  const notice = document.getElementById('account-type-notice');
  const dismissBtn = document.getElementById('account-type-notice-dismiss');
  if (!notice) {
    return;
  }

  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Storage unavailable (private mode / blocked) — show the notice.
  }

  if (dismissed) {
    return;
  }

  notice.hidden = false;

  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      notice.hidden = true;
      try {
        window.localStorage.setItem(STORAGE_KEY, '1');
      } catch {
        // Nothing to persist to — the notice returns on the next visit.
      }
    });
  }
})();
