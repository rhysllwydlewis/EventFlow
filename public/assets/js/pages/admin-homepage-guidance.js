'use strict';
/**
 * On/off switches on the admin homepage manager (page guidance, hero quick links).
 * Each [data-homepage-toggle] block reads and saves its own setting through the
 * homepage manager API. The public homepage picks a change up on its next request.
 */
(() => {
  const API_BASE = '/api/v1/admin/homepage/manager/';

  const toast = (message, type) => {
    if (window.AdminShared && typeof window.AdminShared.showToast === 'function') {
      window.AdminShared.showToast(message, type);
    }
  };

  // AdminShared.api() sends the CSRF token it finds on window; make sure it is there.
  const ensureCsrfToken = async () => {
    if (window.__CSRF_TOKEN__) {
      return;
    }
    try {
      const response = await fetch('/api/v1/csrf-token', { credentials: 'include' });
      const data = await response.json();
      if (data?.csrfToken) {
        window.__CSRF_TOKEN__ = data.csrfToken;
      }
    } catch {
      // api() reports a readable error if the save then fails
    }
  };

  const api = (url, method, body) => window.AdminShared.api(url, method, body);

  const describe = state => {
    if (!state.updatedAt) {
      return 'On by default. It has not been changed yet.';
    }
    const when = new Date(state.updatedAt);
    const stamp = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const by = state.updatedBy ? ` by ${state.updatedBy}` : '';
    return `Last changed ${stamp}${by}.`.replace('changed .', 'changed.');
  };

  const setup = root => {
    const endpoint = API_BASE + root.dataset.homepageToggle;
    const toggle = root.querySelector('[data-toggle-input]');
    const label = root.querySelector('[data-toggle-label]');
    const meta = root.querySelector('[data-toggle-meta]');
    if (!toggle || !label || !meta) {
      return;
    }

    const labelFor = on => (on ? root.dataset.onLabel : root.dataset.offLabel);

    const render = state => {
      toggle.checked = state.enabled === true;
      label.textContent = labelFor(toggle.checked);
      meta.textContent = describe(state);
    };

    const load = async () => {
      try {
        const data = await api(endpoint, 'GET');
        render(data.toggle);
        toggle.disabled = false;
      } catch (error) {
        label.textContent = 'Could not load this setting';
        meta.textContent = error.message;
      }
    };

    toggle.addEventListener('change', async () => {
      const wanted = toggle.checked;
      toggle.disabled = true;
      meta.textContent = 'Saving...';
      try {
        await ensureCsrfToken();
        const data = await api(endpoint, 'PUT', { enabled: wanted });
        render(data.toggle);
        toast(wanted ? root.dataset.onToast : root.dataset.offToast, 'success');
      } catch (error) {
        toggle.checked = !wanted;
        label.textContent = labelFor(toggle.checked);
        meta.textContent = error.message;
        toast(error.message, 'error');
      } finally {
        toggle.disabled = false;
      }
    });

    load();
  };

  const roots = document.querySelectorAll('[data-homepage-toggle]');
  if (window.AdminShared && typeof window.AdminShared.api === 'function') {
    roots.forEach(setup);
  } else {
    roots.forEach(root => {
      const label = root.querySelector('[data-toggle-label]');
      const meta = root.querySelector('[data-toggle-meta]');
      if (label && meta) {
        label.textContent = 'Could not load this setting';
        meta.textContent = 'The admin tools did not load. Refresh the page.';
      }
    });
  }
})();
