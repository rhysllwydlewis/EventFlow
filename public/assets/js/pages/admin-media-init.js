(function () {
  let currentPage = 1;
  let currentQuery = '';
  let currentMode = 'curated';
  let currentMediaType = 'photos';
  let currentCollectionId = '';
  let selectedMedia = null;

  function escapeHtml(value) {
    return AdminShared.escapeHtml(String(value ?? ''));
  }

  function getMediaType() {
    return document.getElementById('mediaTypeSelect')?.value || 'photos';
  }

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

  async function loadCategories() {
    try {
      const response = await AdminShared.api('/api/pexels/categories');
      const container = document.getElementById('categoryChips');
      container.innerHTML = response.categories
        .map(
          cat =>
            `<button type="button" class="category-chip" data-query="${escapeHtml(cat.query)}">
              ${escapeHtml(cat.icon)} ${escapeHtml(cat.category)}
            </button>`
        )
        .join('');

      container.querySelectorAll('.category-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const query = chip.dataset.query;
          document.getElementById('searchInput').value = query;
          searchMedia(query);
        });
      });
    } catch (error) {
      console.error('Failed to load categories:', error);
    }
  }

  function normalisePhoto(photo) {
    return {
      id: photo.id,
      type: 'photo',
      title: photo.alt || `Pexels photo ${photo.id}`,
      creator: photo.photographer || 'Pexels photographer',
      width: photo.width,
      height: photo.height,
      thumbnailUrl: photo.src?.medium || photo.src?.large || photo.url,
      mediaUrl:
        photo.src?.large2x ||
        photo.src?.large ||
        photo.src?.original ||
        photo.src?.medium ||
        photo.url,
      pexelsUrl: photo.url,
      raw: photo,
    };
  }

  function pickVideoFile(video) {
    const files = Array.isArray(video.videoFiles) ? video.videoFiles : video.video_files || [];
    return (
      files.find(
        file => file.quality === 'hd' && (file.fileType || file.file_type) === 'video/mp4'
      ) ||
      files.find(file => (file.fileType || file.file_type) === 'video/mp4') ||
      files[0] ||
      {}
    );
  }

  function normaliseVideo(video) {
    const file = pickVideoFile(video);
    return {
      id: video.id,
      type: 'video',
      title: `Pexels video ${video.id}`,
      creator: video.user?.name || 'Pexels creator',
      width: video.width || file.width,
      height: video.height || file.height,
      duration: video.duration,
      thumbnailUrl:
        video.image || video.videoPictures?.[0]?.picture || video.video_pictures?.[0]?.picture,
      mediaUrl: file.link || video.url,
      pexelsUrl: video.url,
      raw: video,
    };
  }

  function normaliseMixedItem(item) {
    if (item.type === 'Video' || item.video_files || item.duration) {
      return normaliseVideo(item);
    }
    return normalisePhoto(item);
  }

  async function searchMedia(query, page = 1) {
    if (!query) {
      AdminShared.showToast('Please enter a search term', 'warning');
      return;
    }

    currentQuery = query;
    currentPage = page;
    currentMediaType = getMediaType();
    currentMode = 'search';

    const endpoint =
      currentMediaType === 'videos'
        ? `/api/pexels/videos/search?q=${encodeURIComponent(query)}&page=${page}&perPage=15`
        : `/api/pexels/search?q=${encodeURIComponent(query)}&page=${page}&perPage=15`;

    await loadMedia(endpoint, `Failed to search ${currentMediaType}`);
  }

  async function getCuratedPhotos(page = 1) {
    currentPage = page;
    currentMediaType = 'photos';
    currentMode = 'curated';
    currentQuery = '';
    document.getElementById('mediaTypeSelect').value = 'photos';

    await loadMedia(
      `/api/pexels/curated?page=${page}&perPage=15`,
      'Failed to fetch curated photos'
    );
  }

  async function getPopularVideos(page = 1) {
    currentPage = page;
    currentMediaType = 'videos';
    currentMode = 'popular-videos';
    currentQuery = '';
    document.getElementById('mediaTypeSelect').value = 'videos';

    await loadMedia(
      `/api/pexels/videos/popular?page=${page}&perPage=15`,
      'Failed to fetch popular videos'
    );
  }

  async function getCollectionMedia(collectionId, page = 1) {
    if (!collectionId) {
      AdminShared.showToast('Please enter a Pexels collection ID', 'warning');
      return;
    }

    currentCollectionId = collectionId;
    currentPage = page;
    currentMediaType = getMediaType();
    currentMode = 'collection';

    await loadMedia(
      `/api/pexels/collection/${encodeURIComponent(
        collectionId
      )}/media?page=${page}&perPage=15&type=${currentMediaType}`,
      'Failed to fetch collection media'
    );
  }

  async function loadMedia(endpoint, failureMessage) {
    showLoading();
    hideError();

    try {
      const response = await AdminShared.api(endpoint);
      displayMedia(response);
    } catch (error) {
      showError(`${failureMessage}: ${error.message}`);
    } finally {
      hideLoading();
    }
  }

  function getResponseItems(response) {
    if (Array.isArray(response.photos)) {
      return response.photos.map(normalisePhoto);
    }
    if (Array.isArray(response.videos)) {
      return response.videos.map(normaliseVideo);
    }
    if (Array.isArray(response.media)) {
      return response.media.map(normaliseMixedItem);
    }
    return [];
  }

  function displayMedia(response) {
    const grid = document.getElementById('photoGrid');
    const resultsInfo = document.getElementById('resultsInfo');
    const pagination = document.getElementById('pagination');
    const items = getResponseItems(response);

    if (items.length === 0) {
      grid.innerHTML =
        '<p style="text-align:center;padding:2rem;color:#666;">No media found. Try a different search term or media type.</p>';
      resultsInfo.textContent = '';
      pagination.style.display = 'none';
      return;
    }

    const total = response.totalResults || response.total_results || items.length;
    resultsInfo.textContent = `Found ${Number(total).toLocaleString()} ${currentMediaType}`;

    grid.innerHTML = items.map(renderMediaCard).join('');

    grid.querySelectorAll('[data-action="view"]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        const media = items.find(item => String(item.id) === btn.dataset.mediaId);
        showMediaModal(media);
      });
    });

    grid.querySelectorAll('[data-action="copy"]').forEach(btn => {
      btn.addEventListener('click', event => {
        event.stopPropagation();
        copyToClipboard(btn.dataset.url);
      });
    });

    const pageInfo = document.getElementById('pageInfo');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    currentPage = response.page || currentPage;
    pageInfo.textContent = `Page ${currentPage}`;
    prevBtn.disabled = !response.prevPage && !response.prev_page && currentPage <= 1;
    nextBtn.disabled = !response.nextPage && !response.next_page;

    pagination.style.display = 'flex';
  }

  function renderMediaCard(media) {
    const dimensions =
      media.width && media.height ? `${media.width} x ${media.height}` : 'Dimensions unknown';
    const thumbnailUrl = media.thumbnailUrl || '';
    const mediaUrl = media.mediaUrl || '';
    const preview =
      media.type === 'video'
        ? `<video muted playsinline preload="metadata" poster="${escapeHtml(thumbnailUrl)}">
            <source src="${escapeHtml(mediaUrl)}" type="video/mp4">
          </video>`
        : `<img src="${escapeHtml(thumbnailUrl || mediaUrl)}" alt="${escapeHtml(media.title)}" loading="lazy">`;

    return `
      <div class="pexels-card" data-media-id="${escapeHtml(media.id)}">
        <div class="pexels-card-media">
          ${preview}
          <span class="pexels-media-type">${escapeHtml(media.type)}</span>
        </div>
        <div class="pexels-card-info">
          <p class="pexels-photographer">${escapeHtml(media.creator)}</p>
          <p class="pexels-photographer">${escapeHtml(dimensions)}${
            media.duration ? `, ${escapeHtml(media.duration)}s` : ''
          }</p>
          <div class="pexels-actions">
            <button class="ef-cta pexels-btn pexels-btn-primary" data-action="view" data-media-id="${escapeHtml(media.id)}">View</button>
            <button class="ef-cta pexels-btn pexels-btn-secondary" data-action="copy" data-url="${escapeHtml(mediaUrl)}">Copy URL</button>
          </div>
        </div>
      </div>
    `;
  }

  function showMediaModal(media) {
    if (!media) {
      return;
    }

    selectedMedia = media;
    const modal = document.getElementById('photoModal');
    const mount = document.getElementById('modalMediaMount');
    const photographer = document.getElementById('modalPhotographer');
    const dimensions = document.getElementById('modalDimensions');

    if (media.type === 'video') {
      mount.innerHTML = `
        <video class="modal-video" controls playsinline poster="${escapeHtml(media.thumbnailUrl || '')}">
          <source src="${escapeHtml(media.mediaUrl || '')}" type="video/mp4">
        </video>
      `;
      photographer.textContent = `Video by ${media.creator}`;
    } else {
      mount.innerHTML = `<img class="modal-image" id="modalImage" src="${escapeHtml(
        media.mediaUrl
      )}" alt="${escapeHtml(media.title)}">`;
      photographer.textContent = `Photo by ${media.creator}`;
    }

    dimensions.textContent =
      media.width && media.height
        ? `${media.width} x ${media.height}${media.duration ? `, ${media.duration}s` : ''}`
        : 'Dimensions unavailable';

    modal.classList.add('active');
  }

  function copyToClipboard(text) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        AdminShared.showToast('Media URL copied to clipboard', 'success');
      })
      .catch(() => {
        AdminShared.showToast('Failed to copy URL', 'error');
      });
  }

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

  function goToPage(page) {
    if (currentMode === 'search') {
      searchMedia(currentQuery, page);
    } else if (currentMode === 'popular-videos') {
      getPopularVideos(page);
    } else if (currentMode === 'collection') {
      getCollectionMedia(currentCollectionId, page);
    } else {
      getCuratedPhotos(page);
    }
  }

  document.getElementById('searchBtn').addEventListener('click', () => {
    searchMedia(document.getElementById('searchInput').value.trim());
  });

  document.getElementById('searchInput').addEventListener('keypress', event => {
    if (event.key === 'Enter') {
      searchMedia(event.target.value.trim());
    }
  });

  document.getElementById('curatedBtn').addEventListener('click', () => {
    getCuratedPhotos();
  });

  document.getElementById('popularVideosBtn').addEventListener('click', () => {
    getPopularVideos();
  });

  document.getElementById('collectionBtn').addEventListener('click', () => {
    getCollectionMedia(document.getElementById('collectionIdInput').value.trim());
  });

  document.getElementById('prevBtn').addEventListener('click', () => {
    goToPage(currentPage - 1);
  });

  document.getElementById('nextBtn').addEventListener('click', () => {
    goToPage(currentPage + 1);
  });

  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('photoModal').classList.remove('active');
  });

  document.getElementById('photoModal').addEventListener('click', event => {
    if (event.target.id === 'photoModal') {
      document.getElementById('photoModal').classList.remove('active');
    }
  });

  document.getElementById('modalCopyUrl').addEventListener('click', () => {
    if (selectedMedia) {
      copyToClipboard(selectedMedia.mediaUrl);
    }
  });

  document.getElementById('modalViewPexels').addEventListener('click', () => {
    if (selectedMedia) {
      window.open(selectedMedia.pexelsUrl, '_blank');
    }
  });

  document.getElementById('backToDashboard')?.addEventListener('click', () => {
    window.location.href = '/admin';
  });

  async function init() {
    const isConfigured = await checkPexelsStatus();
    if (isConfigured) {
      await loadCategories();
      getCuratedPhotos();
    }
  }

  init();
})();
