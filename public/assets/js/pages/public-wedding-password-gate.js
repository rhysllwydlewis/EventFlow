'use strict';
(function () {
  const originalFetch = window.fetch.bind(window);
  const weddingGetPattern = /^\/api\/public\/wedding-websites\/([^/]+)$/;

  function renderGate(slug) {
    const root = document.getElementById('public-wedding-root');
    if (!root) {
      return Promise.reject(new Error('Wedding page root not found'));
    }
    root.innerHTML = `
      <section class="wed-password-shell">
        <article class="wed-password-card" aria-labelledby="wed-password-title">
          <div class="wed-password-lock" aria-hidden="true">🔒</div>
          <p class="wed-kicker">Private wedding website</p>
          <h1 id="wed-password-title">Please enter the wedding password</h1>
          <p class="wed-password-copy">This couple has protected their wedding website. Enter the password from your invitation to view the details and RSVP.</p>
          <form id="wed-password-form" class="wed-password-form">
            <label>Password<input name="password" type="password" autocomplete="current-password" required autofocus></label>
            <button class="btn btn-primary" type="submit">Unlock website</button>
          </form>
          <p id="wed-password-message" class="msg" role="status" aria-live="polite"></p>
        </article>
      </section>`;

    const form = document.getElementById('wed-password-form');
    const msg = document.getElementById('wed-password-message');
    return new Promise(resolve => {
      form.addEventListener('submit', async event => {
        event.preventDefault();
        msg.textContent = '';
        msg.className = 'msg';
        const button = form.querySelector('button');
        button.disabled = true;
        button.textContent = 'Checking…';
        try {
          const payload = Object.fromEntries(new FormData(form).entries());
          const accessRes = await originalFetch(
            `/api/public/wedding-websites/${encodeURIComponent(slug)}/access`,
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          );
          const accessData = await accessRes.json().catch(() => ({}));
          if (!accessRes.ok) {
            msg.textContent = accessData.error || 'That password was not recognised.';
            msg.className = 'msg msg--error';
            return;
          }
          msg.textContent = 'Password accepted. Loading wedding details…';
          msg.className = 'msg msg--ok';
          const retry = await originalFetch(
            `/api/public/wedding-websites/${encodeURIComponent(slug)}`,
            {
              credentials: 'same-origin',
            }
          );
          resolve(retry);
        } catch (_err) {
          msg.textContent = 'Unable to check the password right now. Please try again.';
          msg.className = 'msg msg--error';
        } finally {
          button.disabled = false;
          button.textContent = 'Unlock website';
        }
      });
    });
  }

  window.fetch = async function patchedWeddingFetch(input, options) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = String(options?.method || 'GET').toUpperCase();
    const match = method === 'GET' ? url.match(weddingGetPattern) : null;
    if (!match) {
      return originalFetch(input, options);
    }
    const response = await originalFetch(input, { ...(options || {}), credentials: 'same-origin' });
    if (response.status !== 401) {
      return response;
    }
    const clone = response.clone();
    const data = await clone.json().catch(() => ({}));
    if (!data.passwordRequired) {
      return response;
    }
    return renderGate(decodeURIComponent(match[1]));
  };
})();
