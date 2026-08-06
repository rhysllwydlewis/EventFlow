/**
 * Category skeleton lifecycle companion.
 *
 * The legacy category renderer remains unchanged. This observer removes the
 * static first-paint skeleton once that renderer reaches a terminal state.
 */
(() => {
  'use strict';

  /**
   * Resolve the page elements managed by the category renderer.
   * @returns {{title: HTMLElement, hero: HTMLElement, packages: HTMLElement}|null}
   * Required elements, or null when the category shell is incomplete.
   */
  function getElements() {
    const title = document.getElementById('category-title');
    const hero = document.getElementById('category-hero-section');
    const packages = document.getElementById('package-list-container');

    return title && hero && packages ? { title, hero, packages } : null;
  }

  /**
   * Check whether a managed region still contains initial loading markup.
   * @param {HTMLElement} element Region to inspect.
   * @returns {boolean} Whether skeleton markup remains.
   */
  function hasSkeleton(element) {
    return Boolean(element.querySelector('.skeleton, .skeleton-grid'));
  }

  /**
   * Remove accessibility and diagnostic loading attributes from a region.
   * @param {HTMLElement} element Region that reached a terminal state.
   * @returns {void}
   */
  function clearLoadingAttributes(element) {
    element.removeAttribute('aria-busy');
    element.removeAttribute('data-skeleton-state');
  }

  /**
   * Reconcile the static skeleton shell with the legacy renderer's current DOM.
   * @param {{title: HTMLElement, hero: HTMLElement, packages: HTMLElement}} elements
   * Managed category elements.
   * @returns {boolean} Whether both title and package regions are resolved.
   */
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

  /**
   * Observe the legacy renderer until it replaces the first-paint skeleton.
   * @returns {void}
   */
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
