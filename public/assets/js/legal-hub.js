/**
 * Legal Hub (/legal): keeps the highlighted contents entry in view.
 *
 * On a phone the contents list is a single scrolling row of chips pinned under
 * the header (see legal-hub.css). legal-pages.js moves aria-current as you read;
 * this follows it so the highlighted chip is never off-screen. Without
 * JavaScript the row still scrolls and every link still works.
 */
'use strict';

(function () {
  const list = document.querySelector('.lh-page .legal-toc ul');
  if (!list || typeof MutationObserver === 'undefined' || !window.matchMedia) {
    return;
  }

  const narrow = window.matchMedia('(max-width: 860px)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function reveal(link) {
    // Wide screens use a vertical list that scrolls itself; only act on the row.
    if (!narrow.matches || list.scrollWidth <= list.clientWidth) {
      return;
    }
    const target = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
    list.scrollTo({
      left: Math.max(0, target),
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
    });
  }

  new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      const link = mutation.target;
      if (link.getAttribute('aria-current') === 'true') {
        reveal(link);
      }
    });
  }).observe(list, { attributes: true, attributeFilter: ['aria-current'], subtree: true });

  const current = list.querySelector('a[aria-current="true"]');
  if (current) {
    reveal(current);
  }
})();
