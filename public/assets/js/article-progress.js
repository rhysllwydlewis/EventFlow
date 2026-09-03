/**
 * Article reading progress bar + back-to-top button + reading time estimate
 * Shared across all article pages. Extracted from per-article inline scripts.
 */
'use strict';
(function () {
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

  // ── Reading time estimate ──────────────────────────────────────────────
  // Inject a "X min read" badge into the article if there is a target element.
  // Articles should have <span id="article-reading-time"></span> in their byline.
  // If not present, we insert one next to the first <time> element in the article.
  (function initReadingTime() {
    const WORDS_PER_MINUTE = 238; // average adult reading speed

    // Grab article body text
    const articleEl =
      document.querySelector('article') ||
      document.querySelector('.article-body') ||
      document.querySelector('[itemprop="articleBody"]') ||
      document.querySelector('main');

    if (!articleEl) {
      return;
    }

    const text = articleEl.innerText || articleEl.textContent || '';
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    const minutes = Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
    const label = `${minutes} min read`;

    // Find or create the target element
    let target = document.getElementById('article-reading-time');

    if (!target) {
      // Try to insert after the first <time> element in the article
      const timeEl =
        articleEl.querySelector('time') ||
        document.querySelector('.article-meta time') ||
        document.querySelector('.guide-meta time');
      if (timeEl) {
        target = document.createElement('span');
        target.id = 'article-reading-time';
        target.className = 'article-reading-time';
        timeEl.parentNode.insertBefore(target, timeEl.nextSibling);
      }
    }

    if (target) {
      target.textContent = label;
      target.setAttribute('aria-label', `Estimated reading time: ${minutes} minutes`);
    }
  })();
})();
