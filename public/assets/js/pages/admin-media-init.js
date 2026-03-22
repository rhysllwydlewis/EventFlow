(function () {
  let currentPage = 1;
  let currentQuery = '';
  let currentMode = 'search'; // 'search' or 'curated'
  let selectedPhoto = null;

  // Check if Pexels is configured
  async function checkPexelsStatus() {
    try {
      const response = await AdminShared.api('/api/pexels/status');
      if (!response.configured) {
        showError(
          'Pexels API is not configured. Please set PEXELS_API_KEY in your environment variables.'
        );
        return false;
      }
      return true;
    } catch (error) {
      showError(`Failed to check Pexels status: ${error.message}`);
      return false;
    }
  }

  // Load categories
  async function loadCategories() {
    try {
      const response = await AdminShared.api('/api/pexels/categories');
      const container = document.getElementById('categoryChips');
      container.innerHTML = response.categories
        .map(
          cat =>
            `<div class="category-chip" data-query="${AdminShared.escapeHtml(cat.query)}">
          ${cat.icon} ${AdminShared.escapeHtml(cat.category)}
        </div>`
        )
        .join('');

      // Add click handlers
      container.querySelectorAll('.category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const query = chip.dataset.query;
          document.getElementById('searchInput').value = query;
          searchPhotos(query);
        });
      });
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  // Search photos
  async function searchPhotos(query, page = 1) {
    if (!query) {
      AdminShared.showToast('Please enter a search term', 'warning');
      return;
    }

    currentQuery = query;
    currentPage = page;
    currentMode = 'search';

    showLoading();
    hideError();

    try {
      const response = await AdminShared.api(
        `/api/pexels/search?q=${encodeURIComponent(query)}&page=${page}&perPage=15`
      );
      displayPhotos(response);
    } catch (error) {
      showError(`Failed to search photos: ${error.message}`);
    } finally {
      hideLoading();
    }
  }

  // Get curated photos
  async function getCuratedPhotos(page = 1) {
    currentPage = page;
    currentMode = 'curated';
    currentQuery = '';

    showLoading();
    hideError();

    try {
      const response = await AdminShared.api(`/api/pexels/curated?page=${page}&perPage=15`);
      displayPhotos(response);
    } catch (error) {
      showError(`Failed to fetch curated photos: ${error.message}`);
    } finally {
      hideLoading();
    }
  }

  // Display photos
  function displayPhotos(response) {
    const grid = document.getElementById('photoGrid');
    const resultsInfo = document.getElementById('resultsInfo');
    const pagination = document.getElementById('pagination');

    if (!response.photos || response.photos.length === 0) {
      grid.innerHTML =
        '<p style="text-align: center; padding: 2rem; color: #666;">No photos found. Try a different search term.</p>';
      resultsInfo.textContent = '';
      pagination.style.display = 'none';
      return;
    }

    // Results info
    resultsInfo.textContent = `Found ${response.totalResults.toLocaleString()} photos`;

    // Photo grid
    grid.innerHTML = response.photos
      .map(
        photo => `
      <div class="pexels-card" data-photo-id="${photo.id}">
        <img src="${AdminShared.escapeHtml(photo.src.medium)}" alt="${AdminShared.escapeHtml(photo.alt)}" loading="lazy">
        <div class="pexels-card-info">
          <p class="pexels-photographer">📸 ${AdminShared.escapeHtml(photo.photographer)}</p>
          <div class="pexels-actions">
            <button class="pexels-btn pexels-btn-primary" data-action="view" data-photo-id="${photo.id}">View</button>
            <button class="pexels-btn pexels-btn-secondary" data-action="copy" data-url="${AdminShared.escapeHtml(photo.src.large)}">Copy URL</button>
          </div>
        </div>
      </div>
    `
      )
      .join('');

    // Add event listeners
    grid.querySelectorAll('[data-action="view"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const photoId = btn.dataset.photoId;
        const photo = response.photos.find(p => p.id === parseInt(photoId));
        showPhotoModal(photo);
      });
    });

    grid.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        copyToClipboard(btn.dataset.url);
      });
    });

    // Pagination
    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    pageInfo.textContent = `Page ${response.page}`;
    prevBtn.disabled = !response.prevPage;
    nextBtn.disabled = !response.nextPage;

    pagination.style.display = 'flex';
  }

  // Show photo modal
  function showPhotoModal(photo) {
    selectedPhoto = photo;
    const modal = document.getElementById('photoModal');
    const img = document.getElementById('modalImage');
    const photographer = document.getElementById('modalPhotographer');
    const dimensions = document.getElementById('modalDimensions');

    img.src = photo.src.large2x || photo.src.large;
    img.alt = photo.alt;
    photographer.textContent = `Photo by ${photo.photographer}`;
    dimensions.textContent = `${photo.width} × ${photo.height} pixels`;

    modal.classList.add('active');
  }

  // Copy to clipboard
  function copyToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        AdminShared.showToast('Image URL copied to clipboard!', 'success');
      })
      .catch(_err => {
        AdminShared.showToast('Failed to copy URL', 'error');
      });
  }

  // Helper functions
  function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('photoGrid').style.display = 'none';
  }

  function hideLoading() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('photoGrid').style.display = 'grid';
  }

  function showError(message) {
    const errorEl = document.getElementById('errorState');
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }

  function hideError() {
    document.getElementById('errorState').style.display = 'none';
  }

  // Event listeners
  document.getElementById('searchBtn').addEventListener('click', () => {
    const query = document.getElementById('searchInput').value.trim();
    searchPhotos(query);
  });

  document.getElementById('searchInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') {
      const query = e.target.value.trim();
      searchPhotos(query);
    }
  });

  document.getElementById('curatedBtn').addEventListener('click', () => {
    getCuratedPhotos();
  });

  document.getElementById('prevBtn').addEventListener('click', () => {
    if (currentMode === 'search') {
      searchPhotos(currentQuery, currentPage - 1);
    } else {
      getCuratedPhotos(currentPage - 1);
    }
  });

  document.getElementById('nextBtn').addEventListener('click', () => {
    if (currentMode === 'search') {
      searchPhotos(currentQuery, currentPage + 1);
    } else {
      getCuratedPhotos(currentPage + 1);
    }
  });

  // Modal event listeners
  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
  });

  document.getElementById('photoModal').addEventListener('click', e => {
    if (e.target.id === 'photoModal') {
      document.getElementById('photoModal').classList.remove('active');
    }
  });

  document.getElementById('modalCopyUrl').addEventListener('click', () => {
    if (selectedPhoto) {
      copyToClipboard(selectedPhoto.src.large);
    }
  });

  document.getElementById('modalViewPexels').addEventListener('click', () => {
    if (selectedPhoto) {
      window.open(selectedPhoto.url, '_blank');
    }
  });

  // Initialize
  async function init() {
    const isConfigured = await checkPexelsStatus();
    if (isConfigured) {
      await loadCategories();
      getCuratedPhotos(); // Load curated photos by default
    }
  }

  init();
})();
