/**
 * Category skeleton lifecycle companion.
 *
 * The legacy category renderer remains unchanged. This observer removes the
 * static first-paint skeleton once that renderer reaches a terminal state.
 */
(function () {
  'use strict';

  function getElements() {
    const elements = {
      title: document.getElementById('category-title'),
      hero: document.getElementById('category-hero-section'),
      packages: document.getElementById('package-list-container'),
    };

    return elements.title && elements.hero && elements.packages ? elements : null;
  }

  function hasSkeleton(element) {
    return Boolean(element.querySelector('.skeleton, .skeleton-grid'));
  }

  function clearLoadingAttributes(element) {
    element.removeAttribute('aria-busy');
    element.removeAttribute('data-skeleton-state');
  }

  function settle(elements) {
    const titleResolved = !hasSkeleton(elements.title);
    const packagesResolved = !hasSkeleton(elements.packages);

    if (titleResolved) {
      clearLoadingAttributes(elements.title);
      if (!elements.hero.querySelector('.category-hero-img-wrap')) {
        elements.hero.replaceChildren();
      }
      clearLoadingAttributes(elements.hero);
    }

    if (packagesResolved) {
      clearLoadingAttributes(elements.packages);
    }

    return titleResolved && packagesResolved;
  }

  function initialise() {
    const elements = getElements();
    if (!elements || settle(elements)) {
      return;
    }

    const observer = new MutationObserver(() => {
      if (settle(elements)) {
        observer.disconnect();
      }
    });

    observer.observe(elements.title, { childList: true, subtree: true });
    observer.observe(elements.hero, { childList: true, subtree: true });
    observer.observe(elements.packages, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialise, { once: true });
  } else {
    initialise();
  }
})();
