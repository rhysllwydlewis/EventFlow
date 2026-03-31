/**
 * Article reading progress bar + back-to-top button
 * Shared across all article pages. Extracted from per-article inline scripts.
 */
(function () {
  'use strict';

  const bar = document.getElementById('article-progress-bar');
  const backTop = document.getElementById('article-back-to-top');

  if (!bar && !backTop) {
    return;
  }

  function updateProgress() {
    const doc = document.documentElement;
    const scrollTop = doc.scrollTop || document.body.scrollTop;
    const totalHeight = doc.scrollHeight - doc.clientHeight;
    const pct = totalHeight > 0 ? Math.min(100, Math.round((scrollTop / totalHeight) * 100)) : 0;

    if (bar) {
      bar.style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', pct);
    }

    if (backTop) {
      backTop.classList.toggle('visible', scrollTop > 500);
    }
  }

  window.addEventListener('scroll', updateProgress, { passive: true });

  if (backTop) {
    backTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
})();
