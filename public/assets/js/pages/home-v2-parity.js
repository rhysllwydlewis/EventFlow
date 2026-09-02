// prettier-ignore
'use strict';
(() => {
  const body = document.body;
  const authLink = document.getElementById('hv2-auth-link');
  const dashboardLinks = document.querySelectorAll('[data-hv2-dashboard-link]');
  const logoutLinks = document.querySelectorAll('[data-hv2-logout]');
  const notificationButton = document.getElementById('hv2-notification-btn');
  const notificationBadge = document.getElementById('hv2-notification-badge');
  const bottomDashboardBadge = document.getElementById('hv2-bottom-dashboard-badge');
  const notificationDropdown = document.getElementById('hv2-notification-dropdown');
  const notificationList = document.getElementById('hv2-notification-list');
  const markAllReadButton = document.getElementById('hv2-notification-mark-all-read');
  const cookiePrefsButton = document.getElementById('hv2-cookie-prefs-btn');
  const bottomMenuButton = document.getElementById('hv2-bottom-menu');
  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const newsletterForm = document.getElementById('hv2-newsletter-form');
  const newsletterFeedback = document.getElementById('hv2-newsletter-feedback');
  const categoryGrid = document.getElementById('hv2-category-grid-live');
  const marketplacePreview = document.getElementById('hv2-marketplace-preview');
  const guidesList = document.getElementById('hv2-guides-list');
  const heroVideo = document.getElementById('hv2-hero-video');

  const fallbackImage = '/assets/images/placeholders/package-event.svg';
  const categoryFallbacks = [
    { category: 'Venues', image: '/assets/images/collage-venue.jpg', name: 'Venues' },
    { category: 'Catering', image: '/assets/images/collage-catering.jpg', name: 'Catering' },
    {
      category: 'Photography',
      image: '/assets/images/collage-photography.jpg',
      name: 'Photography',
    },
    {
      category: 'Videography',
      image:
        'https://images.pexels.com/photos/274937/pexels-photo-274937.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Videography',
    },
    {
      category: 'Entertainment',
      image: '/assets/images/collage-entertainment.jpg',
      name: 'Entertainment',
    },
    {
      category: 'Music/DJ',
      image:
        'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Music/DJ',
    },
    {
      category: 'Florist',
      image:
        'https://images.pexels.com/photos/169190/pexels-photo-169190.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Florist',
    },
    {
      category: 'Decor',
      image:
        'https://images.pexels.com/photos/265947/pexels-photo-265947.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Decor',
    },
    {
      category: 'Transport',
      image:
        'https://images.pexels.com/photos/164634/pexels-photo-164634.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Transport',
    },
    {
      category: 'Cake',
      image:
        'https://images.pexels.com/photos/1721932/pexels-photo-1721932.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Cake',
    },
    {
      category: 'Hair & Makeup',
      image:
        'https://images.pexels.com/photos/3993449/pexels-photo-3993449.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Hair & Makeup',
    },
    {
      category: 'Event Planner',
      image:
        'https://images.pexels.com/photos/3184292/pexels-photo-3184292.jpeg?auto=compress&cs=tinysrgb&w=760&h=500&fit=crop',
      name: 'Event Planner',
    },
  ];

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
  }

  function safeImage(value) {
    const url = String(value || '').trim();
    if (!url || /^(javascript|data|vbscript|file):/i.test(url)) {
      return fallbackImage;
    }
    return url;
  }

  function slugValue(value, fallback) {
    const cleaned = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '');
    return cleaned || String(fallback || 'item');
  }

  function getDashboardUrl(user) {
    const role = String(user?.role || user?.accountType || '').toLowerCase();

    if (role.includes('supplier')) {
      return '/dashboard/supplier';
    }

    if (role.includes('admin')) {
      return '/admin';
    }

    return '/dashboard/customer';
  }

  async function getCsrfToken() {
    if (window.__CSRF_TOKEN__) {
      return window.__CSRF_TOKEN__;
    }

    try {
      const response = await fetch('/api/v1/csrf-token', {
        credentials: 'include',
      });
      if (!response.ok) {
        return '';
      }

      const data = await response.json();
      const token = data.csrfToken || data.token || '';
      window.__CSRF_TOKEN__ = token;
      return token;
    } catch {
      return '';
    }
  }

  function setBadgeVisible(isVisible) {
    [notificationBadge, bottomDashboardBadge].forEach(badge => {
      if (badge) {
        badge.style.display = isVisible ? 'block' : 'none';
      }
    });
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

    if (isAuthenticated) {
      loadNotifications();
    } else {
      setBadgeVisible(false);
      renderSignedOutNotifications();
    }
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

  function renderSignedOutNotifications() {
    if (!notificationList) {
      return;
    }

    notificationList.innerHTML =
      '<p>Sign in to see supplier replies, saved item updates and planning reminders.</p>';
  }

  function renderNotifications(items) {
    if (!notificationList) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      notificationList.innerHTML = '<p>You are all caught up.</p>';
      setBadgeVisible(false);
      return;
    }

    const unreadCount = items.filter(item => !item.read && !item.isRead).length;
    setBadgeVisible(unreadCount > 0);
    notificationList.innerHTML = items
      .slice(0, 4)
      .map(item => {
        const title = escapeHtml(item.title || item.type || 'Notification');
        const message = escapeHtml(item.message || item.body || 'You have a new update.');
        return `<article class="hv2-notification-item"><strong>${title}</strong><p>${message}</p></article>`;
      })
      .join('');
  }

  async function loadNotifications() {
    if (!notificationList) {
      return;
    }

    try {
      const response = await fetch('/api/v1/notifications?limit=4', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Notifications unavailable');
      }

      const data = await response.json();
      renderNotifications(data.notifications || data.items || []);
    } catch {
      notificationList.innerHTML =
        '<p>Notifications will appear here when suppliers reply or saved items update.</p>';
      setBadgeVisible(false);
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

    document.addEventListener('click', event => {
      if (
        !notificationDropdown.hidden &&
        !notificationDropdown.contains(event.target) &&
        event.target !== notificationButton &&
        !notificationButton.contains(event.target)
      ) {
        closeNotifications();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeNotifications();
      }
    });

    if (markAllReadButton) {
      markAllReadButton.addEventListener('click', async () => {
        const csrfToken = await getCsrfToken();
        try {
          await fetch('/api/v1/notifications/mark-all-read', {
            method: 'POST',
            credentials: 'include',
            headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
          });
        } catch {
          // The UI can still clear the local badge if the endpoint is unavailable.
        }
        setBadgeVisible(false);
      });
    }
  }

  async function logout() {
    const csrfToken = await getCsrfToken();

    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
      });
    } catch {
      // Still clear local auth state and send the user home.
    }

    try {
      window.AuthStateManager?.logout?.();
    } catch {
      // ignore
    }

    window.location.href = `/?t=${Date.now()}`;
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

    cookiePrefsButton.addEventListener('click', event => {
      event.preventDefault();

      if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
        window.CookieConsent.openPreferences(event);
        return;
      }

      window.location.href = '/legal#cookies';
    });
  }

  function initialiseBottomMenu() {
    if (!bottomMenuButton || !menuButton || !mobileNav) {
      return;
    }

    bottomMenuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute(
        'aria-label',
        isOpen ? 'Open navigation menu' : 'Close navigation menu'
      );
      mobileNav.hidden = isOpen;
      bottomMenuButton.setAttribute('aria-expanded', String(!isOpen));
    });
  }

  function getPackageImage(item) {
    if (item.image) {
      return safeImage(item.image);
    }

    if (Array.isArray(item.gallery)) {
      const galleryItem = item.gallery.find(image => {
        if (typeof image === 'string') {
          return image.trim();
        }
        return image?.url || image?.src || image?.path || image?.thumbnail;
      });

      if (galleryItem) {
        if (typeof galleryItem === 'string') {
          return safeImage(galleryItem);
        }
        return safeImage(
          galleryItem.url || galleryItem.src || galleryItem.path || galleryItem.thumbnail
        );
      }
    }

    return fallbackImage;
  }

  function formatPrice(value) {
    if (value === null || value === undefined || value === '') {
      return 'Price not set';
    }

    const number = Number(value);
    if (Number.isFinite(number)) {
      return `£${number.toLocaleString('en-GB')}`;
    }

    return String(value);
  }

  function renderPackageCards(container, items, emptyMessage) {
    if (!container) {
      return;
    }

    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = `<article class="hv2-card"><h3>${escapeHtml(emptyMessage)}</h3><p>Check back soon or browse all suppliers.</p><a href="/suppliers">Browse suppliers</a></article>`;
      return;
    }

    container.innerHTML = `<div class="hv2-card-grid">${items
      .slice(0, 6)
      .map(item => {
        const title = escapeHtml(item.title || item.name || 'Event package');
        const supplier = escapeHtml(
          item.supplier_name || item.supplierName || 'EventFlow supplier'
        );
        const description = escapeHtml(
          item.description || 'A curated package for your next event.'
        );
        const slug = encodeURIComponent(slugValue(item.slug, item.id));
        const image = escapeHtml(getPackageImage(item));
        const price = escapeHtml(formatPrice(item.price_display || item.price));
        return `<a class="hv2-card hv2-package-card" href="/package/${slug}"><img src="${image}" alt="${title}" loading="lazy" data-fallback-src="${fallbackImage}" /><div class="hv2-package-card__body"><h3>${title}</h3><p>${description}</p><div class="hv2-package-card__meta"><span>${supplier}</span></div><div class="hv2-package-card__price">${price}</div></div></a>`;
      })
      .join('')}</div>`;
  }

  async function loadPackages(endpoint, containerId, emptyMessage) {
    const container = document.getElementById(containerId);
    if (!container) {
      return;
    }

    try {
      const response = await fetch(endpoint, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Package endpoint unavailable');
      }

      const data = await response.json();
      renderPackageCards(container, data.items || data.packages || [], emptyMessage);
    } catch {
      renderPackageCards(container, [], emptyMessage);
    }
  }

  function renderCategories() {
    if (!categoryGrid) {
      return;
    }

    categoryGrid.innerHTML = categoryFallbacks
      .map(item => {
        const url = `/suppliers?category=${encodeURIComponent(item.category)}`;
        return `<a class="hv2-category" href="${url}"><img src="${escapeHtml(item.image)}" alt="" loading="lazy" /><strong>${escapeHtml(item.name)}</strong></a>`;
      })
      .join('');
  }

  function getListingImage(listing) {
    const arrays = [listing?.images, listing?.photos];
    for (const imageArray of arrays) {
      if (Array.isArray(imageArray)) {
        const image = imageArray.find(item => typeof item === 'string' && item.trim());
        if (image) {
          return safeImage(image);
        }
      }
    }

    return safeImage(listing?.image || '/assets/images/collage-venue.jpg');
  }

  function renderMarketplace(listings) {
    if (!marketplacePreview || !Array.isArray(listings) || listings.length === 0) {
      return;
    }

    marketplacePreview.innerHTML = listings
      .slice(0, 4)
      .map(listing => {
        const title = escapeHtml(listing.title || 'Marketplace listing');
        const category = escapeHtml(listing.category || 'Marketplace');
        const location = escapeHtml(listing.location || 'UK');
        const price = escapeHtml(formatPrice(listing.price));
        const image = escapeHtml(getListingImage(listing));
        const listingUrl = listing.id
          ? `/marketplace?listing=${encodeURIComponent(listing.id)}`
          : '/marketplace';
        return `<a class="hv2-card hv2-market-card" href="${listingUrl}"><img src="${image}" alt="${title}" loading="lazy" data-fallback-src="/assets/images/collage-venue.jpg" /><div class="hv2-market-card__body"><h3>${title}</h3><p>${price}</p><div class="hv2-market-card__meta"><span>${category}</span><span>${location}</span></div></div></a>`;
      })
      .join('');
  }

  async function loadMarketplacePreview() {
    if (!marketplacePreview) {
      return;
    }

    try {
      const response = await fetch('/api/v1/marketplace/listings?limit=12');
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      renderMarketplace(data.listings || []);
    } catch {
      // Keep the static marketplace cards.
    }
  }

  async function loadGuides() {
    if (!guidesList) {
      return;
    }

    try {
      const response = await fetch('/assets/data/guides.json');
      if (!response.ok) {
        return;
      }

      const guides = await response.json();
      if (!Array.isArray(guides) || guides.length === 0) {
        return;
      }

      guidesList.innerHTML = guides
        .slice(0, 3)
        .map(guide => {
          const title = escapeHtml(guide.title || 'Event planning guide');
          const description = escapeHtml(guide.description || 'Helpful event planning advice.');
          const href = escapeHtml(guide.href || '/guides');
          const category = escapeHtml(guide.category || 'Guide');
          const mins = escapeHtml(String(guide.readingMins || 4));
          return `<article class="hv2-card"><h3>${title}</h3><p>${description}</p><span class="hv2-chip">${category}</span><span class="hv2-chip">${mins} min read</span><a href="${href}">Read guide</a></article>`;
        })
        .join('');
    } catch {
      // Keep the static guide cards.
    }
  }

  async function initialiseHeroVideo() {
    if (!heroVideo || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    try {
      const response = await fetch('/api/pexels/videos?query=event%20reception%20table&per_page=6');
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      const videos = Array.isArray(data.videos) ? data.videos : [];
      const video = videos.find(
        item => Array.isArray(item.video_files) && item.video_files.length > 0
      );
      if (!video) {
        return;
      }

      const file = video.video_files
        .filter(item => item.file_type === 'video/mp4')
        .sort((a, b) => (a.width || 0) - (b.width || 0))
        .find(item => item.width && item.width >= 640);

      if (!file || !file.link) {
        return;
      }

      heroVideo.src = file.link;
      heroVideo.play().catch(() => {
        heroVideo.removeAttribute('src');
      });
    } catch {
      // Keep the poster image fallback.
    }
  }

  function attachImageFallbacks() {
    document.addEventListener(
      'error',
      event => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.dataset.fallbackSrc) {
          return;
        }

        image.src = image.dataset.fallbackSrc;
        image.removeAttribute('data-fallback-src');
      },
      true
    );
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

      newsletterFeedback.textContent = '';

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        newsletterFeedback.textContent = 'Please enter a valid email address.';
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }

      newsletterFeedback.textContent = 'Sending confirmation email...';

      try {
        const csrfToken = await getCsrfToken();
        const response = await fetch('/api/v1/newsletter/subscribe', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({ email, source: 'home-v2' }),
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || data.message || 'Subscription failed');
        }

        newsletterForm.reset();
        newsletterFeedback.textContent =
          data.message || 'Please check your email to confirm your subscription.';
      } catch (error) {
        newsletterFeedback.textContent =
          error && error.message
            ? error.message
            : 'Could not subscribe right now. Please try again.';
      } finally {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute('aria-busy');
        }
      }
    });
  }

  initialiseAuthAwareNav();
  initialiseNotifications();
  initialiseLogout();
  initialiseCookiePreferences();
  initialiseBottomMenu();
  initialiseNewsletter();
  attachImageFallbacks();
  renderCategories();
  initialiseHeroVideo();
  loadPackages(
    '/api/packages/featured',
    'hv2-featured-packages',
    'No featured packages available yet.'
  );
  loadPackages(
    '/api/packages/spotlight',
    'hv2-spotlight-packages',
    'No spotlight packages available yet.'
  );
  loadMarketplacePreview();
  loadGuides();
})();
