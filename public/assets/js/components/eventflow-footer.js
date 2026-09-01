(function () {
  'use strict';

  const toast = (message, type) => {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type || 'info');
      return;
    }
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type || 'info');
    }
  };

  const mailIcon = size => `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="${size || 24}" height="${size || 24}">
      <rect x="2" y="4" width="20" height="16" rx="3"></rect><path d="M2 8l10 6 10-6"></path>
    </svg>`;

  const navIcon = type => {
    const icons = {
      platform:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>',
      resources:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
      legal:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
      account:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg>',
    };
    return icons[type] || '';
  };

  const socialIcon = type => {
    const icons = {
      instagram:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r=".5" fill="currentColor"></circle></svg>',
      facebook:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>',
      linkedin:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>',
    };
    return icons[type] || '';
  };

  const footerWaves = () =>
    '<svg class="ef-footer-waves" viewBox="0 0 440 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M440 180 Q340 130 230 175 T30 160 T-40 180" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" fill="none"></path><path d="M440 210 Q320 165 210 210 T10 195 T-40 210" stroke="rgba(255,255,255,0.05)" stroke-width="1.5" fill="none"></path><path d="M440 238 Q300 200 195 238 T-5 228 T-40 240" stroke="rgba(255,255,255,0.04)" stroke-width="1.5" fill="none"></path></svg>';

  const isHomepage = () => Boolean(document.querySelector('.home-category-section'));

  const loadHomepageAssets = () => {
    if (!isHomepage()) {
      return;
    }
    if (!document.querySelector('link[href*="homepage-approved-lower.css"]')) {
      const style = document.createElement('link');
      style.id = 'ef-approved-homepage-lower-styles';
      style.rel = 'stylesheet';
      style.href = '/assets/css/homepage-approved-lower.css?v=3';
      document.head.appendChild(style);
    }
    if (!document.querySelector('script[src*="homepage-approved-lower.js"]')) {
      const script = document.createElement('script');
      script.id = 'ef-approved-homepage-lower-script';
      script.src = '/assets/js/pages/homepage-approved-lower.js?v=3';
      document.head.appendChild(script);
    }
  };

  const isLegacyNewsletterBlock = (block, footer) => {
    if (!block || footer.contains(block)) {
      return false;
    }
    return (
      /Stay Updated/.test(block.textContent || '') &&
      /latest event planning tips/.test(block.textContent || '')
    );
  };

  const removeLegacyNewsletterBlocks = footer => {
    document
      .querySelectorAll('.ef-newsletter-band, body > .ef-nl-wrap, main .ef-nl-wrap')
      .forEach(block => {
        if (
          isLegacyNewsletterBlock(block, footer) ||
          block.classList.contains('ef-newsletter-band')
        ) {
          block.remove();
        }
      });

    document.querySelectorAll('main section, main div').forEach(block => {
      if (isLegacyNewsletterBlock(block, footer)) {
        const next = block.nextElementSibling;
        block.remove();
        if (next?.classList.contains('ef-section--gradient')) {
          next.remove();
        }
      }
    });
  };

  const renderNewsletter = homepage => `
    <section class="ef-nl-wrap" aria-label="Stay Updated newsletter signup">
      <div class="ef-nl-card">
        <div class="ef-nl-left">
          <div class="ef-nl-icon">${mailIcon(28)}</div>
          <div class="ef-nl-copy"><h2>Stay Updated</h2><p>Get the latest event planning tips, supplier spotlights, and special offers delivered to your inbox.</p></div>
        </div>
        <div class="ef-nl-divider" aria-hidden="true"></div>
        <div class="ef-nl-right">
          <form class="ef-nl-row" novalidate>
            <label class="ef-nl-input-wrap" for="ef-footer-email">${mailIcon(18)}<span class="ef-footer-sr-only">Email address</span><input id="ef-footer-email" name="email" type="email" placeholder="Enter your email address" autocomplete="email" required></label>
            <button class="ef-nl-btn" type="submit">Subscribe</button>
          </form>
          <p class="ef-nl-note">${homepage ? 'No spam, ever. Unsubscribe at any time.' : 'We respect your privacy. Unsubscribe at any time.'}</p>
          <p class="ef-nl-feedback" aria-live="polite"></p>
        </div>
      </div>
    </section>`;

  const renderFooterHtml = (year, homepage) => {
    const accountColumn = homepage
      ? `<nav class="ef-footer-nav" aria-label="Account links"><div class="ef-nav-head"><div class="ef-nav-head-icon">${navIcon('account')}</div><span class="ef-nav-head-label">Account</span></div><ul class="ef-nav-list"><li><a href="/auth">Log in</a></li><li><a href="/dashboard">Dashboard</a></li></ul></nav>`
      : '';
    const tagline = homepage
      ? 'Everything you need to plan amazing events.'
      : 'Event planning made simple.';

    return `${footerWaves()}${renderNewsletter(homepage)}
      <div class="ef-footer-inner">
        <div class="ef-footer-brand">
          <a href="/" class="ef-brand-logo" aria-label="EventFlow home"><span class="ef-brand-logo-name">EventFlow</span></a>
          <p class="ef-brand-tagline">${tagline}</p>
          <p class="ef-brand-operated">Operated by <a href="https://vexi.co.uk" target="_blank" rel="noopener noreferrer">VEXI</a></p>
          <div class="ef-socials">
            <a href="https://www.instagram.com/eventflowuk" class="ef-social-link" aria-label="EventFlow on Instagram" target="_blank" rel="noopener noreferrer">${socialIcon('instagram')}</a>
            <a href="https://www.facebook.com/eventflowuk" class="ef-social-link" aria-label="EventFlow on Facebook" target="_blank" rel="noopener noreferrer">${socialIcon('facebook')}</a>
            <a href="https://www.linkedin.com/company/eventflowuk" class="ef-social-link" aria-label="EventFlow on LinkedIn" target="_blank" rel="noopener noreferrer">${socialIcon('linkedin')}</a>
          </div>
        </div>
        <nav class="ef-footer-nav" aria-label="Platform links"><div class="ef-nav-head"><div class="ef-nav-head-icon">${navIcon('platform')}</div><span class="ef-nav-head-label">Platform</span></div><ul class="ef-nav-list"><li><a href="/start">Plan an Event</a></li><li><a href="/suppliers">Browse Suppliers</a></li><li><a href="/community">Community</a></li><li><a href="/marketplace">Marketplace</a></li><li><a href="/pricing">Pricing</a></li></ul></nav>
        <nav class="ef-footer-nav" aria-label="Resources links"><div class="ef-nav-head"><div class="ef-nav-head-icon">${navIcon('resources')}</div><span class="ef-nav-head-label">Resources</span></div><ul class="ef-nav-list"><li><a href="/guides">Guides</a></li><li><a href="/faq">Help &amp; FAQ</a></li><li><a href="/for-suppliers">For Suppliers</a></li><li><a href="/contact">Contact</a></li></ul></nav>
        <nav class="ef-footer-nav" aria-label="Legal links"><div class="ef-nav-head"><div class="ef-nav-head-icon">${navIcon('legal')}</div><span class="ef-nav-head-label">Legal</span></div><ul class="ef-nav-list"><li><a href="/legal">Legal Hub</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms of Service</a></li><li><button type="button" class="ef-cookie-link" data-cookie-prefs>Cookie preferences</button></li></ul></nav>
        ${accountColumn}
      </div>
      <div class="ef-footer-bar"><div class="ef-footer-bar-inner"><p>© 2025–${year} EventFlow. All rights reserved.</p></div></div>`;
  };

  const bindNewsletter = footer => {
    const form = footer.querySelector('.ef-nl-row');
    const input = footer.querySelector('input[name="email"]');
    const button = footer.querySelector('.ef-nl-btn');
    const feedback = footer.querySelector('.ef-nl-feedback');
    if (!form || !input || !button || !feedback) {
      return;
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const email = (input.value || '').trim();
      feedback.className = 'ef-nl-feedback';
      feedback.textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        feedback.classList.add('is-error');
        feedback.textContent = 'Please enter a valid email address.';
        input.focus();
        return;
      }

      button.disabled = true;
      button.textContent = 'Subscribing…';
      feedback.textContent = 'Sending confirmation email…';
      try {
        let csrfToken = '';
        try {
          const csrfRes = await fetch('/api/v1/csrf-token', { credentials: 'include' });
          if (csrfRes.ok) {
            const csrfData = await csrfRes.json();
            csrfToken = csrfData.csrfToken || csrfData.token || '';
          }
        } catch (_) {
          // Newsletter subscription can continue without a CSRF token when the endpoint permits it.
        }

        const response = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
          },
          body: JSON.stringify({ email, source: 'footer' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || data.message || 'Subscription failed');
        }
        form.reset();
        feedback.classList.add('is-success');
        feedback.textContent =
          data.message || 'Please check your email to confirm your subscription.';
        toast('Please check your email to confirm your subscription.', 'success');
      } catch (error) {
        feedback.classList.add('is-error');
        feedback.textContent =
          error && error.message
            ? error.message
            : 'Could not subscribe right now. Please try again.';
        toast('Subscription failed', 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Subscribe';
      }
    });
  };

  const bindCookiePreferences = footer => {
    footer.querySelectorAll('[data-cookie-prefs]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
          window.CookieConsent.openPreferences(event);
          return;
        }
        window.location.href = '/legal#cookies';
      });
    });
  };

  const init = () => {
    const homepage = isHomepage();
    if (homepage) {
      loadHomepageAssets();
    }

    const footer = document.querySelector('footer[role="contentinfo"]');
    if (!footer || footer.dataset.efFooterEnhanced === 'true') {
      return;
    }
    removeLegacyNewsletterBlocks(footer);
    footer.className = 'ef-footer-premium';
    if (homepage) {
      footer.classList.add('ef-approved-home-footer');
    }
    footer.dataset.efFooterEnhanced = 'true';
    footer.innerHTML = renderFooterHtml(new Date().getFullYear(), homepage);
    bindNewsletter(footer);
    bindCookiePreferences(footer);
  };

  loadHomepageAssets();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
