(function () {
  const MODAL_SELECTOR = 'dialog.ww-modal';
  const FORM_SELECTOR = '.ww-modal__form';

  function closeModal(dlg) {
    if (!dlg || !dlg.matches(MODAL_SELECTOR)) {
      return;
    }
    try {
      dlg.close('cancel');
    } catch (_) {
      /* Dialog may already be closed */
    }
    dlg.remove();
  }

  document.addEventListener(
    'click',
    event => {
      const cancelButton = event.target.closest(
        `${MODAL_SELECTOR} button[value='cancel'], ${MODAL_SELECTOR} .ww-modal-cancel`
      );
      if (!cancelButton) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeModal(cancelButton.closest(MODAL_SELECTOR));
    },
    true
  );

  document.addEventListener('cancel', event => {
    const dlg = event.target;
    if (!dlg?.matches?.(MODAL_SELECTOR)) {
      return;
    }
    event.preventDefault();
    closeModal(dlg);
  });

  const observer = new MutationObserver(records => {
    records.forEach(record => {
      record.addedNodes.forEach(node => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        const modals = node.matches?.(MODAL_SELECTOR)
          ? [node]
          : Array.from(node.querySelectorAll?.(MODAL_SELECTOR) || []);
        modals.forEach(dlg => {
          const form = dlg.querySelector(FORM_SELECTOR);
          const cancelButton = form?.querySelector("button[value='cancel']");
          if (cancelButton) {
            cancelButton.type = 'button';
            cancelButton.classList.add('cta', 'secondary', 'ww-modal-cancel');
            cancelButton.setAttribute('formnovalidate', 'formnovalidate');
          }
          const saveButton = form?.querySelector(
            "button[id^='ww-'], button[id^='save-'], button.cta:not(.secondary)"
          );
          if (saveButton) {
            saveButton.classList.add('ww-modal-save');
          }
        });
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
