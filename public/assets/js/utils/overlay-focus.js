/**
 * Keyboard focus for hand-built modal overlays (a <div role="dialog" aria-modal="true">, not a
 * native <dialog>, which does all of this itself).
 *
 * A native modal dialog keeps Tab inside it and hands focus back to the button that opened it.
 * An overlay built from a <div> does neither: Tab walks out into the page behind it and, when it
 * closes, focus is left on <body>, so a keyboard or screen-reader user starts again from the top
 * of the page. trap() fixes the first, release() the second.
 *
 *   EFOverlayFocus.trap(overlay, openerOptional);   // call once the overlay is showing
 *   EFOverlayFocus.release(overlay, fallbackOptional); // call as it closes
 *
 * Only controls that are on screen count as "first" and "last", so a collapsed section or a
 * hidden button never becomes the end of the loop.
 */
'use strict';

(function (global) {
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

  /** The controls inside `root` that can be tabbed to right now. */
  function visibleFocusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter(
      el => el.getClientRects().length > 0 && !el.closest('[hidden]')
    );
  }

  /**
   * Keeps Tab and Shift+Tab inside `overlay` and remembers where to send focus afterwards.
   * @param {HTMLElement} overlay - The overlay that is now showing
   * @param {Element} [opener] - What to focus on release; defaults to the element focused now
   */
  function trap(overlay, opener) {
    if (!overlay) {
      return;
    }
    if (!overlay._efFocusReturn || opener) {
      const current = document.activeElement;
      overlay._efFocusReturn =
        opener ||
        (current && current !== document.body && !overlay.contains(current) ? current : null);
    }
    if (overlay._efFocusTrap) {
      return;
    }
    // On the document, not the overlay: focus that has slipped outside (a click on the page behind,
    // or a widget that grabbed it) sends its keys to the page, never through the overlay.
    overlay._efFocusTrap = event => {
      if (event.key !== 'Tab' || !overlay.isConnected || overlay.getClientRects().length === 0) {
        return;
      }
      const items = visibleFocusables(overlay);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !overlay.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !overlay.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', overlay._efFocusTrap, true);
  }

  /**
   * Stops trapping and returns focus to the opener (or `fallback` when the opener has gone).
   * @param {HTMLElement} overlay - The overlay that is closing
   * @param {Element} [fallback] - Where to send focus when the opener is no longer on the page
   */
  function release(overlay, fallback) {
    if (!overlay) {
      return;
    }
    if (overlay._efFocusTrap) {
      document.removeEventListener('keydown', overlay._efFocusTrap, true);
      overlay._efFocusTrap = null;
    }
    const target = overlay._efFocusReturn;
    overlay._efFocusReturn = null;
    const wasInside =
      overlay.contains(document.activeElement) || document.activeElement === document.body;
    if (!wasInside) {
      return;
    }
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus();
    } else if (fallback?.isConnected && typeof fallback.focus === 'function') {
      fallback.focus();
    }
  }

  global.EFOverlayFocus = { trap, release, visibleFocusables };
})(typeof window !== 'undefined' ? window : globalThis);
