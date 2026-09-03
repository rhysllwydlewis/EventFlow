'use strict';
(function () {
  const STYLE_ID = 'ww-widget-svg-icons-styles';
  const OBSERVED_SELECTOR =
    '.ww-app-dialog,.ww-app-tabs,.ww-app-icon,.ww-launcher,.ww-launcher__orb,#ww-guest-search,.ww-actions--rsvp';
  let queued = false;

  const ICONS = {
    app: '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M12 20.5c4.14 0 7.5-3.02 7.5-6.75 0-2.16-1.13-4.09-2.9-5.32" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.4 8.43C5.63 9.66 4.5 11.59 4.5 13.75c0 3.73 3.36 6.75 7.5 6.75" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.8 6.2 12 3l3.2 3.2-1.25 2.55h-3.9L8.8 6.2Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.05 8.75 12 12l1.95-3.25" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    overview:
      '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="m12 3 1.35 4.1L17.5 8.5l-4.15 1.4L12 14l-1.35-4.1L6.5 8.5l4.15-1.4L12 3Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="m18 13 .75 2.25L21 16l-2.25.75L18 19l-.75-2.25L15 16l2.25-.75L18 13Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="m5.5 14 .55 1.45L7.5 16l-1.45.55L5.5 18l-.55-1.45L3.5 16l1.45-.55L5.5 14Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    workspace:
      '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4.5 19.5h15" stroke="currentColor" stroke-linecap="round"/><path d="m6.25 15.75.65-3.25 8.72-8.72a1.65 1.65 0 0 1 2.33 0l.27.27a1.65 1.65 0 0 1 0 2.33L9.5 15.1l-3.25.65Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="m14.5 4.9 4.6 4.6" stroke="currentColor" stroke-linecap="round"/></svg>',
    guests:
      '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M4.5 7.5h15v10h-15v-10Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="m5 8 7 5 7-5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 16.25s-2.25-1.25-2.25-2.7a1.33 1.33 0 0 1 2.25-.95 1.33 1.33 0 0 1 2.25.95c0 1.45-2.25 2.7-2.25 2.7Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    seating:
      '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M8 4.75h8a1.5 1.5 0 0 1 1.5 1.5v4.5h-11v-4.5A1.5 1.5 0 0 1 8 4.75Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.5 10.75h13l-1 4.5h-11l-1-4.5Z" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 15.25v4M16 15.25v4M7 19.25h2M15 19.25h2" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    share:
      '<svg viewBox="0 0 24 24" fill="none" focusable="false"><path d="M8.2 12.75 15.8 8.4M8.2 11.25l7.6 4.35" stroke="currentColor" stroke-linecap="round"/><circle cx="6.5" cy="12" r="2.35" stroke="currentColor"/><circle cx="17.5" cy="7.5" r="2.35" stroke="currentColor"/><circle cx="17.5" cy="16.5" r="2.35" stroke="currentColor"/></svg>',
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ww-svg-tab-icon,
      .ww-svg-app-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: currentColor;
        font-size: 0 !important;
        line-height: 0;
      }

      .ww-svg-tab-icon {
        width: 1rem;
        height: 1rem;
        flex: 0 0 1rem;
      }

      .ww-svg-tab-icon svg {
        width: 1rem;
        height: 1rem;
        stroke-width: 2.05;
      }

      .ww-app-tabs button[aria-selected='true'] .ww-svg-tab-icon,
      .ww-app-tabs button:hover .ww-svg-tab-icon {
        color: #0f766e;
      }

      .ww-svg-app-icon svg {
        width: 1.34rem;
        height: 1.34rem;
        stroke-width: 1.95;
      }

      .ww-app-icon.ww-svg-app-icon,
      .ww-launcher__orb.ww-svg-app-icon {
        color: #0f766e;
      }
    `;
    document.head.appendChild(style);
  }

  function isLikelyEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
  }

  function replaceIcon(el, svg, className) {
    if (!el || el.dataset.wwSvgIcon === 'true') {
      return;
    }

    el.dataset.wwSvgIcon = 'true';
    el.classList.add(className);
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = svg;
  }

  function replaceTabIcons(root) {
    root.querySelectorAll('.ww-app-tabs button[data-tab]').forEach(button => {
      const svg = ICONS[button.dataset.tab];
      if (!svg) {
        return;
      }

      const iconSlot = button.querySelector('span[aria-hidden="true"], span:first-child');
      replaceIcon(iconSlot, svg, 'ww-svg-tab-icon');
    });
  }

  function replaceAppIcons(root) {
    root.querySelectorAll('.ww-app-icon, .ww-launcher__orb').forEach(icon => {
      replaceIcon(icon, ICONS.app, 'ww-svg-app-icon');
    });
  }

  function hardenGuestSearch(root) {
    root.querySelectorAll('#ww-guest-search').forEach(input => {
      input.type = 'search';
      input.placeholder = 'Search guests';
      input.setAttribute('aria-label', 'Search guests');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('inputmode', 'search');
      input.setAttribute('name', 'ww-guest-search-query');

      if (isLikelyEmail(input.value) && !isLikelyEmail(input.defaultValue)) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  }

  function polishIcons(root = document) {
    injectStyles();
    replaceTabIcons(root);
    replaceAppIcons(root);
    hardenGuestSearch(root);
  }

  function schedule(root = document) {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      polishIcons(root);
      window.setTimeout(() => hardenGuestSearch(root), 250);
      window.setTimeout(() => hardenGuestSearch(root), 900);
    });
  }

  const observer = new MutationObserver(mutations => {
    if (
      mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(
          node =>
            node instanceof Element &&
            (node.matches(OBSERVED_SELECTOR) || node.querySelector?.(OBSERVED_SELECTOR))
        )
      )
    ) {
      schedule();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
