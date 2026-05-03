(function () {
  'use strict';

  function toast(msg, type) {
    if (window.Toast && typeof window.Toast.show === 'function') {
      window.Toast.show(msg, { type: type || 'info' });
      return;
    }
    if (typeof window.showNotification === 'function') {
      window.showNotification(msg, type || 'info');
    }
  }

  function socialIcon(name) {
    const icons = {
      instagram:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.8A3.95 3.95 0 0 0 3.8 7.75v8.5a3.95 3.95 0 0 0 3.95 3.95h8.5a3.95 3.95 0 0 0 3.95-3.95v-8.5a3.95 3.95 0 0 0-3.95-3.95h-8.5zm8.9 1.35a1.15 1.15 0 1 1 0 2.3 1.15 1.15 0 0 1 0-2.3zM12 6.3a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4zm0 1.8a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8z"/></svg>',
      facebook:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 22v-8.1h2.74l.43-3.18H13.5V8.69c0-.92.26-1.54 1.58-1.54h1.68V4.32c-.29-.04-1.28-.12-2.44-.12-2.41 0-4.06 1.47-4.06 4.17v2.34H7.5v3.18h2.76V22h3.24z"/></svg>',
      linkedin:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.1 8.7H2.9V21h3.2V8.7zM4.5 3A1.85 1.85 0 1 0 4.5 6.7 1.85 1.85 0 0 0 4.5 3zM21 13.95c0-3.3-1.76-5.45-4.92-5.45-2.26 0-3.27 1.24-3.84 2.11V8.7H9.04V21h3.2v-6.08c0-1.6.3-3.15 2.28-3.15 1.95 0 1.98 1.83 1.98 3.26V21H21v-7.05z"/></svg>',
    };
    return icons[name] || '';
  }

  function init() {
    const footer = document.querySelector('footer[role="contentinfo"]');
    if (!footer || footer.dataset.efFooterEnhanced === 'true') {
      return;
    }

    const year = new Date().getFullYear();
    const newsletter = document.createElement('section');
    newsletter.className = 'ef-newsletter-band';
    newsletter.setAttribute('aria-label', 'Stay Updated newsletter signup');
    newsletter.innerHTML =
      '<div class="container"><div class="ef-newsletter-copy"><h2>Stay Updated</h2><p>Get EventFlow updates, supplier insights, and planning tips.</p></div><form class="ef-newsletter-form" novalidate><label for="ef-newsletter-email" class="sr-only">Email address</label><input id="ef-newsletter-email" name="email" type="email" required placeholder="Enter your email" autocomplete="email"/><button type="submit">Subscribe</button><div class="ef-newsletter-feedback" aria-live="polite"></div></form></div>';
    footer.before(newsletter);

    footer.className = 'footer ef-footer-modern';
    footer.dataset.efFooterEnhanced = 'true';
    footer.innerHTML = `<div class="container"><div class="ef-footer-grid"><section class="ef-footer-column ef-footer-brand" aria-label="EventFlow brand"><h3>EventFlow</h3><p>Event planning made simple.</p><p>Operated by <a class="ef-vexi-link" href="https://vexi.co.uk" target="_blank" rel="noopener noreferrer">VEXI</a></p><div class="ef-footer-socials" aria-label="Social links"><a class="ef-footer-social-link" href="https://www.instagram.com/eventflowuk" aria-label="EventFlow on Instagram" target="_blank" rel="noopener noreferrer">${socialIcon('instagram')}</a><a class="ef-footer-social-link" href="https://www.facebook.com/eventflowuk" aria-label="EventFlow on Facebook" target="_blank" rel="noopener noreferrer">${socialIcon('facebook')}</a><a class="ef-footer-social-link" href="https://www.linkedin.com/company/eventflowuk" aria-label="EventFlow on LinkedIn" target="_blank" rel="noopener noreferrer">${socialIcon('linkedin')}</a></div></section><nav class="ef-footer-column" aria-label="Platform"><h4>Platform</h4><ul class="ef-footer-links"><li><a href="/">Home</a></li><li><a href="/suppliers">Suppliers</a></li><li><a href="/marketplace">Marketplace</a></li><li><a href="/pricing">Pricing</a></li></ul></nav><nav class="ef-footer-column" aria-label="Resources"><h4>Resources</h4><ul class="ef-footer-links"><li><a href="/guides">Guides</a></li><li><a href="/for-suppliers">For Suppliers</a></li><li><a href="/contact">Contact</a></li></ul></nav><nav class="ef-footer-column" aria-label="Legal"><h4>Legal</h4><ul class="ef-footer-links"><li><a href="/legal">Legal Hub</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/terms">Terms</a></li></ul></nav></div><div class="ef-footer-bottom"><span>© ${year} EventFlow. All rights reserved.</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <button type="button" class="ef-cookie-link">Cookie preferences</button></span></div></div>`;

    const cookieButton = footer.querySelector('.ef-cookie-link');
    if (cookieButton) {
      cookieButton.addEventListener('click', () => {
        if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
          window.CookieConsent.openPreferences();
        } else {
          window.location.href = '/legal#cookies';
        }
      });
    }

    const form = newsletter.querySelector('form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const input = form.querySelector('input[name="email"]');
      const feedback = form.querySelector('.ef-newsletter-feedback');
      const email = (input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        feedback.textContent = 'Please enter a valid email address.';
        input.focus();
        return;
      }
      feedback.textContent = 'Subscribing…';
      try {
        const response = await fetch('/api/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email }),
        });
        if (!response.ok) {
          throw new Error('subscribe failed');
        }
        feedback.textContent = 'Thanks for subscribing!';
        form.reset();
        toast('Subscribed successfully', 'success');
      } catch (error) {
        feedback.textContent = 'Could not subscribe right now. Please try again.';
        toast('Subscription failed', 'error');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
