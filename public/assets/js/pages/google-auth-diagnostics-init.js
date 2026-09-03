'use strict';
(function () {
  const EXPECTED_ORIGIN = 'https://event-flow.co.uk';
  const EXPECTED_LOGIN_URI = 'https://event-flow.co.uk/api/auth/callback/google';
  const results = document.getElementById('results');
  const raw = document.getElementById('raw');
  const refresh = document.getElementById('refresh');

  function row(label, value, status) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value || '(empty)';
    if (status) {
      const badge = document.createElement('span');
      badge.className = status.type;
      badge.textContent = ` ${status.text}`;
      detail.appendChild(badge);
    }
    results.append(term, detail);
  }

  function fallbackLoginUriForThisBuild() {
    if (window.location.hostname === 'event-flow.co.uk') {
      return `${window.location.origin}/api/auth/callback/google`;
    }
    return EXPECTED_LOGIN_URI;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const json = await response.json();
    return { response, json };
  }

  async function loadDiagnostics() {
    results.innerHTML = '';
    raw.textContent = 'Loading…';
    try {
      const configResult = await fetchJson('/api/v1/config');
      let googleDiagnostics = null;
      try {
        googleDiagnostics = await fetchJson('/api/auth/google/diagnostics');
      } catch (error) {
        googleDiagnostics = { error: error.message || String(error) };
      }

      const config = configResult.json || {};
      const authDiag = googleDiagnostics.json || {};
      raw.textContent = JSON.stringify(
        {
          configEndpoint: config,
          googleAuthDiagnosticsEndpoint: authDiag,
          googleAuthDiagnosticsError: googleDiagnostics.error || null,
        },
        null,
        2
      );

      const liveOrigin = window.location.origin;
      const liveClientId = authDiag.googleClientId || config.googleClientId || '';
      const computedLoginUri = authDiag.googleLoginUri || fallbackLoginUriForThisBuild();

      row('Current page origin', liveOrigin, {
        type: liveOrigin === EXPECTED_ORIGIN ? 'ok' : 'warn',
        text:
          liveOrigin === EXPECTED_ORIGIN ? 'matches production origin' : 'not production origin',
      });
      row('Live googleClientId', liveClientId, {
        type: liveClientId.endsWith('.apps.googleusercontent.com') ? 'ok' : 'bad',
        text: liveClientId ? 'present' : 'missing',
      });
      row('Configured Google client IDs count', String(authDiag.googleClientIdsCount || 0), {
        type: authDiag.googleClientIdsCount === 1 ? 'ok' : 'warn',
        text:
          authDiag.googleClientIdsCount === 1
            ? 'single client configured'
            : 'check duplicate/empty Google env vars',
      });
      row('Server Sign in with Google login_uri', computedLoginUri, {
        type: computedLoginUri === EXPECTED_LOGIN_URI ? 'ok' : 'bad',
        text:
          computedLoginUri === EXPECTED_LOGIN_URI
            ? 'matches expected URI'
            : 'does not match expected URI',
      });
      row('Expected authorised redirect URI', EXPECTED_LOGIN_URI);
      row('Expected authorised JavaScript origin', EXPECTED_ORIGIN);
      row('BASE_URL used by server diagnostics', authDiag.baseUrlHost || '(not available)', {
        type: authDiag.baseUrlHost === EXPECTED_ORIGIN ? 'ok' : 'warn',
        text:
          authDiag.baseUrlHost === EXPECTED_ORIGIN
            ? 'matches production origin'
            : 'check Railway BASE_URL',
      });
      row(
        'Config endpoint status',
        `${configResult.response.status} ${configResult.response.statusText}`,
        {
          type: configResult.response.ok ? 'ok' : 'bad',
          text: configResult.response.ok ? 'ok' : 'failed',
        }
      );
      row(
        'Google diagnostics endpoint status',
        googleDiagnostics.response
          ? `${googleDiagnostics.response.status} ${googleDiagnostics.response.statusText}`
          : 'not available',
        {
          type: googleDiagnostics.response && googleDiagnostics.response.ok ? 'ok' : 'warn',
          text:
            googleDiagnostics.response && googleDiagnostics.response.ok
              ? 'ok'
              : 'missing until PR is deployed',
        }
      );
    } catch (error) {
      raw.textContent = error && error.stack ? error.stack : String(error);
      row('Diagnostics error', error.message || String(error), { type: 'bad', text: 'failed' });
    }
  }

  refresh.addEventListener('click', loadDiagnostics);
  loadDiagnostics();
})();
