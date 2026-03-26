/**
 * Global CSP-safe image error handler.
 *
 * Replaces inline onerror="..." attributes (which are blocked by the
 * script-src-attr 'none' CSP directive) with a delegated, capture-phase
 * error listener on document.
 *
 * Supported data attributes on <img> elements:
 *
 *   data-fallback-src="url"      – swap src to this URL on error
 *   data-fallback-hide           – hide the image (display:'none') on error
 *   data-fallback-show-next      – also un-hide the next sibling element
 *                                  (used when a fallback div follows the img)
 *   data-fallback-action="attachment-error"
 *                               – display messenger attachment error UI
 *                                  (hides img, appends error label/hint span)
 *
 * The handler is registered once and ignores subsequent errors on the same
 * element via the data-fallback-applied guard.
 */
(function () {
  'use strict';

  function handleImageError(e) {
    var img = e.target;
    if (!img || img.tagName !== 'IMG') return;
    if (img.dataset.fallbackApplied) return;
    img.dataset.fallbackApplied = 'true';

    var action = img.dataset.fallbackAction;

    if (action === 'attachment-error') {
      // Messenger attachment image — hide img and render error UI
      img.style.display = 'none';
      img.classList.add('messenger-v4__attachment-error');
      if (img.parentNode) {
        var w = document.createElement('span');
        w.className = 'messenger-v4__attachment-error-label';
        w.title = 'Image unavailable';
        var l = document.createElement('span');
        l.textContent = 'Image unavailable';
        var h = document.createElement('span');
        h.className = 'messenger-v4__attachment-error-hint';
        h.textContent = 'The file may have been removed';
        w.appendChild(l);
        w.appendChild(h);
        img.parentNode.appendChild(w);
      }
      return;
    }

    var fallbackSrc = img.dataset.fallbackSrc;
    if (fallbackSrc) {
      img.src = fallbackSrc;
      return;
    }

    if ('fallbackHide' in img.dataset) {
      img.style.display = 'none';
      if ('fallbackShowNext' in img.dataset && img.nextElementSibling) {
        img.nextElementSibling.style.display = 'flex';
      }
    }
  }

  document.addEventListener('error', handleImageError, true);
})();
