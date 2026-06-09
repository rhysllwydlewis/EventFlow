const PACKAGE_PLACEHOLDER_URL = '/assets/images/placeholders/package-event.svg';
const ROOT_ID = 'supplier-package-cards-root';

function getSupplierId(search = window.location.search) {
  return new URLSearchParams(search).get('id') || '';
}

function isDebugImages(search = window.location.search) {
  return new URLSearchParams(search).get('debugImages') === '1';
}

function endpointForSupplier(supplierId, debugImages = false) {
  const path = `/api/supplier-profile/${encodeURIComponent(supplierId)}/package-cards`;
  return debugImages ? `${path}?debugImages=1` : path;
}

function escapeText(value) {
  return String(value ?? '');
}

function getPackagesSection(root) {
  return root?.id === 'sp-section-packages' ? root : root?.closest?.('#sp-section-packages');
}

function setPackagesSectionVisible(root, visible) {
  const section = getPackagesSection(root);
  if (section) {
    section.style.display = visible ? '' : 'none';
  }
  root.style.display = visible ? '' : 'none';
}

function clearRoot(root) {
  root.dataset.renderer = 'v2';
  root.replaceChildren();
}

function renderState(root, className, message) {
  clearRoot(root);
  const card = document.createElement('div');
  card.className = `sp-card supplier-packages-v2 supplier-packages-v2--${className}`;
  const title = document.createElement('h2');
  title.className = 'sp-card-title';
  title.textContent = 'Packages & Services';
  const body = document.createElement('p');
  body.className = 'supplier-packages-v2__state';
  body.textContent = message;
  card.append(title, body);
  root.append(card);
  setPackagesSectionVisible(root, true);
}

function createImage(item, debugImages) {
  const img = document.createElement('img');
  img.className = 'supplier-package-card-v2__image';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.alt = escapeText(item.imageAlt || `${item.title || 'Package'} package image`);
  img.src = item.imageUrl || PACKAGE_PLACEHOLDER_URL;
  img.onerror = () => {
    const currentSrc = img.getAttribute('src') || '';
    if (!currentSrc.endsWith(PACKAGE_PLACEHOLDER_URL)) {
      if (debugImages) {
        console.warn('[supplier-packages-v2] package image failed; using placeholder', {
          title: item.title,
          imageUrl: item.imageUrl,
          debug: item.debug,
        });
      }
      img.src = PACKAGE_PLACEHOLDER_URL;
    }
  };
  return img;
}

function createPackageCard(item, debugImages) {
  const article = document.createElement('article');
  article.className = 'supplier-package-card-v2 sp-package-card';
  article.dataset.packageId = item.id || '';
  article.dataset.packageSlug = item.slug || '';

  const link = document.createElement('a');
  link.className = 'supplier-package-card-v2__link';
  link.href =
    item.detailUrl ||
    (item.slug
      ? `/package/${encodeURIComponent(item.slug)}`
      : `/package?id=${encodeURIComponent(item.id || '')}`);
  link.setAttribute('aria-label', `View ${item.title || 'package'}`);

  const media = document.createElement('div');
  media.className = 'supplier-package-card-v2__media sp-package-card__image';
  media.append(createImage(item, debugImages));

  const body = document.createElement('div');
  body.className = 'supplier-package-card-v2__body sp-package-card__body';

  const title = document.createElement('h3');
  title.className = 'supplier-package-card-v2__title sp-package-card__title';
  title.textContent = escapeText(item.title || 'Untitled package');

  const description = document.createElement('p');
  description.className = 'supplier-package-card-v2__description sp-package-card__description';
  description.textContent = escapeText(item.description || '');

  const footer = document.createElement('div');
  footer.className = 'supplier-package-card-v2__footer sp-package-card__footer';

  const price = document.createElement('span');
  price.className = 'supplier-package-card-v2__price sp-package-card__price';
  price.textContent = escapeText(item.priceDisplay || 'View details');

  const cta = document.createElement('span');
  cta.className = 'supplier-package-card-v2__button btn btn-sm';
  cta.textContent = 'View';

  footer.append(price, cta);
  body.append(title, description, footer);
  link.append(media, body);
  article.append(link);
  return article;
}

function logDebug(items) {
  if (!Array.isArray(items)) {
    return;
  }
  console.table(
    items.map(({ title, imageUrl, debug }) => ({
      title,
      imageUrl,
      imageSource: debug?.imageSource,
      candidateCount: debug?.candidateCount,
      duplicateTitleCount: debug?.duplicateTitleCount,
    }))
  );
  console.debug(
    '[supplier-packages-v2] image decisions',
    items.map(item => ({
      title: item.title,
      imageUrl: item.imageUrl,
      debug: item.debug,
    }))
  );
}

function renderPackages(root, items, options = {}) {
  clearRoot(root);
  if (!items || items.length === 0) {
    setPackagesSectionVisible(root, false);
    return;
  }

  const card = document.createElement('div');
  card.className = 'sp-card sp-fade-in supplier-packages-v2';

  const title = document.createElement('h2');
  title.className = 'sp-card-title';
  title.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/><polyline points="16 3 12 7 8 3"/></svg> Packages &amp; Services';

  const grid = document.createElement('div');
  grid.className = 'supplier-packages-v2__grid sp-packages-grid';
  items.forEach(item => grid.append(createPackageCard(item, Boolean(options.debugImages))));

  card.append(title, grid);
  root.append(card);
  setPackagesSectionVisible(root, true);

  if (options.debugImages) {
    logDebug(items);
  }
}

async function loadSupplierPackagesV2(options = {}) {
  const root =
    options.root ||
    document.getElementById(ROOT_ID) ||
    document.getElementById('sp-section-packages');
  if (!root) {
    return null;
  }
  const supplierId = options.supplierId || getSupplierId(options.search);
  const debugImages = options.debugImages ?? isDebugImages(options.search);
  if (!supplierId) {
    renderState(root, 'empty', 'No supplier selected.');
    return null;
  }

  renderState(root, 'loading', 'Loading packages…');
  try {
    const fetchImpl = options.fetch || window.fetch.bind(window);
    const response = await fetchImpl(endpointForSupplier(supplierId, debugImages), {
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error(`Package cards request failed with ${response.status}`);
    }
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : [];
    renderPackages(root, items, { debugImages });
    return payload;
  } catch (error) {
    if (debugImages) {
      console.error('[supplier-packages-v2] failed to load package cards', error);
    }
    renderState(root, 'error', 'Packages could not be loaded. Please try again.');
    return null;
  }
}

window.EVENTFLOW_USE_SUPPLIER_PACKAGES_V2 = true;
window.SupplierProfilePackagesV2 = {
  PACKAGE_PLACEHOLDER_URL,
  endpointForSupplier,
  loadSupplierPackagesV2,
  renderPackages,
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => loadSupplierPackagesV2());
} else {
  loadSupplierPackagesV2();
}

export { PACKAGE_PLACEHOLDER_URL, endpointForSupplier, loadSupplierPackagesV2, renderPackages };
