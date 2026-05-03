(function () {
  'use strict';

  function navIcon(type) {
    const icons = {
      platform: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>',
      resources: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>',
      legal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>',
    };
    return icons[type] || '';
  }

  function socialIcon(type) {
    const icons = {
      instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r=".5" fill="currentColor"></circle></svg>',
      facebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path></svg>',
      linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"></path><rect x="2" y="9" width="4" height="12"></rect><circle cx="4" cy="4" r="2"></circle></svg>',
    };
    return icons[type] || '';
  }

  function footerWaves() {
    return '<svg class="ef-footer-waves" viewBox="0 0 440 260" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M440 180 Q340 130 230 175 T30 160 T-40 180" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" fill="none"></path><path d="M440 210 Q320 165 210 210 T10 195 T-40 210" stroke="rgba(255,255,255,0.05)" stroke-width="1.5" fill="none"></path><path d="M440 238 Q300 200 195 238 T-5 228 T-40 240" stroke="rgba(255,255,255,0.04)" stroke-width="1.5" fill="none"></path></svg>';
  }

  function removeLegacyNewsletterBlocks(footer) {
    document.querySelectorAll('.ef-newsletter-band, .ef-nl-wrap').forEach(function (block) {
      if (!footer.contains(block)) block.remove();
    });
  }

  function renderFooterHtml(year) {
    return footerWaves() + '<div class="ef-footer-inner"><div class="ef-footer-brand"><a href="/" class="ef-brand-logo" aria-label="EventFlow home"><span class="ef-brand-logo-name">EventFlow</span></a><p class="ef-brand-tagline">Event planning made simple.</p><p class="ef-brand-operated">Operated by <a href="https://vexi.co.uk" target="_blank" rel="noopener noreferrer">VEXI</a></p><div class="ef-socials"><a href="https://www.instagram.com/eventflowuk" class="ef-social-link" aria-label="EventFlow on Instagram" target="_blank" rel="noopener noreferrer">' + socialIcon('instagram') + '</a><a href="https://www.facebook.com/eventflowuk" class="ef-social-link" aria-label="EventFlow on Facebook" target="_blank" rel="noopener noreferrer">' + socialIcon('facebook') + '</a><a href="https://www.linkedin.com/company/eventflowuk" class="ef-social-link" aria-label="EventFlow on LinkedIn" target="_blank" rel="noopener noreferrer">' + socialIcon('linkedin') + '</a></div></div><nav class="ef-footer-nav" aria-label="Platform links"><div class="ef-nav-head"><div class="ef-nav-head-icon">' + navIcon('platform') + '</div><span class="ef-nav-head-label">Platform</span></div><ul class="ef-nav-list"><li><a href="/start">Plan an Event</a></li><li><a href="/suppliers">Browse Suppliers</a></li><li><a href="/marketplace">Marketplace</a></li><li><a href="/pricing">Pricing</a></li></ul></nav><nav class="ef-footer-nav" aria-label="Resources links"><div class="ef-nav-head"><div class="ef-nav-head-icon">' + navIcon('resources') + '</div><span class="ef-nav-head-label">Resources</span></div><ul class="ef-nav-list"><li><a href="/guides">Guides</a></li><li><a href="/faq">FAQ</a></li><li><a href="/for-suppliers">For Suppliers</a></li><li><a href="/contact">Contact</a></li></ul></nav><nav class="ef-footer-nav" aria-label="Legal links"><div class="ef-nav-head"><div class="ef-nav-head-icon">' + navIcon('legal') + '</div><span class="ef-nav-head-label">Legal</span></div><ul class="ef-nav-list"><li><a href="/legal">Legal Hub</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/terms">Terms of Service</a></li><li><button type="button" class="ef-cookie-link" data-cookie-prefs>Cookie preferences</button></li></ul></nav></div><div class="ef-footer-bar"><div class="ef-footer-bar-inner"><p>© 2025–' + year + ' EventFlow. All rights reserved.</p></div></div>';
  }

  function bindCookiePreferences(footer) {
    footer.querySelectorAll('[data-cookie-prefs]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        if (window.CookieConsent && typeof window.CookieConsent.openPreferences === 'function') {
          window.CookieConsent.openPreferences(event);
          return;
        }
        window.location.href = '/legal#cookies';
      });
    });
  }

  function init() {
    const footer = document.querySelector('footer[role="contentinfo"]');
    if (!footer || footer.dataset.efFooterEnhanced === 'true') return;
    removeLegacyNewsletterBlocks(footer);
    footer.className = 'ef-footer-premium';
    footer.dataset.efFooterEnhanced = 'true';
    footer.innerHTML = renderFooterHtml(new Date().getFullYear());
    bindCookiePreferences(footer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
