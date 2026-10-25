/**
 * Dashboard Guard
 * Enforces role-based access control on dashboard pages
 * Prevents users from accessing dashboards they don't have permission for
 */

(async function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const currentPath = window.location.pathname;
  const dashboardRoles = {
    '/dashboard/customer': 'customer',
    '/dashboard-customer.html': 'customer',
    '/dashboard/supplier': 'supplier',
    '/dashboard-supplier.html': 'supplier',
    '/admin': 'admin',
    '/admin.html': 'admin',
  };

  // The browser's own fetch, taken before anything on this page can wrap it. The sign-in check below
  // uses it directly: it has its own timeout, and the stand-ins the wrapper offers are for requests
  // made after a person has been confirmed.
  const realFetch = window.fetch.bind(window);

  function requiredRoleForPath(path) {
    return (
      dashboardRoles[path] ||
      (path.startsWith('/admin-') || path.startsWith('/admin/') ? 'admin' : null)
    );
  }

  function installCustomerDashboardFetchGuard() {
    const isCustomerDashboard =
      currentPath === '/dashboard/customer' || currentPath === '/dashboard-customer.html';
    if (!isCustomerDashboard || window.__EF_CUSTOMER_DASHBOARD_FETCH_GUARD__) {
      return;
    }

    window.__EF_CUSTOMER_DASHBOARD_FETCH_GUARD__ = true;
    const originalFetch = realFetch;
    // Exactly what this page requests with a GET and could be left waiting on. (The notification and
    // messaging badges use /api/v1/notifications and /api/v4/messenger/..., which are not listed:
    // nothing on this page calls the older /api/notifications, /api/conversations or /api/meta.)
    const guardedPaths = [
      '/api/v1/auth/me',
      '/api/me/plans',
      '/api/csrf-token',
      '/api/v1/csrf-token',
      '/api/tickets',
    ];

    function getPath(input) {
      const raw = typeof input === 'string' ? input : input?.url || '';
      try {
        return new URL(raw, window.location.origin).pathname;
      } catch (_err) {
        return String(raw).split('?')[0];
      }
    }

    // A request that is merely slow is never answered with made-up data. Once it has taken longer
    // than slowAfterMs() the page says it is still working and the real request carries on; at
    // GIVE_UP_AFTER_MS it is cancelled, so the caller sees a genuine failure (and shows its own
    // "could not load" state with a retry) rather than an empty list that reads as "you have none".
    function slowAfterMs(path) {
      if (path === '/api/v1/auth/me') {
        return 7000;
      }
      if (path === '/api/me/plans') {
        return 5000;
      }
      if (path === '/api/csrf-token' || path === '/api/v1/csrf-token') {
        return 4000;
      }
      return 3500;
    }
    const GIVE_UP_AFTER_MS = 30000;
    const SLOW_NOTICE_ID = 'ef-dashboard-slow-notice';
    // The ticket card refreshes itself every minute for as long as the page is open. A slow refresh
    // is not "the dashboard is still loading", and it has its own error state, so it gets no notice
    // (it is still cancelled after GIVE_UP_AFTER_MS like the rest).
    const QUIET_PATHS = ['/api/tickets'];
    let slowRequests = 0;

    function showSlowNotice() {
      slowRequests += 1;
      if (slowRequests !== 1 || document.getElementById(SLOW_NOTICE_ID) || !document.body) {
        return;
      }
      const notice = document.createElement('div');
      notice.id = SLOW_NOTICE_ID;
      // `--slow` moves it to the bottom of the screen: the page's own notices ("Could not refresh
      // your plans") use the top, and the two must not sit on top of each other.
      notice.className = 'cdh-toast cdh-toast--slow';
      notice.setAttribute('role', 'status');
      const title = document.createElement('strong');
      title.textContent = 'Taking longer than usual';
      const text = document.createElement('span');
      text.textContent = 'Your dashboard is still loading. Nothing has been lost.';
      notice.append(title, text);
      document.body.appendChild(notice);
    }

    function hideSlowNotice() {
      slowRequests = Math.max(0, slowRequests - 1);
      if (slowRequests === 0) {
        document.getElementById(SLOW_NOTICE_ID)?.remove();
      }
    }

    // Only the signed-in user the guard itself already confirmed, or a CSRF token the page already
    // holds, can stand in for a slow reply: both are real values, not guesses about the user's data.
    // Everything else (plans, tickets) has no stand-in.
    function standInFor(path) {
      const headers = { 'Content-Type': 'application/json', 'X-EF-Dashboard-Fallback': 'timeout' };
      const storedUser = window.__EF_DASHBOARD_USER__;

      if (path === '/api/v1/auth/me' && storedUser?.id) {
        return new Response(JSON.stringify({ user: storedUser }), { status: 200, headers });
      }
      if (path === '/api/csrf-token' || path === '/api/v1/csrf-token') {
        const csrf =
          window.__CSRF_TOKEN__ ||
          document.querySelector('meta[name="csrf-token"]')?.content ||
          (document.cookie.match(/(?:^|; )csrf=([^;]+)/) || [])[1] ||
          '';
        if (csrf) {
          let decoded = csrf;
          try {
            decoded = decodeURIComponent(csrf);
          } catch {
            // A cookie that is not valid percent-encoding is used as it is, which is what the
            // page's own getCsrfToken() does; throwing here would leave the request with no
            // stand-in, no notice and no cancel.
          }
          return new Response(JSON.stringify({ csrfToken: decoded, token: decoded }), {
            status: 200,
            headers,
          });
        }
      }
      return null;
    }

    window.fetch = function customerDashboardFetch(input, options = {}) {
      const path = getPath(input);
      const method = String(options.method || 'GET').toUpperCase();
      const shouldGuard = method === 'GET' && guardedPaths.some(guarded => path === guarded);
      if (!shouldGuard) {
        return originalFetch(input, options);
      }

      // The guard always holds the abort switch, so it can cancel a request it gave up on. A signal
      // the caller passed is passed on to it: either side aborting cancels the request.
      const callerSignal = options.signal || null;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const passOnAbort = () => controller.abort();
      if (controller && callerSignal) {
        if (callerSignal.aborted) {
          controller.abort();
        } else {
          callerSignal.addEventListener('abort', passOnAbort, { once: true });
        }
      }
      const opts = controller ? { ...options, signal: controller.signal } : options;
      const slowMs = slowAfterMs(path);
      let giveUpTimer = null;
      let noticeShown = false;
      let useStandIn = null;
      const standIn = new Promise(resolve => {
        useStandIn = resolve;
      });

      const slowTimer = window.setTimeout(() => {
        console.warn(`Customer dashboard request is slow: ${path}`);
        const fallback = standInFor(path);
        if (fallback) {
          // Hand the stand-in over BEFORE cancelling the request. A browser rejects the request's
          // promise synchronously inside abort(); if the stand-in were settled after it, the
          // rejection would win the race below and the caller would get an AbortError, never the
          // stand-in.
          useStandIn(fallback);
          if (controller) {
            controller.abort();
          }
          return;
        }
        if (!QUIET_PATHS.includes(path)) {
          noticeShown = true;
          showSlowNotice();
        }
        giveUpTimer = window.setTimeout(() => {
          console.warn(`Customer dashboard request gave up waiting: ${path}`);
          if (controller) {
            controller.abort();
          }
        }, GIVE_UP_AFTER_MS - slowMs);
      }, slowMs);

      return Promise.race([originalFetch(input, opts), standIn]).finally(() => {
        window.clearTimeout(slowTimer);
        window.clearTimeout(giveUpTimer);
        callerSignal?.removeEventListener('abort', passOnAbort);
        if (noticeShown) {
          hideSlowNotice();
        }
      });
    };
  }

  const requiredRole = requiredRoleForPath(currentPath);
  if (!requiredRole) {
    return;
  }

  const REDIRECT_LOOP_KEY = 'dashboardGuardRedirectCount';
  const REDIRECT_LOOP_PATH_KEY = 'dashboardGuardRedirectPath';
  const MAX_REDIRECTS = 3;
  const styleId = 'dashboard-guard-style';

  /**
   * Reveal the page. The hiding rule makes every element `visibility: hidden`; taking it away would
   * make each element that has `transition: all` (buttons, inputs, table cells...) animate from
   * hidden to visible. That is pointless, and where the browser's animation clock is slow or held
   * (a throttled or headless browser) the elements stay hidden until it catches up. So transitions
   * are switched off in the same step as the reveal, and back on a moment later.
   */
  function showPage() {
    const style = document.getElementById(styleId);
    if (!style) {
      return;
    }
    const calm = document.createElement('style');
    calm.id = `${styleId}-calm`;
    calm.textContent = '*, *::before, *::after { transition: none !important; }';
    document.head.appendChild(calm);
    style.remove();
    window.setTimeout(() => calm.remove(), 150);
  }

  function showAccessError() {
    sessionStorage.removeItem(REDIRECT_LOOP_KEY);
    sessionStorage.removeItem(REDIRECT_LOOP_PATH_KEY);
    console.error('Dashboard guard: Redirect loop detected. Stopping redirects.');
    document.body.textContent = '';

    const container = document.createElement('div');
    container.style.cssText =
      'max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; font-family: system-ui, -apple-system, sans-serif;';

    const heading = document.createElement('h1');
    heading.style.color = '#dc2626';
    heading.textContent = 'Access Error';
    container.appendChild(heading);

    const intro = document.createElement('p');
    intro.style.cssText = 'color: #6b7280; margin: 20px 0;';
    intro.textContent = 'There appears to be an issue with your session. Please sign in again.';
    container.appendChild(intro);

    const link = document.createElement('a');
    link.href = '/auth';
    link.style.cssText =
      'display: inline-block; padding: 12px 24px; background: #0b8073; color: white; text-decoration: none; border-radius: 6px;';
    link.textContent = 'Return to Login';
    container.appendChild(link);

    document.body.appendChild(container);
    showPage();
  }

  try {
    const storedPath = sessionStorage.getItem(REDIRECT_LOOP_PATH_KEY);
    const redirectCount = parseInt(sessionStorage.getItem(REDIRECT_LOOP_KEY) || '0', 10);
    if (storedPath === currentPath && redirectCount >= MAX_REDIRECTS) {
      showAccessError();
      return;
    }
    sessionStorage.setItem(
      REDIRECT_LOOP_KEY,
      storedPath === currentPath ? String(redirectCount + 1) : '1'
    );
    sessionStorage.setItem(REDIRECT_LOOP_PATH_KEY, currentPath);
  } catch (e) {
    console.warn('Dashboard guard: Unable to access sessionStorage', e);
  }

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = 'body { visibility: hidden !important; opacity: 0 !important; }';
    document.head.appendChild(style);
  }

  // On the customer dashboard the page's own start-up requests begin while the check below is still
  // running, so the timeout and "taking longer" handling is in place from the start, not only once
  // the check has finished.
  installCustomerDashboardFetchGuard();

  function publishVerifiedUser(user) {
    const publish = () => {
      try {
        window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
        window.dispatchEvent(new CustomEvent('__auth-state-updated', { detail: { user } }));
      } catch (eventError) {
        if (isDevelopment) {
          console.warn('Dashboard guard: failed to publish verified auth state', eventError);
        }
      }
    };

    publish();
    window.setTimeout(publish, 0);
    window.setTimeout(publish, 250);
    window.setTimeout(publish, 750);
  }

  const AUTH_CHECK_MAX_RETRIES = 2;
  const AUTH_CHECK_RETRY_DELAY_MS = 600;
  // The page is hidden until this check ends, so a request that hangs must not hold it forever: a
  // notice appears after AUTH_CHECK_NOTICE_MS and the attempt is cancelled (and retried) after
  // AUTH_CHECK_TIMEOUT_MS.
  const AUTH_CHECK_NOTICE_MS = 4000;
  const AUTH_CHECK_TIMEOUT_MS = 10000;
  const AUTH_NOTICE_ID = 'ef-guard-auth-notice';

  // Only the customer dashboard treats "the check could not be completed" as something other than
  // "signed out": a signed-in customer on a flaky connection should see a retry, not be thrown to
  // the sign-in page. The admin and supplier pages keep redirecting, as before.
  const isCustomerPage = requiredRole === 'customer';

  // The notice is added to <html>, not <body>: the body is hidden by the rule above until the check
  // ends, and this is exactly the time the person needs to see something.
  function showAuthNotice() {
    if (document.getElementById(AUTH_NOTICE_ID) || !document.documentElement) {
      return;
    }
    const notice = document.createElement('div');
    notice.id = AUTH_NOTICE_ID;
    notice.setAttribute('role', 'status');
    notice.style.cssText =
      'position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 2147483647; max-width: calc(100vw - 32px); padding: 12px 16px; border-radius: 8px; background: #111827; color: #fff; font: 14px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,0.25);';
    notice.textContent = 'Still checking that you are signed in…';
    document.documentElement.appendChild(notice);
  }

  function hideAuthNotice() {
    document.getElementById(AUTH_NOTICE_ID)?.remove();
  }

  // A thrown fetch (offline blip, proxy timeout, DNS hiccup, a request that hung and was cancelled)
  // or a non-2xx status other than 401/403 doesn't prove the session is invalid — only a confirmed
  // 401/403 does. Retry a couple of times before bouncing an otherwise-authenticated user out of
  // the dashboard they were using.
  async function fetchAuthMe(retriesLeft) {
    let response = null;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const noticeTimer = window.setTimeout(showAuthNotice, AUTH_CHECK_NOTICE_MS);
    const cancelTimer = window.setTimeout(() => controller?.abort(), AUTH_CHECK_TIMEOUT_MS);
    try {
      const cacheBuster = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      response = await realFetch(`/api/v1/auth/me?t=${cacheBuster}`, {
        credentials: 'include',
        headers: {
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (networkError) {
      if (retriesLeft > 0) {
        await new Promise(resolve => setTimeout(resolve, AUTH_CHECK_RETRY_DELAY_MS));
        return fetchAuthMe(retriesLeft - 1);
      }
      throw networkError;
    } finally {
      window.clearTimeout(noticeTimer);
      window.clearTimeout(cancelTimer);
    }

    if (!response.ok && response.status !== 401 && response.status !== 403 && retriesLeft > 0) {
      await new Promise(resolve => setTimeout(resolve, AUTH_CHECK_RETRY_DELAY_MS));
      return fetchAuthMe(retriesLeft - 1);
    }

    return response;
  }

  /**
   * The check could not be completed (network error, timeout, 5xx), as opposed to being refused.
   * On the customer dashboard the page is shown anyway: its start-up script repeats the check,
   * says plainly that it could not confirm the sign-in and offers a retry, and a real 401/403 on
   * that repeat still sends the person to the sign-in page. Nothing was redirected, so the
   * redirect-loop counter is cleared. Returns false on the other dashboards, which redirect.
   */
  function carryOnUnconfirmed(reason) {
    if (!isCustomerPage) {
      return false;
    }
    console.warn('Dashboard guard: could not confirm the sign-in, showing the page:', reason);
    window.__EF_SIGNIN_UNCONFIRMED__ = true;
    try {
      sessionStorage.removeItem(REDIRECT_LOOP_KEY);
      sessionStorage.removeItem(REDIRECT_LOOP_PATH_KEY);
    } catch (e) {
      // Ignore sessionStorage errors
    }
    showPage();
    return true;
  }

  try {
    // Important: the role gate uses the real fetch (not the wrapper installed above), with its own
    // timeout, so the answer is never a stand-in for the person it is meant to identify.
    const response = await fetchAuthMe(AUTH_CHECK_MAX_RETRIES);
    hideAuthNotice();

    if (!response.ok) {
      if (isDevelopment) {
        console.error(
          `Dashboard guard: Auth check failed with status ${response.status}`,
          `for page ${currentPath} (required role: ${requiredRole})`
        );
      }
      if (
        response.status !== 401 &&
        response.status !== 403 &&
        carryOnUnconfirmed(response.status)
      ) {
        return;
      }
      window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    const data = await response.json();
    const user = data.user || data;
    window.__EF_DASHBOARD_USER__ = user;

    if (isDevelopment) {
      console.log('Dashboard guard check:', {
        currentPath,
        requiredRole,
        userId: user?.id,
        userRole: user?.role,
        roleMatch: user?.role === requiredRole,
      });
    }

    if (!user || !user.id) {
      if (isDevelopment) {
        console.warn('Dashboard guard: User not authenticated, redirecting');
      }
      window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    if (user.role !== requiredRole) {
      let correctDashboard = '/';
      if (user.role === 'admin') {
        correctDashboard = '/admin';
      } else if (user.role === 'supplier') {
        correctDashboard = '/dashboard/supplier';
      } else if (user.role === 'customer') {
        correctDashboard = '/dashboard/customer';
      }

      if (currentPath !== correctDashboard) {
        if (isDevelopment) {
          console.warn(
            `Role mismatch: user has role '${user.role}' but page requires '${requiredRole}'. Redirecting to ${correctDashboard}`
          );
        }
        window.location.replace(correctDashboard);
        return;
      }
    }

    publishVerifiedUser(user);

    try {
      sessionStorage.removeItem(REDIRECT_LOOP_KEY);
      sessionStorage.removeItem(REDIRECT_LOOP_PATH_KEY);
    } catch (e) {
      // Ignore sessionStorage errors
    }

    showPage();
  } catch (error) {
    hideAuthNotice();
    console.error('Dashboard guard error:', error);
    if (carryOnUnconfirmed(error)) {
      return;
    }
    window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  }
})();
