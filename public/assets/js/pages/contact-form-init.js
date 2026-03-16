document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contact-form');
  const status = document.getElementById('contact-status');
  const submitBtn = document.getElementById('contact-submit-btn');
  if (!form) {
    return;
  }

  // Handle async widget initialisation: show a loading placeholder until the
  // altcha-widget custom element is defined, then replace it with a live widget.
  const altchaContainer = document.getElementById('contact-altcha-container');
  let altchaReady = customElements.get('altcha-widget') !== undefined;

  // Payload captured via statechange event — avoids Shadow DOM querySelector issues
  let captchaPayload = null;

  function bindAltchaEvents(widget) {
    if (!widget) {
      return;
    }
    widget.addEventListener('statechange', e => {
      if (e.detail && e.detail.state === 'verified') {
        captchaPayload = e.detail.payload;
      } else {
        captchaPayload = null;
      }
    });
  }

  // Bind events on the initial widget if it is already available
  bindAltchaEvents(document.getElementById('contact-altcha-widget'));

  if (altchaContainer && !altchaReady) {
    altchaContainer.innerHTML =
      '<p class="small" style="color:#666;margin:0;">Loading verification\u2026</p>';

    const onAltchaLoaded = function () {
      altchaReady = true;
      altchaContainer.innerHTML = '';
      const widget = document.createElement('altcha-widget');
      widget.setAttribute('challengeurl', '/api/v1/altcha/challenge');
      widget.id = 'contact-altcha-widget';
      altchaContainer.appendChild(widget);
      bindAltchaEvents(widget);
    };

    document.addEventListener('altcha-loaded', onAltchaLoaded, { once: true });

    // Timeout fallback: if the widget never loads, allow submission without CAPTCHA
    setTimeout(() => {
      if (!altchaReady) {
        document.removeEventListener('altcha-loaded', onAltchaLoaded);
        altchaContainer.innerHTML =
          '<p class="small" style="color:#b45309;">\u26a0 Verification unavailable. You can still submit the form.</p>';
        const stuck = document.getElementById('contact-altcha-widget');
        if (stuck) {
          stuck.remove();
        }
      }
    }, 15000);
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const altchaWidget = document.getElementById('contact-altcha-widget');
    const captchaToken = captchaPayload || (altchaWidget && altchaWidget.value) || null;
    if (altchaWidget && !captchaToken) {
      if (status) {
        status.textContent = 'Please complete the CAPTCHA verification.';
        status.style.color = '#dc2626';
      }
      return;
    }
    const name = document.getElementById('contact-name').value.trim();
    const email = document.getElementById('contact-email').value.trim();
    const subject = document.getElementById('contact-subject').value.trim();
    const message = document.getElementById('contact-message').value.trim();
    if (!name || !email || !subject || !message) {
      if (status) {
        status.textContent = 'Please fill in all fields.';
        status.style.color = '#dc2626';
      }
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }
    if (status) {
      status.textContent = '';
      status.style.color = '';
    }
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (window.__CSRF_TOKEN__) {
        headers['x-csrf-token'] = window.__CSRF_TOKEN__;
      }
      const r = await fetch('/api/v1/contact', {
        method: 'POST',
        headers: headers,
        credentials: 'include',
        body: JSON.stringify({
          name: name,
          email: email,
          subject: subject,
          message: message,
          captchaToken: captchaToken,
        }),
      });
      if (r.ok) {
        if (status) {
          status.textContent = "Thank you! We'll be in touch soon.";
          status.style.color = '#0B8073';
        }
        form.reset();
      } else {
        let d = {};
        try {
          d = await r.json();
        } catch (_) {
          /* ignore */
        }
        if (status) {
          status.textContent = d.error || 'Something went wrong. Please try again.';
          status.style.color = '#dc2626';
        }
      }
    } catch (err) {
      if (status) {
        status.textContent = 'Something went wrong. Please try again.';
        status.style.color = '#dc2626';
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message';
      }
    }
  });
});
