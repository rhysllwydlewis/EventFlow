/**
 * Article reading progress bar + back-to-top button
 * Shared across all article pages. Extracted from per-article inline scripts.
 */
(function () {
  'use strict';

  var bar = document.getElementById('article-progress-bar');
  var backTop = document.getElementById('article-back-to-top');

  if (!bar && !backTop) return;

  function updateProgress() {
    var doc = document.documentElement;
    var scrollTop = doc.scrollTop || document.body.scrollTop;
    var totalHeight = doc.scrollHeight - doc.clientHeight;
    var pct = totalHeight > 0 ? Math.min(100, Math.round((scrollTop / totalHeight) * 100)) : 0;

    if (bar) {
      bar.style.width = pct + '%';
      bar.setAttribute('aria-valuenow', pct);
    }

    if (backTop) {
      backTop.classList.toggle('visible', scrollTop > 500);
    }
  }

  window.addEventListener('scroll', updateProgress, { passive: true });

  if (backTop) {
    backTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
})();
