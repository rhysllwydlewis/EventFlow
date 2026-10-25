/**
 * Keyboard and screen-reader behaviour of the signed-in header on the dashboards, budget and guest
 * list (the bell, and the Dashboard link in the phone's bottom bar).
 *
 * 1. Counts in names. Both are controls with their own aria-label ("View notifications", "Go to
 *    dashboard"), and a control that has an aria-label is named by that label alone: the number
 *    drawn inside it, the unread count, is never read out. So a screen-reader user could not tell
 *    there was anything new, and a speech-control user saying "click 3" had nothing matching. The
 *    label is kept in step with the badge ("View notifications, 3 unread"), whichever script writes
 *    the badge.
 *
 * 2. The bell's dropdown. notifications.js opens it, but with the keyboard focus stays on the bell
 *    (the list is then reached only after the Account and Dashboard links), and pressing Escape
 *    from inside the list closes it and drops focus to <body>, so the next Tab starts again from the
 *    top of the page. Here a keyboard open moves focus into the list, and Escape from inside it
 *    gives focus back to the bell.
 *
 * 3. "Try again". Each failed card has one, and pressing it redraws the card, which deletes (or
 *    disables) the very button that had focus; focus falls to <body> and the next Tab starts again
 *    from the top of the page. After a keyboard "Try again", if focus has been lost, it goes to the
 *    card instead.
 */
'use strict';

(function () {
  const PAIRS = [
    { badge: 'ef-notification-badge', control: 'ef-notification-btn', label: 'View notifications' },
    {
      badge: 'ef-bottom-dashboard-badge',
      control: 'ef-bottom-dashboard',
      label: 'Go to dashboard',
    },
  ];
  const OPEN_CLASS = 'notification-dropdown--open';

  /** Puts the badge's count into the control's label (or the plain label when there is no count). */
  function syncLabel(pair) {
    const badge = document.getElementById(pair.badge);
    const control = document.getElementById(pair.control);
    if (!badge || !control) {
      return;
    }
    const text = (badge.textContent || '').trim();
    const shown = text !== '' && badge.style.display !== 'none' && !badge.hidden;
    const next = shown ? `${pair.label}, ${text} unread` : pair.label;
    if (control.getAttribute('aria-label') !== next) {
      control.setAttribute('aria-label', next);
    }
  }

  function watchBadges() {
    PAIRS.forEach(pair => {
      const badge = document.getElementById(pair.badge);
      if (!badge) {
        return;
      }
      syncLabel(pair);
      if (typeof MutationObserver === 'function') {
        new MutationObserver(() => syncLabel(pair)).observe(badge, {
          childList: true,
          characterData: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'hidden'],
        });
      }
    });
  }

  function watchBellDropdown() {
    const bell = document.getElementById('ef-notification-btn');
    const dropdown = document.getElementById('notification-dropdown');
    if (!bell || !dropdown) {
      return;
    }
    // A click with no pointer behind it (detail 0) is a keyboard Enter or Space.
    bell.addEventListener('click', event => {
      if (event.detail !== 0) {
        return;
      }
      window.setTimeout(() => {
        if (!dropdown.classList.contains(OPEN_CLASS)) {
          return;
        }
        const first = dropdown.querySelector('button, a[href]');
        if (first) {
          first.focus({ preventScroll: true });
        }
      }, 60);
    });
    // Capture phase, so focus is already on the bell when notifications.js hides the list.
    document.addEventListener(
      'keydown',
      event => {
        if (
          event.key === 'Escape' &&
          dropdown.classList.contains(OPEN_CLASS) &&
          dropdown.contains(document.activeElement)
        ) {
          bell.focus();
        }
      },
      true
    );
  }

  /** Is this button a "Try again" (or retry) button? */
  function isRetryButton(button) {
    return (
      button.matches(
        '[data-action="retry"], [data-retry-plans], [data-retry-steps], [data-retry-saved], [data-sdh-action^="retry"], [data-enquiries-action^="reload"]'
      ) || /^\s*(try again|retry)/i.test(button.textContent || '')
    );
  }

  function watchRetryButtons() {
    document.addEventListener('click', event => {
      const button = event.target?.closest?.('button') || null;
      // detail 0 is a keyboard press: a mouse user is not left without a place by this.
      if (!button || event.detail !== 0 || !isRetryButton(button)) {
        return;
      }
      // The nearest live region, alert, card or the page's <main>: whichever survives the redraw.
      const regions = [];
      for (let el = button.parentElement; el && el !== document.body; el = el.parentElement) {
        if (el.matches('[aria-live], [role="alert"], [aria-busy], section, main')) {
          regions.push(el);
        }
      }
      let checks = 0;
      const timer = window.setInterval(() => {
        checks += 1;
        const lost = !document.activeElement || document.activeElement === document.body;
        if (lost) {
          const region = regions.find(el => el.isConnected);
          if (region) {
            region.tabIndex = -1;
            region.focus({ preventScroll: true });
          }
          window.clearInterval(timer);
        } else if (checks >= 150 || document.activeElement !== button) {
          // Focus is somewhere real (moved on by the person), or nothing happened for 15 seconds.
          window.clearInterval(timer);
        }
      }, 100);
    });
  }

  function init() {
    watchBadges();
    watchBellDropdown();
    watchRetryButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
