(function () {
  const regContainer = document.getElementById('reg-altcha-container');
  if (!regContainer) {
    return;
  }

  let altchaReady = customElements.get('altcha-widget') !== undefined;

  /**
   * Read the current payload from a widget that may already be in verified state.
   * Falls back through shadow DOM hidden input → .value property.
   * @param {HTMLElement} widget
   * @returns {string|null}
   */
  function readWidgetPayload(widget) {
    if (!widget) {
      return null;
    }
    try {
      if (widget.shadowRoot) {
        const shadowInput = widget.shadowRoot.querySelector('input[name="altcha"]');
        if (shadowInput && shadowInput.value) {
          return shadowInput.value;
        }
      }
    } catch (_) {
      // Shadow DOM may not be accessible in all environments
    }
    return widget.value || null;
  }

  function bindAltchaEvents(widget) {
    if (!widget) {
      return;
    }
    widget.addEventListener('statechange', e => {
      if (e.detail && e.detail.state === 'verified') {
        window.__altchaRegPayload = e.detail.payload || readWidgetPayload(widget);
      } else {
        window.__altchaRegPayload = null;
      }
    });

    // If the widget solved the challenge before this listener was attached
    // (e.g. loaded from cache), capture the current payload immediately.
    const existingPayload = readWidgetPayload(widget);
    if (existingPayload) {
      window.__altchaRegPayload = existingPayload;
    }
  }

  // If the custom element is already registered the initial widget is live
  if (altchaReady) {
    bindAltchaEvents(document.getElementById('reg-altcha-widget'));
    return;
  }

  regContainer.innerHTML =
    '<p class="small" style="color:#666;margin:0;">Loading verification\u2026</p>';

  function onAltchaLoaded() {
    altchaReady = true;
    regContainer.innerHTML = '';
    const widget = document.createElement('altcha-widget');
    widget.setAttribute('challengeurl', '/api/v1/altcha/challenge');
    widget.id = 'reg-altcha-widget';
    regContainer.appendChild(widget);
    bindAltchaEvents(widget);
  }

  document.addEventListener('altcha-loaded', onAltchaLoaded, { once: true });

  // Timeout fallback: if the widget fails to load (e.g. network error), block
  // registration with a clear message. The backend requires ALTCHA verification
  // in production, so bypassing it here would always result in a 400 error.
  setTimeout(() => {
    if (!altchaReady) {
      document.removeEventListener('altcha-loaded', onAltchaLoaded);
      window.__altchaUnavailable = true;
      regContainer.innerHTML =
        '<p class="small" style="color:#b45309;">\u26a0 Verification failed to load. Please refresh the page or disable any content blockers and try again.</p>';
      const stuck = document.getElementById('reg-altcha-widget');
      if (stuck) {
        stuck.remove();
      }
    }
  }, 15000);
})();
