(function supplierDashboardAuthSync() {
  'use strict';

  const supplierPaths = ['/dashboard/supplier', '/dashboard-supplier.html'];
  if (!supplierPaths.includes(window.location.pathname)) return;

  function isSupplierUser(user) {
    return Boolean(user && user.id && user.role === 'supplier');
  }

  function applySupplierNavbar(user) {
    if (!isSupplierUser(user)) return false;

    const authState = window.__authState || window.AuthStateManager;
    if (authState && typeof authState.setUser === 'function') {
      authState.setUser(user);
    }

    const authLink = document.getElementById('ef-auth-link');
    const dashboardLink = document.getElementById('ef-dashboard-link');
    const mobileAuth = document.getElementById('ef-mobile-auth');
    const mobileDashboard = document.getElementById('ef-mobile-dashboard');
    const mobileSettings = document.getElementById('ef-mobile-settings');
    const mobileLogout = document.getElementById('ef-mobile-logout');
    const notificationBtn = document.getElementById('ef-notification-btn');

    if (authLink && authLink.getAttribute('href') === '/auth') {
      authLink.textContent = 'Log out';
      authLink.href = '#';
      authLink.classList.remove('ef-btn-primary');
      authLink.classList.add('ef-btn-secondary');
    }

    if (dashboardLink) {
      dashboardLink.href = '/dashboard/supplier';
      dashboardLink.style.display = '';
    }

    if (mobileAuth) {
      mobileAuth.style.display = 'none';
    }

    if (mobileDashboard) {
      mobileDashboard.href = '/dashboard/supplier';
      mobileDashboard.style.display = '';
    }

    if (mobileSettings) mobileSettings.style.display = '';
    if (mobileLogout) mobileLogout.style.display = '';
    if (notificationBtn) notificationBtn.style.display = 'flex';

    return true;
  }

  function syncFromGuard() {
    return applySupplierNavbar(window.__EF_DASHBOARD_USER__);
  }

  window.addEventListener('auth-state-changed', event => {
    applySupplierNavbar(event.detail && event.detail.user);
  });

  window.addEventListener('__auth-state-updated', () => {
    syncFromGuard();
  });

  document.addEventListener('DOMContentLoaded', () => {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (syncFromGuard() || attempts >= 40) window.clearInterval(timer);
    }, 250);
  });
})();
