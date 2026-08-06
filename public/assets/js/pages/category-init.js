/**
 * Category page initialization script.
 * Loads category details and packages while preserving the static skeleton shell.
 */

window.__EF_PAGE__ = 'category';

const SKELETON_LOADER_URL = '/assets/js/utils/skeleton-loader.js';
const CATEGORY_NOT_FOUND = 'Category not found';

/**
 * Collect the required category page elements.
 * @returns {Object|null} Page element map, or null when the shell is incomplete.
 */
function getCategoryElements() {
  const elements = {
    title: document.getElementById('category-title'),
    description: document.getElementById('category-description'),
    breadcrumb: document.getElementById('breadcrumb-category'),
    hero: document.getElementById('category-hero-section'),
    packages: document.getElementById('package-list-container'),
  };

  return elements.title &&
    elements.description &&
    elements.breadcrumb &&
    elements.hero &&
    elements.packages
    ? elements
    : null;
}

/**
 * Return only same-origin or HTTP(S) image URLs.
 * @param {*} url Candidate image URL.
 * @returns {string} A safe URL or an empty string.
 */
function sanitizeCategoryImageUrl(url) {
  const value = String(url ?? '').trim();
  return /^https?:\/\//i.test(value) || value.startsWith('/') ? value : '';
}

/**
 * Create one decorative skeleton element.
 * @param {string} className Skeleton classes.
 * @returns {HTMLElement} Skeleton element.
 */
function createSkeletonElement(className) {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  return element;
}

/**
 * Restore the category page's loading composition, including retry states.
 * @param {Object} elements Page element map.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @returns {void}
 */
function renderCategoryLoading(elements, skeletons) {
  const screenReaderText = document.createElement('span');
  screenReaderText.className = 'sr-only';
  screenReaderText.textContent = 'Loading category';

  elements.title.replaceChildren(
    createSkeletonElement('skeleton skeleton-title category-title-skeleton'),
    screenReaderText
  );
  elements.title.setAttribute('aria-busy', 'true');
  elements.description.replaceChildren(
    createSkeletonElement('skeleton skeleton-text skeleton-text-medium')
  );

  const heroSkeleton = document.createElement('div');
  heroSkeleton.className = 'skeleton skeleton-media skeleton-media--event';
  heroSkeleton.setAttribute('aria-hidden', 'true');
  elements.hero.replaceChildren(heroSkeleton);
  elements.hero.setAttribute('aria-busy', 'true');

  skeletons.showSkeleton(elements.packages, 'packageCard', { count: 6 });
}

/**
 * Remove loading semantics after a terminal page state is rendered.
 * @param {Object} elements Page element map.
 * @returns {void}
 */
function clearCategoryLoading(elements) {
  elements.title.removeAttribute('aria-busy');
  elements.hero.removeAttribute('aria-busy');
  elements.packages.removeAttribute('aria-busy');
  elements.packages.removeAttribute('data-skeleton-state');
}

/**
 * Render the optional category hero using DOM APIs only.
 * @param {HTMLElement} hero Hero mount.
 * @param {Object} category Category view model.
 * @returns {void}
 */
function renderCategoryHero(hero, category) {
  const imageUrl = sanitizeCategoryImageUrl(category.heroImage);
  hero.replaceChildren();
  if (!imageUrl) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'category-hero-img-wrap';

  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = String(category.name || 'Category');
  image.className = 'category-hero-img';

  const overlay = document.createElement('div');
  overlay.className = 'category-hero-overlay';

  const heading = document.createElement('h1');
  heading.className = 'category-hero-title';
  heading.textContent = category.icon
    ? `${String(category.icon)} ${String(category.name || '')}`
    : String(category.name || 'Category');

  overlay.appendChild(heading);
  wrapper.append(image, overlay);
  hero.appendChild(wrapper);
}

/**
 * Render the state used when the category slug is missing.
 * @param {Object} elements Page element map.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @returns {void}
 */
function renderMissingCategory(elements, skeletons) {
  elements.title.textContent = CATEGORY_NOT_FOUND;
  elements.description.textContent = '';
  elements.breadcrumb.textContent = CATEGORY_NOT_FOUND;
  elements.hero.replaceChildren();
  clearCategoryLoading(elements);
  skeletons.showEmptyState(elements.packages, {
    icon: '📦',
    title: CATEGORY_NOT_FOUND,
    description: 'The category link is incomplete or no longer available.',
    actionText: 'Return home',
    actionHref: '/',
  });
}

/**
 * Convert an unknown caught value into a stable category error message.
 * @param {*} error Caught value.
 * @returns {string} Normalized message.
 */
function getCategoryErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Unable to load category';
}

/**
 * Render a retryable category request or component failure.
 * @param {Object} elements Page element map.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @param {*} error Caught value.
 * @returns {void}
 */
function renderCategoryFailure(elements, skeletons, error) {
  const missing = getCategoryErrorMessage(error) === CATEGORY_NOT_FOUND;
  elements.title.textContent = missing ? CATEGORY_NOT_FOUND : 'Unable to load category';
  elements.description.textContent = '';
  elements.hero.replaceChildren();
  clearCategoryLoading(elements);
  skeletons.showErrorState(elements.packages, {
    title: missing ? CATEGORY_NOT_FOUND : 'Unable to load packages',
    description: missing
      ? 'This category may have been renamed or removed.'
      : 'Please check your connection and try again.',
    actionText: 'Try again',
    onAction: retryCategoryPage,
  });
}

/**
 * Render a basic fallback when the shared loader module itself is unavailable.
 * @param {Object} elements Page element map.
 * @returns {void}
 */
function renderLoaderFailure(elements) {
  elements.title.textContent = 'Unable to load category';
  elements.description.textContent = 'Please refresh the page and try again.';
  elements.hero.replaceChildren();
  clearCategoryLoading(elements);
  elements.packages.textContent = 'Unable to load packages. Please refresh the page.';
}

/**
 * Load and render the category payload.
 * @returns {Promise<void>} Resolves after a success, empty or error state renders.
 */
async function initCategoryPage() {
  const elements = getCategoryElements();
  if (!elements) {
    return;
  }

  let skeletons;
  try {
    skeletons = await import(SKELETON_LOADER_URL);
    renderCategoryLoading(elements, skeletons);
    if (skeletons.isSkeletonDebugMode()) {
      return;
    }

    const slug = new URLSearchParams(window.location.search).get('slug');
    if (!slug) {
      renderMissingCategory(elements, skeletons);
      return;
    }

    const response = await fetch(`/api/v1/categories/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(response.status === 404 ? CATEGORY_NOT_FOUND : 'Unable to load category');
    }

    const data = await response.json();
    const category = data && data.category ? data.category : {};
    const packages = data && Array.isArray(data.packages) ? data.packages : [];
    const categoryName = String(category.name || 'Category');

    document.title = `${categoryName} — EventFlow`;
    elements.title.textContent = categoryName;
    elements.description.textContent = String(category.description || '');
    elements.breadcrumb.textContent = categoryName;
    renderCategoryHero(elements.hero, category);
    clearCategoryLoading(elements);
    elements.packages.replaceChildren();

    const PackageListConstructor = window.PackageList;
    if (typeof PackageListConstructor !== 'function') {
      throw new Error('Package list component unavailable');
    }

    const packageList = new PackageListConstructor('package-list-container', {
      sortFeaturedFirst: true,
    });
    packageList.setPackages(packages);
  } catch (error) {
    if (skeletons) {
      renderCategoryFailure(elements, skeletons, error);
      return;
    }
    renderLoaderFailure(elements);
  }
}

/**
 * Start or retry the asynchronous category load without leaking its promise.
 * @returns {void}
 */
function retryCategoryPage() {
  void initCategoryPage();
}

document.addEventListener('DOMContentLoaded', retryCategoryPage, { once: true });
