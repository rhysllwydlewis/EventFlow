/**
 * PexelsSelector Component
 * Supplier-facing Pexels photo browser for profile customization
 */

// Shared constant for allowed Pexels CDN domains
const PEXELS_ALLOWED_DOMAINS = ['images.pexels.com', 'www.pexels.com'];

class PexelsSelector {
  constructor() {
    this.activeOverlay = null;
    this.photosCache = [];
    this.currentPageNum = 1;
    this.searchTerm = '';
    this.loadMoreBtn = null;
    this.hasMoreContent = false;
    this.selectionCallback = null;
  }

  /**
   * Open the selector dialog
   * @param {Function} onSelectCallback - Called with the selected image URL and photo metadata
   * @param {Object} [options] - Optional selector configuration
   * @param {string} [options.searchTerm] - Search to run as soon as the selector opens
   */
  open(onSelectCallback, options = {}) {
    this.selectionCallback = onSelectCallback;
    this.currentPageNum = 1;
    this.photosCache = [];
    this.searchTerm = String(options.searchTerm || '').trim();

    this.buildOverlay();
    this.attachEventHandlers();
    if (this.searchTerm) {
      this.activeOverlay.querySelector('.search-field').value = this.searchTerm;
      this.performSearch(this.searchTerm);
    } else {
      this.fetchCuratedContent();
    }
  }

  buildOverlay() {
    const wrapper = document.createElement('div');
    wrapper.className = 'pexels-modal-wrapper';
    wrapper.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.className = 'pexels-dialog';
    dialog.style.cssText =
      'background:#fff;border-radius:12px;width:90%;max-width:900px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

    // Build components using DOM methods
    const headerBar = this.createHeader();
    const searchBar = this.createSearchBar();
    const contentArea = this.createContentArea();
    const loadMoreSection = this.createLoadMoreSection();

    dialog.appendChild(headerBar);
    dialog.appendChild(searchBar);
    dialog.appendChild(contentArea);
    dialog.appendChild(loadMoreSection);
    wrapper.appendChild(dialog);
    document.body.appendChild(wrapper);

    this.activeOverlay = wrapper;
  }

  createHeader() {
    const headerBar = document.createElement('div');
    headerBar.style.cssText =
      'padding:20px 24px;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;';

    const title = document.createElement('h3');
    title.style.cssText = 'margin:0;font-size:1.25rem;color:#111827;';
    title.textContent = 'Select Stock Photo';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-selector';
    closeBtn.style.cssText =
      'background:none;border:none;font-size:28px;cursor:pointer;color:#6b7280;padding:0;width:32px;height:32px;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';

    headerBar.appendChild(title);
    headerBar.appendChild(closeBtn);
    return headerBar;
  }

  createSearchBar() {
    const searchBar = document.createElement('div');
    searchBar.style.cssText = 'padding:16px 24px;border-bottom:1px solid #e5e7eb;';

    const flexContainer = document.createElement('div');
    flexContainer.style.cssText = 'display:flex;gap:8px;';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'search-field';
    searchInput.placeholder = 'Search photos (wedding, venue, catering...)';
    searchInput.style.cssText =
      'flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;';

    const searchBtn = document.createElement('button');
    searchBtn.className = 'search-trigger';
    searchBtn.textContent = 'Search';
    searchBtn.style.cssText =
      'padding:10px 20px;background:#0B8073;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;';

    const curatedBtn = document.createElement('button');
    curatedBtn.className = 'curated-trigger';
    curatedBtn.textContent = 'Browse';
    curatedBtn.style.cssText =
      'padding:10px 20px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-weight:600;cursor:pointer;';

    flexContainer.appendChild(searchInput);
    flexContainer.appendChild(searchBtn);
    flexContainer.appendChild(curatedBtn);
    searchBar.appendChild(flexContainer);
    return searchBar;
  }

  createContentArea() {
    const contentArea = document.createElement('div');
    contentArea.className = 'content-scroll';
    contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:24px;';

    const statusMsg = document.createElement('div');
    statusMsg.className = 'status-message';
    statusMsg.style.cssText = 'text-align:center;padding:40px;color:#9ca3af;';
    statusMsg.textContent = 'Loading...';
    contentArea.appendChild(statusMsg);

    const resultsGrid = document.createElement('div');
    resultsGrid.className = 'results-grid';
    resultsGrid.style.cssText =
      'display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;display:none;';
    contentArea.appendChild(resultsGrid);

    return contentArea;
  }

  createLoadMoreSection() {
    const loadMoreSection = document.createElement('div');
    loadMoreSection.style.cssText =
      'padding:16px 24px;border-top:1px solid #e5e7eb;text-align:center;display:none;';

    this.loadMoreBtn = document.createElement('button');
    this.loadMoreBtn.className = 'load-more-btn';
    this.loadMoreBtn.textContent = 'Load More Photos';
    this.loadMoreBtn.style.cssText =
      'padding:10px 24px;background:#f3f4f6;color:#374151;border:none;border-radius:6px;font-weight:600;cursor:pointer;';
    loadMoreSection.appendChild(this.loadMoreBtn);

    return loadMoreSection;
  }

  attachEventHandlers() {
    const closeBtn = this.activeOverlay.querySelector('.close-selector');
    closeBtn.addEventListener('click', () => this.close());

    this.activeOverlay.addEventListener('click', evt => {
      if (evt.target === this.activeOverlay) {
        this.close();
      }
    });

    const searchField = this.activeOverlay.querySelector('.search-field');
    const searchBtn = this.activeOverlay.querySelector('.search-trigger');
    searchBtn.addEventListener('click', () => {
      const term = searchField.value.trim();
      if (term) {
        this.performSearch(term);
      }
    });

    searchField.addEventListener('keypress', evt => {
      if (evt.key === 'Enter') {
        const term = searchField.value.trim();
        if (term) {
          this.performSearch(term);
        }
      }
    });

    const curatedBtn = this.activeOverlay.querySelector('.curated-trigger');
    curatedBtn.addEventListener('click', () => {
      searchField.value = '';
      this.fetchCuratedContent();
    });

    this.loadMoreBtn.addEventListener('click', () => {
      this.loadNextPage();
    });
  }

  async performSearch(term) {
    this.searchTerm = term;
    this.currentPageNum = 1;
    this.photosCache = [];

    this.showStatusMessage('Searching...');

    try {
      const apiUrl = `/api/pexels/search?q=${encodeURIComponent(term)}&page=1&perPage=15`;
      const resp = await fetch(apiUrl, { credentials: 'include' });

      if (!resp.ok) {
        throw new Error('Search failed');
      }

      const data = await resp.json();
      this.photosCache = data.photos || [];
      this.hasMoreContent = !!data.nextPage;
      this.renderPhotos();
    } catch (err) {
      this.showStatusMessage('Failed to search. Please try again.');
      console.error('Pexels search error:', err);
    }
  }

  async fetchCuratedContent() {
    this.searchTerm = '';
    this.currentPageNum = 1;
    this.photosCache = [];

    this.showStatusMessage('Loading curated photos...');

    try {
      const apiUrl = `/api/pexels/curated?page=1&perPage=15`;
      const resp = await fetch(apiUrl, { credentials: 'include' });

      if (!resp.ok) {
        throw new Error('Failed to load');
      }

      const data = await resp.json();
      this.photosCache = data.photos || [];
      this.hasMoreContent = !!data.nextPage;
      this.renderPhotos();
    } catch (err) {
      this.showStatusMessage('Unable to load photos. Please try again.');
      console.error('Pexels curated error:', err);
    }
  }

  async loadNextPage() {
    this.currentPageNum += 1;
    this.loadMoreBtn.disabled = true;
    this.loadMoreBtn.textContent = 'Loading...';

    try {
      const apiUrl = this.searchTerm
        ? `/api/pexels/search?q=${encodeURIComponent(this.searchTerm)}&page=${this.currentPageNum}&perPage=15`
        : `/api/pexels/curated?page=${this.currentPageNum}&perPage=15`;

      const resp = await fetch(apiUrl, { credentials: 'include' });

      if (!resp.ok) {
        throw new Error('Failed to load more');
      }

      const data = await resp.json();
      this.photosCache.push(...(data.photos || []));
      this.hasMoreContent = !!data.nextPage;
      this.renderPhotos();
    } catch (err) {
      console.error('Load more error:', err);
      this.currentPageNum -= 1;
    } finally {
      this.loadMoreBtn.disabled = false;
      this.loadMoreBtn.textContent = 'Load More Photos';
    }
  }

  renderPhotos() {
    const statusDiv = this.activeOverlay.querySelector('.status-message');
    const gridDiv = this.activeOverlay.querySelector('.results-grid');
    const loadMoreSection = this.loadMoreBtn.parentElement;

    if (this.photosCache.length === 0) {
      statusDiv.textContent = 'No photos found. Try a different search.';
      statusDiv.style.display = 'block';
      gridDiv.style.display = 'none';
      loadMoreSection.style.display = 'none';
      return;
    }

    statusDiv.style.display = 'none';
    gridDiv.style.display = 'grid';

    // Filter and render valid photos only
    const validPhotos = this.photosCache.filter(photo => {
      return this.validatePexelsUrl(photo.src.large) && this.validatePexelsUrl(photo.src.medium);
    });

    if (validPhotos.length === 0) {
      statusDiv.textContent = 'No valid photos available. Please try again.';
      statusDiv.style.display = 'block';
      gridDiv.style.display = 'none';
      loadMoreSection.style.display = 'none';
      return;
    }

    // Build grid using DOM methods instead of innerHTML to avoid XSS
    // Clear existing content using DOM methods
    while (gridDiv.firstChild) {
      gridDiv.removeChild(gridDiv.firstChild);
    }

    validPhotos.forEach(photo => {
      const photoCard = this.createPhotoCard(photo);
      // Skip if card creation failed (invalid URLs)
      if (photoCard && photoCard.nodeType === Node.ELEMENT_NODE) {
        gridDiv.appendChild(photoCard);
      }
    });

    // Show/hide load more button
    loadMoreSection.style.display = this.hasMoreContent ? 'block' : 'none';
  }

  createPhotoCard(photo) {
    const largeUrl = this.validatePexelsUrl(photo.src.large);
    const mediumUrl = this.validatePexelsUrl(photo.src.medium);

    // Return null if URLs are invalid (will be filtered out in render)
    if (!largeUrl || !mediumUrl) {
      console.warn('Skipping photo with invalid URL');
      return null;
    }

    // Create card container
    const cardDiv = document.createElement('div');
    cardDiv.className = 'photo-item';
    cardDiv.dataset.url = largeUrl; // DOM property assignment is safe
    cardDiv.style.cssText =
      'background:#fff;border-radius:8px;overflow:hidden;cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.1);';

    // Create image
    const photoImg = document.createElement('img');
    photoImg.src = mediumUrl; // DOM property assignment is safe
    photoImg.alt = photo.alt || 'Photo';
    photoImg.style.cssText = 'width:100%;height:180px;object-fit:cover;display:block;';

    // Create info section
    const infoDiv = document.createElement('div');
    infoDiv.style.padding = '12px';

    const photographerP = document.createElement('p');
    photographerP.style.cssText = 'margin:0 0 10px 0;font-size:13px;color:#6b7280;';
    photographerP.textContent = `📸 ${photo.photographer}`; // textContent is safe

    const selectButton = document.createElement('button');
    selectButton.className = 'select-photo-btn';
    selectButton.textContent = 'Select Photo';
    selectButton.style.cssText =
      'width:100%;padding:8px;background:#0B8073;color:#fff;border:none;border-radius:4px;font-weight:600;cursor:pointer;font-size:13px;';

    // Event handlers
    selectButton.addEventListener('click', evt => {
      evt.stopPropagation();
      this.handleSelection(largeUrl, photo);
    });

    cardDiv.addEventListener('click', () => {
      this.handleSelection(largeUrl, photo);
    });

    // Hover effects
    cardDiv.addEventListener('mouseenter', () => {
      cardDiv.style.transform = 'translateY(-4px)';
      cardDiv.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
    });

    cardDiv.addEventListener('mouseleave', () => {
      cardDiv.style.transform = '';
      cardDiv.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    });

    // Assemble card
    infoDiv.appendChild(photographerP);
    infoDiv.appendChild(selectButton);
    cardDiv.appendChild(photoImg);
    cardDiv.appendChild(infoDiv);

    return cardDiv;
  }

  validatePexelsUrl(url) {
    // Validate URL is from Pexels CDN domains
    try {
      const urlObj = new URL(url);
      if (PEXELS_ALLOWED_DOMAINS.includes(urlObj.hostname)) {
        return url;
      }
      console.warn('Invalid Pexels URL domain:', urlObj.hostname);
      return '';
    } catch (e) {
      console.warn('Invalid URL format:', url);
      return '';
    }
  }

  handleSelection(imageUrl, photo) {
    if (this.selectionCallback && typeof this.selectionCallback === 'function') {
      this.selectionCallback(imageUrl, photo);
    }
    this.close();
  }

  showStatusMessage(msg) {
    const statusDiv = this.activeOverlay.querySelector('.status-message');
    const gridDiv = this.activeOverlay.querySelector('.results-grid');
    const loadMoreSection = this.loadMoreBtn.parentElement;

    statusDiv.textContent = msg;
    statusDiv.style.display = 'block';
    gridDiv.style.display = 'none';
    loadMoreSection.style.display = 'none';
  }

  close() {
    if (this.activeOverlay && this.activeOverlay.parentElement) {
      this.activeOverlay.parentElement.removeChild(this.activeOverlay);
    }
    this.activeOverlay = null;
    this.photosCache = [];
    this.selectionCallback = null;
  }
}

// Export for use in other modules
if (typeof window !== 'undefined') {
  window.PexelsSelector = PexelsSelector;
  window.PEXELS_ALLOWED_DOMAINS = PEXELS_ALLOWED_DOMAINS;
}
