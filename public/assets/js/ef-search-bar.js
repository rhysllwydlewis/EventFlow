/**
 * EventFlow Unified Search Bar
 * Handles form submission and quick tag clicks
 */

class EFSearchBar {
  constructor() {
    this.form = document.querySelector('.ef-search-bar__form');
    this.input = document.querySelector('.ef-search-bar__input');
    this.select = document.querySelector('.ef-search-bar__select');
    this.quickTagsContainer = document.querySelector('.ef-quick-tags');
    this.quickTags = document.querySelectorAll('.ef-quick-tags__tag');

    if (this.form) {
      this.init();
    }
  }

  init() {
    // Form submission
    this.form.addEventListener('submit', e => this.handleSubmit(e));

    // Quick tag clicks
    this.quickTags.forEach(tag => {
      tag.addEventListener('click', e => this.handleTagClick(e));
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => this.handleKeydown(e));

    // Keep quick tags on one line and hide only if space is actually tight
    this.balanceQuickTags();
    window.addEventListener('resize', () => this.scheduleQuickTagBalance());

    // Measured again once web fonts are in, since they change the tags' widths
    document.fonts?.ready?.then(() => this.scheduleQuickTagBalance());
  }

  scheduleQuickTagBalance() {
    if (this.quickTagBalanceFrame) {
      cancelAnimationFrame(this.quickTagBalanceFrame);
    }

    this.quickTagBalanceFrame = requestAnimationFrame(() => {
      this.balanceQuickTags();
    });
  }

  balanceQuickTags() {
    if (!this.quickTagsContainer || !this.quickTags.length) {
      return;
    }

    // Mobile already hides the quick tags in CSS
    if (window.matchMedia('(max-width: 639px)').matches) {
      return;
    }

    // Reset all tags first so they can reappear when there is enough room
    this.quickTags.forEach(tag => {
      tag.style.display = '';
      tag.removeAttribute('aria-hidden');
      tag.disabled = false;
      tag.tabIndex = 0;
    });

    // Hide trailing tags only when required to keep a single-row layout
    for (let i = this.quickTags.length - 1; i >= 0; i -= 1) {
      if (this.quickTagsContainer.scrollWidth <= this.quickTagsContainer.clientWidth + 1) {
        break;
      }

      const tag = this.quickTags[i];
      tag.style.display = 'none';
      tag.setAttribute('aria-hidden', 'true');
      tag.disabled = true;
      tag.tabIndex = -1;
    }
  }

  handleSubmit(e) {
    const query = this.input.value.trim();
    const category = this.select ? this.select.value : '';

    // Allow submission with either query or category
    // If neither is provided, prevent empty search
    if (!query && !category) {
      e.preventDefault();
      this.input.focus();
      return;
    }

    // Track search event (don't block submission if it fails)
    this.trackSearch(query, category).catch(err => {
      console.debug('Analytics tracking failed:', err);
    });

    // Form will submit naturally with query and/or category parameters
  }

  async trackSearch(query, category) {
    try {
      // Get CSRF token from cookie
      const token = this.getCsrfToken();

      await fetch('/api/v1/analytics/event', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'X-CSRF-Token': token }),
        },
        body: JSON.stringify({
          event: 'search_performed',
          properties: {
            query: query || '',
            category: category || '',
            source: 'homepage',
          },
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      // Fail silently - analytics should never block UX
      console.debug('Analytics tracking error:', error);
    }
  }

  getCsrfToken() {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf') {
        return value;
      }
    }
    return null;
  }

  handleTagClick(e) {
    const tag = e.currentTarget;
    const searchTerm = tag.dataset.search;

    if (searchTerm) {
      this.input.value = searchTerm;
      this.form.submit();
    }
  }

  handleKeydown(e) {
    // Cmd/Ctrl + K to focus search
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      this.input.focus();
      this.input.select();
    }
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new EFSearchBar();
});
