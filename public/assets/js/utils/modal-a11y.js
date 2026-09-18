/**
 * Shared accessibility behaviour for the hand-rolled `.modal-overlay` dialogs
 * that build their own markup (compare/budget/timeline pages) instead of
 * going through the `Modal` class in components.js. Adds the role/aria
 * wiring, a Tab focus trap, Escape-to-close and focus restore those dialogs
 * were missing, without requiring any change to how they're closed.
 *
 * Usage: call `enhance(overlayElement, { labelledBy })` once, right after
 * the overlay is appended to `document.body`. Every existing way the caller
 * already closes the modal (`.remove()`, backdrop click, form submit,
 * `parentNode.removeChild`) is picked up automatically because they all
 * detach the overlay from `document.body`.
 */
(function (global) {
  'use strict';

  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function enhance(overlay, options = {}) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (options.labelledBy) {
      overlay.setAttribute('aria-labelledby', options.labelledBy);
    }

    const previouslyFocused = document.activeElement;
    const initialFocusable = overlay.querySelectorAll(FOCUSABLE_SELECTOR);
    if (initialFocusable.length > 0) {
      initialFocusable[0].focus();
    }

    function handleKeydown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        overlay.remove();
        return;
      }
      if (e.key !== 'Tab') {
        return;
      }
      const elements = overlay.querySelectorAll(FOCUSABLE_SELECTOR);
      if (elements.length === 0) {
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeydown, true);

    const observer = new MutationObserver(() => {
      if (overlay.isConnected) {
        return;
      }
      observer.disconnect();
      document.removeEventListener('keydown', handleKeydown, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  global.EFModalA11y = { enhance };
})(typeof window !== 'undefined' ? window : globalThis);
