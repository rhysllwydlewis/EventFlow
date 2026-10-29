/**
 * Tabs for an admin page that holds several lists, with the chosen tab kept in the address:
 *
 *   /admin-tickets?tab=external
 *
 * so a notification, an email or a bookmark can open a particular tab (the old pages that were
 * merged into tabs redirect to their tab this way).
 *
 *   const tabs = AdminTabs.mount({
 *     tabs: [
 *       { name: 'tickets', button: ticketsButton, panel: ticketsPanel },
 *       { name: 'external', button: externalButton, panel: externalPanel, onShow: loadExternal },
 *     ],
 *     activeClass: 'admin-tab--active',
 *     initial: 'tickets',
 *   });
 *   tabs.show('external');
 *
 * onShow(isFirstTime) runs each time a tab is shown, so a tab can load its list the first time
 * it is opened instead of every list loading when the page opens.
 */
(function (root) {
  'use strict';

  const PARAM = 'tab';

  /**
   * The tab name in an address, if it is one of the tabs.
   * @param {string} search - location.search
   * @param {string} hash - location.hash
   * @param {string[]} names - Tab names
   * @returns {string|null} A tab name, or null
   */
  function nameFromAddress(search, hash, names) {
    const fromQuery = new URLSearchParams(search || '').get(PARAM);
    if (fromQuery && names.includes(fromQuery)) {
      return fromQuery;
    }
    const fromHash = String(hash || '').replace(/^#/, '');
    return names.includes(fromHash) ? fromHash : null;
  }

  /**
   * The address with ?tab= set, every other part kept.
   * @param {string} href - Current address
   * @param {string} name - Tab to record
   * @returns {string} Path, query and hash for history.replaceState
   */
  function addressFor(href, name) {
    const url = new URL(href, 'http://localhost');
    url.searchParams.set(PARAM, name);
    return `${url.pathname}${url.search}${url.hash}`;
  }

  /**
   * Make a set of buttons and panels behave as tabs.
   * @param {Object} options
   * @param {Array<{name: string, button: Element, panel: Element, onShow?: function(boolean): void}>} options.tabs
   * @param {string} options.activeClass - Class put on the chosen button
   * @param {string} options.initial - Tab shown when the address does not choose one
   * @returns {{show: function(string, Object=): void, current: function(): string}} Controls
   */
  function mount(options) {
    const tabs = options.tabs.filter(tab => tab.button && tab.panel);
    const names = tabs.map(tab => tab.name);
    const shown = new Set();
    let current = null;

    function show(name, settings) {
      const chosen = tabs.find(tab => tab.name === name) || tabs[0];
      if (!chosen) {
        return;
      }
      current = chosen.name;
      tabs.forEach(tab => {
        const active = tab === chosen;
        tab.button.classList.toggle(options.activeClass, active);
        tab.button.setAttribute('aria-selected', String(active));
        tab.button.setAttribute('tabindex', active ? '0' : '-1');
        tab.panel.hidden = !active;
        tab.panel.style.display = active ? '' : 'none';
      });
      if (!settings || settings.updateAddress !== false) {
        try {
          root.history.replaceState(null, '', addressFor(root.location.href, chosen.name));
        } catch {
          // an address that cannot be changed only loses the bookmark; the tab still opens
        }
      }
      const first = !shown.has(chosen.name);
      shown.add(chosen.name);
      if (typeof chosen.onShow === 'function') {
        chosen.onShow(first);
      }
    }

    tabs.forEach((tab, index) => {
      tab.button.addEventListener('click', () => show(tab.name));
      tab.button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') {
          return;
        }
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + step + tabs.length) % tabs.length];
        show(next.name);
        next.button.focus();
      });
    });

    const fromAddress = nameFromAddress(root.location.search, root.location.hash, names);
    show(fromAddress || options.initial, { updateAddress: Boolean(fromAddress) });

    return { show, current: () => current };
  }

  const AdminTabs = { mount, nameFromAddress, addressFor };
  root.AdminTabs = AdminTabs;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdminTabs;
  }
})(typeof window !== 'undefined' ? window : globalThis);
