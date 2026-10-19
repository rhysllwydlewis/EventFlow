'use strict';
/**
 * Homepage guidance switch on the admin homepage manager.
 * Reads and saves settings.homepageGuidance through the homepage manager API.
 * The public homepage picks the change up on its next request.
 */
(() => {
  const ENDPOINT = '/api/v1/admin/homepage/manager/guidance';
  const toggle = document.getElementById('homepageGuidanceToggle');
  const label = document.getElementById('homepageGuidanceLabel');
  const meta = document.getElementById('homepageGuidanceMeta');

  if (!toggle || !label || !meta) {
    return;
  }

  const toast = (message, type) => {
    if (window.AdminShared && typeof window.AdminShared.showToast === 'function') {
      window.AdminShared.showToast(message, type);
    }
  };

  const describe = guidance => {
    if (!guidance.updatedAt) {
      return 'On by default. It has not been changed yet.';
    }
    const when = new Date(guidance.updatedAt);
    const stamp = Number.isNaN(when.getTime())
      ? ''
      : when.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
    const by = guidance.updatedBy ? ` by ${guidance.updatedBy}` : '';
    return `Last changed ${stamp}${by}.`.replace('changed .', 'changed.');
  };

  const render = guidance => {
    toggle.checked = guidance.enabled === true;
    label.textContent = guidance.enabled ? 'Guidance is on' : 'Guidance is off';
    meta.textContent = describe(guidance);
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

  const load = async () => {
    try {
      const data = await api(ENDPOINT, 'GET');
      render(data.guidance);
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
      const data = await api(ENDPOINT, 'PUT', { enabled: wanted });
      render(data.guidance);
      toast(wanted ? 'Homepage guidance switched on' : 'Homepage guidance switched off', 'success');
    } catch (error) {
      toggle.checked = !wanted;
      label.textContent = toggle.checked ? 'Guidance is on' : 'Guidance is off';
      meta.textContent = error.message;
      toast(error.message, 'error');
    } finally {
      toggle.disabled = false;
    }
  });

  if (window.AdminShared && typeof window.AdminShared.api === 'function') {
    load();
  } else {
    label.textContent = 'Could not load this setting';
    meta.textContent = 'The admin tools did not load. Refresh the page.';
  }
})();
