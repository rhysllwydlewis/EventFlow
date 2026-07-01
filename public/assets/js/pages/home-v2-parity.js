(() => {
  'use strict';

  const body = document.body;
  const authLink = document.getElementById('hv2-auth-link');
  const dashboardLinks = document.querySelectorAll('[data-hv2-dashboard-link]');
  const logoutLinks = document.querySelectorAll('[data-hv2-logout]');
  const notificationButton = document.getElementById('hv2-notification-btn');
  const notificationDropdown = document.getElementById('hv2-notification-dropdown');
  const cookiePrefsButton = document.getElementById('hv2-cookie-prefs-btn');
  const bottomMenuButton = document.getElementById('hv2-bottom-menu');
  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const newsletterForm = document.getElementById('hv2-newsletter-form');
  const newsletterFeedback = document.getElementById('hv2-newsletter-feedback');

  function getDashboardUrl(user) {
    const role = String(user?.role || user?.accountType || '').toLowerCase();

    if (role.includes('supplier')) {
      return '/dashboard/supplier';
    }

    if (role.includes('admin')) {
      return '/admin';
    }

    return '/dashboard';
  }

  function setAuthenticatedState(user) {
    const isAuthenticated = Boolean(user);
    body.classList.toggle('hv2-user-authenticated', isAuthenticated);

    if (authLink) {
      authLink.textContent = isAuthenticated ? 'Account' : 'Sign in';
      authLink.href = isAuthenticated ? getDashboardUrl(user) : '/auth';
    }

    dashboardLinks.forEach(link => {
      link.href = getDashboardUrl(user);
    });
  }

  async function initialiseAuthAwareNav() {
    setAuthenticatedState(null);

    if (!window.AuthStateManager || typeof window.AuthStateManager.init !== 'function') {
      return;
    }

    try {
      const result = await window.AuthStateManager.init();
      setAuthenticatedState(result?.user || null);
      window.AuthStateManager.subscribe(({ user }) => setAuthenticatedState(user));
    } catch {
      setAuthenticatedState(null);
    }
  }

  function closeNotifications() {
    if (!notificationButton || !notificationDropdown) {
      return;
    }

    notificationButton.setAttribute('aria-expanded', 'false');
    notificationDropdown.hidden = true;
  }

  function initialiseNotifications() {
    if (!notificationButton || !notificationDropdown) {
      return;
    }

    notificationButton.addEventListener('click', () => {
      const isOpen = notificationButton.getAttribute('aria-expanded') === 'true';
      notificationButton.setAttribute('aria-expanded', String(!isOpen));
      notificationDropdown.hidden = isOpen;
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeNotifications();
      }
    });
  }

  async function logout() {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // Still clear local auth state and send the user home.
    }

    try {
      window.AuthStateManager?.logout?.();
    } catch {
      // ignore
    }

    window.location.href = '/';
  }

  function initialiseLogout() {
    logoutLinks.forEach(link => {
      link.addEventListener('click', event => {
        event.preventDefault();
        logout();
      });
    });
  }

  function initialiseCookiePreferences() {
    if (!cookiePrefsButton) {
      return;
    }

    cookiePrefsButton.addEventListener('click', () => {
      if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
        window.CookieConsent.openPreferences();
      }
    });
  }

  function initialiseBottomMenu() {
    if (!bottomMenuButton || !menuButton || !mobileNav) {
      return;
    }

    bottomMenuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute('aria-label', isOpen ? 'Open navigation menu' : 'Close navigation menu');
      mobileNav.hidden = isOpen;
      bottomMenuButton.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  function initialiseNewsletter() {
    if (!newsletterForm || !newsletterFeedback) {
      return;
    }

    newsletterForm.addEventListener('submit', async event => {
      event.preventDefault();
      const submitButton = newsletterForm.querySelector('button[type="submit"]');
      const formData = new FormData(newsletterForm);
      const email = String(formData.get('email') || '').trim();

      if (!email) {
        newsletterFeedback.textContent = 'Please enter an email address.';
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }

      try {
        const response = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });

        if (!response.ok) {
          throw new Error('Newsletter request failed');
        }

        newsletterForm.reset();
        newsletterFeedback.textContent = 'Thanks, you are on the list.';
      } catch {
        newsletterFeedback.textContent = 'We could not subscribe you just now. Please try again later.';
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
        }
      }
    });
  }

  function addStructuredData() {
    const existing = document.getElementById('hv2-rich-schema');
    if (existing) {
      return;
    }

    const schema = document.createElement('script');
    schema.id = 'hv2-rich-schema';
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Organization',
          '@id': 'https://event-flow.co.uk/#organization',
          name: 'EventFlow',
          url: 'https://event-flow.co.uk',
          logo: 'https://event-flow.co.uk/icon-512.png',
          address: { '@type': 'PostalAddress', addressCountry: 'GB' },
        },
        {
          '@type': 'WebSite',
          '@id': 'https://event-flow.co.uk/#website',
          name: 'EventFlow',
          url: 'https://event-flow.co.uk',
          publisher: { '@id': 'https://event-flow.co.uk/#organization' },
          potentialAction: {
            '@type': 'SearchAction',
            target: 'https://event-flow.co.uk/suppliers?q={search_term_string}',
            'query-input': 'required name=search_term_string',
          },
        },
      ],
    });

    document.head.appendChild(schema);
  }

  initialiseAuthAwareNav();
  initialiseNotifications();
  initialiseLogout();
  initialiseCookiePreferences();
  initialiseBottomMenu();
  initialiseNewsletter();
  addStructuredData();
})();
