(function () {
  const regContainer = document.getElementById('reg-altcha-container');
  if (!regContainer) {
    return;
  }

  let altchaReady = customElements.get('altcha-widget') !== undefined;

  function bindAltchaEvents(widget) {
    if (!widget) {
      return;
    }
    widget.addEventListener('statechange', e => {
      if (e.detail && e.detail.state === 'verified') {
        window.__altchaRegPayload = e.detail.payload;
      } else {
        window.__altchaRegPayload = null;
      }
    });
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

  // Timeout fallback: if widget never loads allow registration without CAPTCHA
  setTimeout(() => {
    if (!altchaReady) {
      document.removeEventListener('altcha-loaded', onAltchaLoaded);
      regContainer.innerHTML =
        '<p class="small" style="color:#b45309;">\u26a0 Verification unavailable. You can still create an account.</p>';
      const stuck = document.getElementById('reg-altcha-widget');
      if (stuck) {
        stuck.remove();
      }
    }
  }, 15000);
})();
