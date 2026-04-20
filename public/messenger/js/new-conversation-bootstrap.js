/**
 * Messenger bootstrap: open contact picker via [data-action="new-conversation"] hooks.
 *
 * Extracted from an inline <script> block in /messenger/index.html to comply
 * with the site-wide CSP (script-src-elem 'self'). Any element (e.g. a sidebar
 * quick-action button) that carries data-action="new-conversation" will
 * dispatch a global messenger:open-contact-picker event when activated.
 */

'use strict';

(function () {
  function handleClick(e) {
    const target =
      e.target && typeof e.target.closest === 'function'
        ? e.target.closest('[data-action="new-conversation"]')
        : null;
    if (target) {
      window.dispatchEvent(new CustomEvent('messenger:open-contact-picker'));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      document.addEventListener('click', handleClick);
    });
  } else {
    document.addEventListener('click', handleClick);
  }
})();
