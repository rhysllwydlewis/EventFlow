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
    const originalFetch = window.fetch.bind(window);
    const guardedPaths = [
      '/api/v1/auth/me',
      '/api/me/plans',
      '/api/meta',
      '/api/csrf-token',
      '/api/v1/csrf-token',
      '/api/notifications',
      '/api/conversations',
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

    function timeoutFor(path) {
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

    function responseFor(path) {
      const headers = { 'Content-Type': 'application/json', 'X-EF-Dashboard-Fallback': 'timeout' };
      const storedUser = window.__EF_DASHBOARD_USER__;

      if (path === '/api/v1/auth/me') {
        if (storedUser?.id) {
          return new Response(JSON.stringify({ user: storedUser }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ error: 'Auth request timed out' }), {
          status: 504,
          headers,
        });
      }

      if (path === '/api/me/plans') {
        return new Response(JSON.stringify({ plans: [] }), { status: 200, headers });
      }
      if (path === '/api/notifications') {
        return new Response(JSON.stringify({ notifications: [], unreadCount: 0, total: 0 }), {
          status: 200,
          headers,
        });
      }
      if (path === '/api/conversations') {
        return new Response(JSON.stringify({ conversations: [], data: [], total: 0 }), {
          status: 200,
          headers,
        });
      }
      if (path === '/api/tickets') {
        return new Response(JSON.stringify({ tickets: [], data: [], total: 0 }), {
          status: 200,
          headers,
        });
      }
      if (path === '/api/csrf-token' || path === '/api/v1/csrf-token') {
        const csrf =
          window.__CSRF_TOKEN__ ||
          document.querySelector('meta[name="csrf-token"]')?.content ||
          (document.cookie.match(/(?:^|; )csrf=([^;]+)/) || [])[1] ||
          '';
        const decoded = decodeURIComponent(csrf || '');
        return new Response(JSON.stringify({ csrfToken: decoded, token: decoded }), {
          status: 200,
          headers,
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers });
    }

    window.fetch = function customerDashboardFetch(input, options = {}) {
      const path = getPath(input);
      const method = String(options.method || 'GET').toUpperCase();
      const shouldGuard = method === 'GET' && guardedPaths.some(guarded => path === guarded);
      if (!shouldGuard) {
        return originalFetch(input, options);
      }

      const timeoutMs = timeoutFor(path);
      const controller =
        !options.signal && typeof AbortController !== 'undefined' ? new AbortController() : null;
      const opts = controller ? { ...options, signal: controller.signal } : options;
      let timeoutId;
      const timeoutPromise = new Promise(resolve => {
        timeoutId = window.setTimeout(() => {
          if (controller) {
            controller.abort();
          }
          console.warn(`Customer dashboard request timed out; using safe fallback for ${path}`);
          resolve(responseFor(path));
        }, timeoutMs);
      });

      return Promise.race([originalFetch(input, opts), timeoutPromise]).finally(() => {
        window.clearTimeout(timeoutId);
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

  function showPage() {
    const style = document.getElementById(styleId);
    if (style) {
      style.remove();
    }
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

  function loadCustomerScript(id, src) {
    if (requiredRole !== 'customer' || document.getElementById(id)) {
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  function loadCustomerDashboardMopUp() {
    loadCustomerScript(
      'customer-dashboard-mop-up-script',
      '/assets/js/customer-dashboard-mop-up.js?v=1.0.5'
    );
    loadCustomerScript(
      'customer-dashboard-polish-script',
      '/assets/js/customer-dashboard-polish.js?v=1.0.3'
    );
  }

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

  try {
    // Important: use the real fetch for the role gate. The timeout/fallback wrapper
    // is installed only after a real authenticated user has been confirmed.
    const cacheBuster = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const response = await fetch(`/api/v1/auth/me?t=${cacheBuster}`, {
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      if (isDevelopment) {
        console.error(
          `Dashboard guard: Auth check failed with status ${response.status}`,
          `for page ${currentPath} (required role: ${requiredRole})`
        );
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

    installCustomerDashboardFetchGuard();
    loadCustomerDashboardMopUp();
    showPage();
  } catch (error) {
    console.error('Dashboard guard error:', error);
    window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  }
})();
