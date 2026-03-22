/**
 * Dashboard Guard
 * Enforces role-based access control on dashboard pages
 * Prevents users from accessing dashboards they don't have permission for
 */

(async function () {
  'use strict';

  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Get current page
  const currentPath = window.location.pathname;

  // Role requirements for each dashboard type
  const dashboardRoles = {
    '/dashboard/supplier': 'supplier',
    '/dashboard-supplier.html': 'supplier',
    '/dashboard/customer': 'customer',
    '/dashboard-customer.html': 'customer',
    // Admin pages — both canonical clean URLs and legacy .html paths
    '/admin': 'admin',
    '/admin.html': 'admin',
    '/admin-audit': 'admin',
    '/admin-audit.html': 'admin',
    '/admin-content': 'admin',
    '/admin-content.html': 'admin',
    '/admin-content-dates': 'admin',
    '/admin-content-dates.html': 'admin',
    '/admin-homepage': 'admin',
    '/admin-homepage.html': 'admin',
    '/admin-marketplace': 'admin',
    '/admin-marketplace.html': 'admin',
    '/admin-packages': 'admin',
    '/admin-packages.html': 'admin',
    '/admin-payments': 'admin',
    '/admin-payments.html': 'admin',
    '/admin-pexels': 'admin',
    '/admin-pexels.html': 'admin',
    '/admin-photos': 'admin',
    '/admin-photos.html': 'admin',
    '/admin-reports': 'admin',
    '/admin-reports.html': 'admin',
    '/admin-settings': 'admin',
    '/admin-settings.html': 'admin',
    '/admin-supplier-detail': 'admin',
    '/admin-supplier-detail.html': 'admin',
    '/admin-suppliers': 'admin',
    '/admin-suppliers.html': 'admin',
    '/admin-tickets': 'admin',
    '/admin-tickets.html': 'admin',
    '/admin-user-detail': 'admin',
    '/admin-user-detail.html': 'admin',
    '/admin-users': 'admin',
    '/admin-users.html': 'admin',
    '/admin-messenger': 'admin',
    '/admin-messenger.html': 'admin',
    '/admin-messenger-view': 'admin',
    '/admin-messenger-view.html': 'admin',
    '/admin-media': 'admin',
    '/admin-media.html': 'admin',
    '/admin-search': 'admin',
    '/admin-search.html': 'admin',
  };

  // Check if current page requires role check
  const requiredRole = dashboardRoles[currentPath];
  if (!requiredRole) {
    // Not a protected dashboard page
    return;
  }

  // Redirect loop detection
  const REDIRECT_LOOP_KEY = 'dashboardGuardRedirectCount';
  const REDIRECT_LOOP_PATH_KEY = 'dashboardGuardRedirectPath';
  const MAX_REDIRECTS = 3;

  // Check for redirect loop
  try {
    const storedPath = sessionStorage.getItem(REDIRECT_LOOP_PATH_KEY);
    const redirectCount = parseInt(sessionStorage.getItem(REDIRECT_LOOP_KEY) || '0', 10);

    if (storedPath === currentPath && redirectCount >= MAX_REDIRECTS) {
      // Redirect loop detected - clear storage and show error
      sessionStorage.removeItem(REDIRECT_LOOP_KEY);
      sessionStorage.removeItem(REDIRECT_LOOP_PATH_KEY);
      console.error('Dashboard guard: Redirect loop detected. Stopping redirects.');

      // Clear body safely and build error page
      // Note: At this point authentication has failed multiple times,
      // so clearing existing content is appropriate
      document.body.textContent = ''; // Clear body safely (no innerHTML)

      const container = document.createElement('div');
      container.style.cssText =
        'max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; font-family: system-ui, -apple-system, sans-serif;';

      const heading = document.createElement('h1');
      heading.style.color = '#dc2626';
      heading.textContent = 'Access Error';
      container.appendChild(heading);

      const intro = document.createElement('p');
      intro.style.cssText = 'color: #6b7280; margin: 20px 0;';
      intro.textContent =
        'There appears to be an issue with your session. This usually happens when:';
      container.appendChild(intro);

      const list = document.createElement('ul');
      list.style.cssText = 'text-align: left; color: #6b7280; line-height: 1.8;';
      [
        'Your session has expired',
        'Your account role needs verification',
        "There's a temporary authentication issue",
      ].forEach(text => {
        const li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      container.appendChild(list);

      const linkPara = document.createElement('p');
      linkPara.style.cssText = 'margin: 30px 0;';
      const link = document.createElement('a');
      link.href = '/auth';
      link.style.cssText =
        'display: inline-block; padding: 12px 24px; background: #0b8073; color: white; text-decoration: none; border-radius: 6px;';
      link.textContent = 'Return to Login';
      linkPara.appendChild(link);
      container.appendChild(linkPara);

      const footer = document.createElement('p');
      footer.style.cssText = 'font-size: 0.9rem; color: #9ca3af; margin-top: 30px;';
      footer.textContent = 'If this problem persists, please contact support.';
      container.appendChild(footer);

      document.body.appendChild(container);
      return;
    }

    // Update redirect counter
    if (storedPath === currentPath) {
      sessionStorage.setItem(REDIRECT_LOOP_KEY, String(redirectCount + 1));
    } else {
      // New path, reset counter
      sessionStorage.setItem(REDIRECT_LOOP_KEY, '1');
      sessionStorage.setItem(REDIRECT_LOOP_PATH_KEY, currentPath);
    }
  } catch (e) {
    // SessionStorage might not be available (private browsing, etc.)
    console.warn('Dashboard guard: Unable to access sessionStorage', e);
  }

  // Inject style tag to hide body initially (works even in <head> before body exists)
  // This prevents flash of wrong content without causing errors
  const styleId = 'dashboard-guard-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = 'body { visibility: hidden !important; opacity: 0 !important; }';
    document.head.appendChild(style);
  }

  // Helper function to show the page (removes the hiding style)
  function showPage() {
    const style = document.getElementById(styleId);
    if (style) {
      style.remove();
    }
  }

  try {
    // Fetch current user with cache-busting
    // Using timestamp + random value for better cache-busting
    const cacheBuster = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const response = await fetch(`/api/v1/auth/me?t=${cacheBuster}`, {
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      // Log the error in development mode for debugging
      if (window.location.hostname === 'localhost') {
        console.error(
          `Dashboard guard: Auth check failed with status ${response.status}`,
          `for page ${currentPath} (required role: ${requiredRole})`
        );
      }
      // Failed to check auth - redirect to login for all roles
      window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    const data = await response.json();
    const user = data.user || data; // Support both wrapped and unwrapped formats

    // Log user data in development mode for debugging
    if (window.location.hostname === 'localhost') {
      if (isDevelopment) {
        console.log('Dashboard guard check:', {
          currentPath,
          requiredRole,
          userId: user?.id,
          userRole: user?.role,
          roleMatch: user?.role === requiredRole,
        });
      }
    }

    if (!user || !user.id) {
      // Not authenticated - redirect to login
      if (window.location.hostname === 'localhost') {
        console.warn('Dashboard guard: User not authenticated, redirecting');
      }
      // Not authenticated - redirect to login for all roles
      window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    // Check role match
    if (user.role !== requiredRole) {
      // Role mismatch - redirect to correct dashboard for user's role
      let correctDashboard;
      if (user.role === 'admin') {
        correctDashboard = '/admin';
      } else if (user.role === 'supplier') {
        correctDashboard = '/dashboard/supplier';
      } else if (user.role === 'customer') {
        correctDashboard = '/dashboard/customer';
      } else {
        // Unknown role - redirect to home
        correctDashboard = '/';
      }

      // Only redirect if not already on the correct page
      if (currentPath !== correctDashboard) {
        if (window.location.hostname === 'localhost') {
          console.warn(
            `Role mismatch: user has role '${user.role}' but page requires '${requiredRole}'. Redirecting to ${correctDashboard}`
          );
        }
        window.location.replace(correctDashboard);
        return;
      }
    }

    // Access granted - clear redirect counter and show the page
    try {
      sessionStorage.removeItem(REDIRECT_LOOP_KEY);
      sessionStorage.removeItem(REDIRECT_LOOP_PATH_KEY);
    } catch (e) {
      // Ignore sessionStorage errors
    }
    showPage();
  } catch (error) {
    console.error('Dashboard guard error:', error);
    // On error, redirect to login for all roles
    window.location.replace(`/auth?redirect=${encodeURIComponent(currentPath)}`);
  }
})();
