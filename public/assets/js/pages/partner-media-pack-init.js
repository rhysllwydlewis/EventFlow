'use strict';
(function () {
  function initPartnerCopyButtons() {
    document.querySelectorAll('[data-copy-target]').forEach(button => {
      button.addEventListener('click', async () => {
        const target = document.getElementById(button.getAttribute('data-copy-target'));
        if (!target) {
          return;
        }

        const original = button.textContent;
        try {
          await navigator.clipboard.writeText(target.textContent.trim());
          button.textContent = 'Copied';
        } catch (_) {
          button.textContent = 'Select text above';
        }

        setTimeout(() => {
          button.textContent = original;
        }, 1800);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPartnerCopyButtons);
  } else {
    initPartnerCopyButtons();
  }
})();
