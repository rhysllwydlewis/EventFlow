/**
 * Category page initialization script.
 * Loads category details and packages for a category slug and uses the shared
 * skeleton lifecycle for loading, empty and retryable error states.
 */

window.__EF_PAGE__ = 'category';

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function sanitizeUrl(url) {
  if (!url) {
    return '';
  }
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }
  return '';
}

async function initCategoryPage() {
  const title = document.getElementById('category-title');
  const description = document.getElementById('category-description');
  const breadcrumb = document.getElementById('breadcrumb-category');
  const hero = document.getElementById('category-hero-section');
  const packagesContainer = document.getElementById('package-list-container');
  if (!title || !description || !breadcrumb || !hero || !packagesContainer) {
    return;
  }

  const skeletons = await import('/assets/js/utils/skeleton-loader.js');
  title.setAttribute('aria-busy', 'true');
  title.innerHTML = '<span class="skeleton skeleton-title" style="width:min(280px,70vw)" aria-hidden="true"></span><span class="sr-only">Loading category</span>';
  description.innerHTML = '<span class="skeleton skeleton-text skeleton-text-medium" aria-hidden="true"></span>';
  hero.setAttribute('aria-busy', 'true');
  hero.innerHTML = '<div class="skeleton skeleton-media skeleton-media--event" aria-hidden="true"></div>';
  skeletons.showSkeleton(packagesContainer, 'packageCard', { count: 6 });

  if (skeletons.isSkeletonDebugMode()) {
    return;
  }

  const slug = new URLSearchParams(window.location.search).get('slug');
  if (!slug) {
    title.textContent = 'Category not found';
    title.removeAttribute('aria-busy');
    description.textContent = '';
    breadcrumb.textContent = 'Category not found';
    hero.innerHTML = '';
    hero.removeAttribute('aria-busy');
    skeletons.showEmptyState(packagesContainer, {
      icon: '📦',
      title: 'Category not found',
      description: 'The category link is incomplete or no longer available.',
      actionText: 'Return home',
      actionHref: '/',
    });
    return;
  }

  try {
    const response = await fetch(`/api/v1/categories/${encodeURIComponent(slug)}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(response.status === 404 ? 'Category not found' : 'Unable to load category');
    }

    const data = await response.json();
    const category = data.category || {};
    const packages = Array.isArray(data.packages) ? data.packages : [];

    document.title = `${category.name || 'Category'} — EventFlow`;
    title.textContent = category.name || 'Category';
    title.removeAttribute('aria-busy');
    description.textContent = category.description || '';
    breadcrumb.textContent = category.name || 'Category';

    const heroImage = sanitizeUrl(category.heroImage);
    if (heroImage) {
      hero.innerHTML = `
        <div class="category-hero-img-wrap">
          <img src="${escapeHtml(heroImage)}" alt="${escapeHtml(category.name || 'Category')}" class="category-hero-img">
          <div class="category-hero-overlay">
            <h1 class="category-hero-title">${escapeHtml(category.icon || '')} ${escapeHtml(category.name || '')}</h1>
          </div>
        </div>`;
    } else {
      hero.innerHTML = '';
    }
    hero.removeAttribute('aria-busy');

    packagesContainer.removeAttribute('aria-busy');
    packagesContainer.removeAttribute('data-skeleton-state');
    packagesContainer.innerHTML = '';

    if (typeof PackageList !== 'undefined') {
      const packageList = new PackageList('package-list-container', { sortFeaturedFirst: true });
      packageList.setPackages(packages);
    } else {
      throw new Error('Package list component unavailable');
    }
  } catch (error) {
    console.error('Error loading category:', error);
    title.textContent = error.message === 'Category not found' ? 'Category not found' : 'Unable to load category';
    title.removeAttribute('aria-busy');
    description.textContent = '';
    hero.innerHTML = '';
    hero.removeAttribute('aria-busy');
    skeletons.showErrorState(packagesContainer, {
      title: error.message === 'Category not found' ? 'Category not found' : 'Unable to load packages',
      description:
        error.message === 'Category not found'
          ? 'This category may have been renamed or removed.'
          : 'Please check your connection and try again.',
      actionText: 'Try again',
      onAction: initCategoryPage,
    });
  }
}

document.addEventListener('DOMContentLoaded', initCategoryPage);
