/**
 * Supplier dashboard: on a phone, the secondary cards fold up.
 *
 * Under 768px the page is one long column. The cards a supplier looks at least often (the visits
 * chart, availability, the calendar, tips, the plan and support) keep their heading and put their
 * content in a real <details> ("Show plan"), closed to begin with. From 768px up the content goes
 * back where it was and nothing is folded. Only the markup around a card's body changes: every id
 * inside it, and every script that fills it, is untouched.
 */
'use strict';

(function () {
  const CARDS = [
    'sdh-performance',
    'sdh-availability',
    'availability-calendar',
    'sdh-tips',
    'sdh-plan',
    'sdh-support',
  ];

  /** The card's heading as a lower-case phrase for the button: "plan", "calendar". */
  function nameOf(card) {
    const heading = card.querySelector('.sdh-card__title');
    return heading ? heading.textContent.replace(/\s+/g, ' ').trim().toLowerCase() : 'this card';
  }

  /** Redraws the label for the current state of a fold: Show plan, or Hide plan. */
  function label(details) {
    const summary = details.querySelector('summary');
    if (summary) {
      summary.textContent = `${details.open ? 'Hide' : 'Show'} ${details.dataset.foldName}`;
    }
  }

  /** The calendar was drawn while hidden: tell it the room it has now. */
  function resizeCalendar() {
    const container = document.getElementById('supplier-events-calendar');
    if (container?._calendarInstance?.updateSize) {
      container._calendarInstance.updateSize();
    }
  }

  /** Puts a card's body inside a closed <details>. */
  function fold(card) {
    const body = card.querySelector(':scope > .sdh-card__body');
    if (!body || card.querySelector(':scope > details.sdh-fold')) {
      return;
    }
    const details = document.createElement('details');
    details.className = 'sdh-fold';
    details.dataset.foldName = nameOf(card);
    const summary = document.createElement('summary');
    summary.className = 'sdh-more__summary sdh-fold__summary';
    details.appendChild(summary);
    card.insertBefore(details, body);
    details.appendChild(body);
    label(details);
    details.addEventListener('toggle', () => {
      label(details);
      if (details.open && card.id === 'availability-calendar') {
        resizeCalendar();
      }
    });
  }

  /** Takes a card's body back out of its <details>. */
  function unfold(card) {
    const details = card.querySelector(':scope > details.sdh-fold');
    if (!details) {
      return;
    }
    const body = details.querySelector(':scope > .sdh-card__body');
    if (body) {
      card.insertBefore(body, details);
    }
    details.remove();
    resizeCalendar();
  }

  /** Folds or unfolds every card for the current screen width. */
  function apply(narrow) {
    CARDS.forEach(id => {
      const card = document.getElementById(id);
      if (card) {
        if (narrow) {
          fold(card);
        } else {
          unfold(card);
        }
      }
    });
  }

  /** Starts watching the screen width. */
  function init() {
    if (!window.matchMedia) {
      return;
    }
    const query = window.matchMedia('(max-width: 767px)');
    apply(query.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', event => apply(event.matches));
    }
  }

  window.SupplierDashboardFold = { apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
