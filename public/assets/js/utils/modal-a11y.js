/**
 * Shared accessibility behaviour for the hand-rolled `.modal-overlay` dialogs
 * that build their own markup (compare/budget/timeline pages) instead of
 * going through the `Modal` class in components.js. Adds the role/aria
 * wiring, a Tab focus trap, Escape-to-close and focus restore those dialogs
 * were missing, without requiring any change to how they're closed.
 *
 * Usage: call `enhance(overlayElement, { labelledBy })` once, right after
 * the overlay is appended to `document.body`. Options:
 *   labelledBy    id of the element that labels the dialog
 *   lockScroll    stop the page behind the dialog scrolling while it is open
 *   onEscape      called instead of removing the overlay outright, for dialogs
 *                 that animate or otherwise manage their own closing
 *   restoreFocus  returns the element to focus on close, for dialogs whose
 *                 trigger is replaced while they are open (e.g. a save that
 *                 rerenders the section holding the edit button); the
 *                 original trigger is used when this returns nothing
 *
 * Every existing way the caller already closes the modal (`.remove()`,
 * backdrop click, form submit, `parentNode.removeChild`) is picked up
 * automatically because they all detach the overlay from `document.body`.
 *
 * Keyboard handling is skipped while this dialog is not the topmost one: a
 * later-enhanced overlay takes precedence, and so does any other
 * `[role="dialog"]` / `[aria-modal="true"]` element that became visible after
 * this one opened (such as the keyboard shortcuts help), which is then left
 * to handle its own keys. Dialogs already open beforehand are ignored.
 */
'use strict';

(function (global) {
  const FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /** Overlays currently enhanced, oldest first. */
  const active = [];

  function openDialogs() {
    return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]')).filter(
      el =>
        el.getAttribute('aria-hidden') !== 'true' && global.getComputedStyle(el).display !== 'none'
    );
  }

  /**
   * Whether a dialog other than `overlay` should receive the keyboard first:
   * a later-enhanced overlay, or a non-enhanced dialog that became visible
   * after `overlay` opened. Dialogs already open beforehand (a cookie banner,
   * say) sit beneath it and are ignored.
   * @param {HTMLElement} overlay The enhanced overlay asking.
   * @param {Set<Element>} openBefore Dialogs that were open when it opened.
   * @returns {boolean} True when another dialog is above it.
   */
  function isCoveredByAnotherDialog(overlay, openBefore) {
    if (active[active.length - 1] !== overlay) {
      return true;
    }
    return openDialogs().some(
      el =>
        !openBefore.has(el) &&
        !active.includes(el) &&
        !overlay.contains(el) &&
        !el.contains(overlay)
    );
  }

  function enhance(overlay, options = {}) {
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (options.labelledBy) {
      overlay.setAttribute('aria-labelledby', options.labelledBy);
    }

    const previouslyFocused = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    if (options.lockScroll) {
      document.body.style.overflow = 'hidden';
    }
    const openBefore = new Set(openDialogs());
    active.push(overlay);

    const initialFocusable = overlay.querySelectorAll(FOCUSABLE_SELECTOR);
    if (initialFocusable.length > 0) {
      initialFocusable[0].focus();
    }

    function handleKeydown(e) {
      if (e.key !== 'Escape' && e.key !== 'Tab') {
        return;
      }
      if (isCoveredByAnotherDialog(overlay, openBefore)) {
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (typeof options.onEscape === 'function') {
          options.onEscape();
        } else {
          overlay.remove();
        }
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
      const index = active.indexOf(overlay);
      if (index !== -1) {
        active.splice(index, 1);
      }
      if (options.lockScroll) {
        document.body.style.overflow = previousBodyOverflow;
      }
      const replacement =
        typeof options.restoreFocus === 'function' ? options.restoreFocus() : null;
      const target = replacement && replacement.isConnected ? replacement : previouslyFocused;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    });
    observer.observe(document.body, { childList: true });
  }

  global.EFModalA11y = { enhance };
})(typeof window !== 'undefined' ? window : globalThis);
