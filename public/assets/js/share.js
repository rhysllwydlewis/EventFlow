/**
 * Share Functionality (P3-25: Share Listing Button)
 * Provides share functionality for listings (suppliers, packages, etc.)
 */

'use strict';
(function () {
  /**
   * Share a URL using Web Share API or fallback to clipboard
   * @param {Object} options - Share options
   * @param {string} options.title - Title to share
   * @param {string} options.text - Description text
   * @param {string} options.url - URL to share (defaults to current page)
   */
  async function shareUrl(options = {}) {
    const { title = document.title, text = '', url = window.location.href } = options;

    // Check if Web Share API is available
    if (navigator.share) {
      try {
        await navigator.share({
          title,
          text,
          url,
        });
        return { success: true, method: 'native' };
      } catch (error) {
        // User cancelled or error occurred
        if (error.name === 'AbortError') {
          return { success: false, cancelled: true };
        }
        console.debug('Share API error:', error);
        // Fall through to clipboard fallback
      }
    }

    // Fallback: Copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      return { success: true, method: 'clipboard' };
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return { success: false, error: 'Failed to copy link' };
    }
  }

  /**
   * Create a share button for a listing
   * @param {Object} options - Button options
   * @param {string} options.title - Title to share
   * @param {string} options.text - Description text
   * @param {string} options.url - URL to share
   * @param {string} options.buttonText - Button text (default: 'Share')
   * @param {string} options.buttonClass - Additional CSS classes
   * @param {Function} options.onSuccess - Callback on successful share
   * @param {Function} options.onError - Callback on error
   * @returns {HTMLButtonElement} The share button element
   */
  function createShareButton(options = {}) {
    const {
      title = document.title,
      text = '',
      url = window.location.href,
      buttonText = 'Share',
      buttonClass = '',
      onSuccess = null,
      onError = null,
    } = options;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `ef-share-button ${buttonClass}`.trim();
    button.innerHTML = `
      <svg class="ef-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="18" cy="5" r="3"/>
        <circle cx="6" cy="12" r="3"/>
        <circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>
      <span>${buttonText}</span>
    `;
    button.setAttribute('aria-label', `Share ${title}`);

    let resetTimeout = null;

    button.addEventListener('click', async () => {
      button.disabled = true;

      const result = await shareUrl({ title, text, url });

      if (result.success) {
        // Show success feedback
        const originalHTML = button.innerHTML;
        button.innerHTML = `
          <svg class="ef-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>${result.method === 'clipboard' ? 'Link copied!' : 'Shared!'}</span>
        `;

        if (onSuccess) {
          onSuccess(result);
        }

        // Clear any existing timeout
        if (resetTimeout) {
          clearTimeout(resetTimeout);
        }

        // Reset button after 2 seconds
        resetTimeout = setTimeout(() => {
          button.innerHTML = originalHTML;
          button.disabled = false;
          resetTimeout = null;
        }, 2000);
      } else if (!result.cancelled) {
        // Show error feedback
        if (onError) {
          onError(result.error);
        } else {
          alert(result.error || 'Failed to share');
        }
        button.disabled = false;
      } else {
        // User cancelled
        button.disabled = false;
      }
    });

    return button;
  }

  /**
   * Initialize share buttons on the page
   * Looks for elements with data-share attribute
   */
  function initShareButtons() {
    const shareElements = document.querySelectorAll('[data-share]');

    shareElements.forEach(element => {
      const title = element.dataset.shareTitle || document.title;
      const text = element.dataset.shareText || '';
      const url = element.dataset.shareUrl || window.location.href;
      const buttonText = element.dataset.shareButtonText || 'Share';

      // Replace element with share button
      const button = createShareButton({
        title,
        text,
        url,
        buttonText,
        buttonClass: element.className,
      });

      element.parentNode.replaceChild(button, element);
    });
  }

  // Auto-initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initShareButtons);
  } else {
    initShareButtons();
  }

  // Export functions
  window.EFShare = {
    shareUrl,
    createShareButton,
    initShareButtons,
  };
})();
