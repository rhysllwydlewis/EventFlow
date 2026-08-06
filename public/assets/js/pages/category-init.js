/**
 * Category page initialization script.
 * Loads category details and packages for a category slug and uses the shared
 * skeleton lifecycle for loading, empty and retryable error states.
 */

window.__EF_PAGE__ = 'category';

const SKELETON_LOADER_URL = '/assets/js/utils/skeleton-loader.js';
const CATEGORY_NOT_FOUND = 'Category not found';

/**
 * Return only same-origin or HTTP(S) image URLs.
 * @param {*} url Candidate image URL.
 * @returns {string} A safe URL or an empty string.
 */
function sanitizeUrl(url) {
  const value = String(url ?? '').trim();
  return /^https?:\/\//i.test(value) || value.startsWith('/') ? value : '';
}

/**
 * Convert an unknown caught value into user-safe fallback copy.
 * @param {*} error Caught value.
 * @returns {string} Normalized error message.
 */
function getErrorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Unable to load category';
}

/**
 * Render the initial title, description, hero and package placeholders.
 * @param {Object} elements Required category page elements.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @returns {void}
 */
function setInitialLoadingState(elements, skeletons) {
  const { title, description, hero, packagesContainer } = elements;
  title.setAttribute('aria-busy', 'true');
  title.innerHTML =
    '<span class="skeleton skeleton-title" style="width:min(280px,70vw)" aria-hidden="true"></span><span class="sr-only">Loading category</span>';
  description.innerHTML =
    '<span class="skeleton skeleton-text skeleton-text-medium" aria-hidden="true"></span>';
  hero.setAttribute('aria-busy', 'true');
  hero.innerHTML =
    '<div class="skeleton skeleton-media skeleton-media--event" aria-hidden="true"></div>';
  skeletons.showSkeleton(packagesContainer, 'packageCard', { count: 6 });
}

/**
 * Remove loading semantics after a terminal page state is rendered.
 * @param {Object} elements Required category page elements.
 * @returns {void}
 */
function clearLoadingAttributes(elements) {
  const { title, hero, packagesContainer } = elements;
  title.removeAttribute('aria-busy');
  hero.removeAttribute('aria-busy');
  packagesContainer.removeAttribute('aria-busy');
  packagesContainer.removeAttribute('data-skeleton-state');
}

/**
 * Render the optional category hero without interpolating untrusted HTML.
 * @param {HTMLElement} hero Hero mount.
 * @param {Object} category Category view model.
 * @returns {void}
 */
function renderCategoryHero(hero, category) {
  const heroImage = sanitizeUrl(category.heroImage);
  hero.replaceChildren();
  if (!heroImage) {
    return;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'category-hero-img-wrap';

  const image = document.createElement('img');
  image.src = heroImage;
  image.alt = String(category.name || 'Category');
  image.className = 'category-hero-img';

  const overlay = document.createElement('div');
  overlay.className = 'category-hero-overlay';

  const heading = document.createElement('h1');
  heading.className = 'category-hero-title';
  heading.textContent = [category.icon, category.name].filter(Boolean).join(' ');

  overlay.appendChild(heading);
  wrapper.append(image, overlay);
  hero.appendChild(wrapper);
}

/**
 * Render the terminal state used when the URL has no category slug.
 * @param {Object} elements Required category page elements.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @param {HTMLElement} description Description element.
 * @returns {void}
 */
function renderMissingCategory(elements, skeletons, description) {
  const { title, breadcrumb, hero, packagesContainer } = elements;
  title.textContent = CATEGORY_NOT_FOUND;
  breadcrumb.textContent = CATEGORY_NOT_FOUND;
  description.textContent = '';
  hero.replaceChildren();
  clearLoadingAttributes(elements);
  skeletons.showEmptyState(packagesContainer, {
    icon: '📦',
    title: CATEGORY_NOT_FOUND,
    description: 'The category link is incomplete or no longer available.',
    actionText: 'Return home',
    actionHref: '/',
  });
}

/**
 * Render a retryable request or component-load failure.
 * @param {Object} elements Required category page elements.
 * @param {Object} skeletons Shared skeleton-loader module.
 * @param {*} error Caught value.
 * @returns {void}
 */
function renderLoadFailure(elements, skeletons, error) {
  const { title, description, hero, packagesContainer } = elements;
  const message = getErrorMessage(error);
  const missing = message === CATEGORY_NOT_FOUND;

  console.error('Error loading category:', error);
  title.textContent = missing ? CATEGORY_NOT_FOUND : 'Unable to load category';
  description.textContent = '';
  hero.replaceChildren();
  clearLoadingAttributes(elements);
  skeletons.showErrorState(packagesContainer, {
    title: missing ? CATEGORY_NOT_FOUND : 'Unable to load packages',
    description: missing
      ? 'This category may have been renamed or removed.'
      : 'Please check your connection and try again.',
    actionText: 'Try again',
    onAction: initCategoryPage,
  });
}

/**
 * Load and render the category payload.
 * @returns {Promise<void>} Resolves after a success, empty or error state renders.
 */
async function initCategoryPage() {
  const elements = {
    title: document.getElementById('category-title'),
    description: document.getElementById('category-description'),
    breadcrumb: document.getElementById('breadcrumb-category'),
    hero: document.getElementById('category-hero-section'),
    packagesContainer: document.getElementById('package-list-container'),
  };

  if (Object.values(elements).some(element => !element)) {
    return;
  }

  let skeletons;
  try {
    skeletons = await import(SKELETON_LOADER_URL);
    setInitialLoadingState(elements, skeletons);

    if (skeletons.isSkeletonDebugMode()) {
      return;
    }

    const slug = new URLSearchParams(window.location.search).get('slug');
    if (!slug) {
      renderMissingCategory(elements, skeletons, elements.description);
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
    const category = data?.category || {};
    const packages = Array.isArray(data?.packages) ? data.packages : [];
    const categoryName = String(category.name || 'Category');

    document.title = `${categoryName} — EventFlow`;
    elements.title.textContent = categoryName;
    elements.description.textContent = String(category.description || '');
    elements.breadcrumb.textContent = categoryName;
    renderCategoryHero(elements.hero, category);
    clearLoadingAttributes(elements);
    elements.packagesContainer.replaceChildren();

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
      renderLoadFailure(elements, skeletons, error);
      return;
    }

    console.error('Unable to initialize category loading state:', error);
    elements.title.textContent = 'Unable to load category';
    elements.description.textContent = 'Please refresh the page and try again.';
    elements.hero.replaceChildren();
    clearLoadingAttributes(elements);
    elements.packagesContainer.textContent = 'Unable to load packages. Please refresh the page.';
  }
}

document.addEventListener('DOMContentLoaded', initCategoryPage, { once: true });
