window.__EF_PAGE__ = 'guides';

document.addEventListener('DOMContentLoaded', () => {
  let articles = [];

  const categoryEmoji = {
    Venues: '🏛️',
    Catering: '🍽️',
    Photography: '📸',
    Timelines: '📅',
    Sustainability: '🌿',
    Budget: '💰',
    Corporate: '💼',
    Parties: '🎉',
    Wedding: '💍',
    Planning: '📋',
    Tips: '💡',
    Trends: '✨',
    Entertainment: '🎵',
    Tools: '🛠️',
    Décor: '🎨',
    Stationery: '✉️',
    Marketplace: '🛍️',
    Transport: '🚗',
  };

  function escHtml(str) {
    return String(str === null || str === undefined ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let activeFilter = '';
  let searchQuery = '';
  let sortOrder = 'newest';
  let showAllGuides = false;
  const INITIAL_GUIDE_LIMIT = 23;

  const searchInput = document.getElementById('guides-search-input');
  const searchClear = document.getElementById('guides-search-clear');
  const guidesGrid = document.getElementById('guides-grid');
  const guidesLoading = document.getElementById('guides-loading');
  const guidesEmpty = document.getElementById('guides-empty');
  const emptyMsg = document.getElementById('guides-empty-msg');
  const chipsWrap = document.getElementById('guides-chips');
  const sortSelect = document.getElementById('guides-sort');
  const guidesNoJsList = document.getElementById('guides-nojs-list');
  const clearAllBtn = document.getElementById('guides-clear-all');
  const resetBtn = document.getElementById('guides-reset-btn');
  const resultsCount = document.getElementById('guides-results-count');

  function formatGuideDate(value) {
    if (!value) {
      return 'Updated recently';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return 'Updated recently';
    }
    return `Updated ${date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`;
  }

  function trackGuideEvent(eventName, params) {
    if (window.EFAnalytics && typeof window.EFAnalytics.track === 'function') {
      window.EFAnalytics.track(eventName, params);
    }
  }

  function bindMediaQueryChange(query, handler) {
    if (query && typeof query.addEventListener === 'function') {
      query.addEventListener('change', handler);
    } else if (query && typeof query.addListener === 'function') {
      query.addListener(handler);
    }
  }

  function buildSideCardHTML(article, eager) {
    return `
      <a href="${escHtml(article.link)}" class="hero-side-card" data-analytics-event="guide_card_click" data-guide-slug="${escHtml(article.slug)}" data-guide-title="${escHtml(article.title)}" aria-label="Read guide: ${escHtml(article.title)}">
        <div class="hero-side-card__image-wrap">
          <img src="${escHtml(article.image)}" alt="" class="hero-side-card__image" loading="${eager ? 'eager' : 'lazy'}" width="400" height="260">
          <div class="hero-side-card__overlay" aria-hidden="true"></div>
        </div>
        <div class="hero-side-card__body">
          <span class="hero-side-card__category">${categoryEmoji[article.category] || ''} ${escHtml(article.category)}</span>
          <p class="hero-side-card__title">${escHtml(article.title)}</p>
          <span class="hero-side-card__footer">
            <span class="hero-side-card__meta">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              ${article.readTime} min read
            </span>
            <span class="hero-side-card__cta" aria-hidden="true">Read guide <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></span>
          </span>
        </div>
      </a>`;
  }

  function buildDots(count, activeIdx, dotsEl) {
    if (!dotsEl) {
      return;
    }
    dotsEl.innerHTML = '';
    for (let i = 0; i < count; i += 1) {
      const dot = document.createElement('span');
      dot.className = `hero-carousel-dot${i === activeIdx ? ' active' : ''}`;
      dotsEl.appendChild(dot);
    }
  }

  function initHeroCarousel() {
    const leftWrap = document.getElementById('hero-card-left');
    const rightWrap = document.getElementById('hero-card-right');
    const dotsLeft = document.getElementById('hero-dots-left');
    const dotsRight = document.getElementById('hero-dots-right');
    if (!leftWrap || !rightWrap) {
      return;
    }

    const featured = articles
      .filter(a => a.featured)
      .sort((a, b) => a.featuredOrder - b.featuredOrder);
    if (featured.length < 2) {
      return;
    }

    let idx = 0;
    let carouselInterval = null;
    const motionQuery = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false };

    function showPair(isFirst) {
      const leftIdx = idx % featured.length;
      const rightIdx = (idx + 1) % featured.length;
      const left = featured[leftIdx];
      const right = featured[rightIdx];

      if (motionQuery.matches || isFirst) {
        leftWrap.innerHTML = buildSideCardHTML(left, isFirst);
        rightWrap.innerHTML = buildSideCardHTML(right, isFirst);
      } else {
        leftWrap.style.opacity = '0';
        rightWrap.style.opacity = '0';
        setTimeout(() => {
          leftWrap.innerHTML = buildSideCardHTML(left, false);
          rightWrap.innerHTML = buildSideCardHTML(right, false);
          leftWrap.style.opacity = '1';
          rightWrap.style.opacity = '1';
        }, 280);
      }

      buildDots(featured.length, leftIdx, dotsLeft);
      buildDots(featured.length, rightIdx, dotsRight);
      idx = (idx + 1) % featured.length;
    }

    function startInterval() {
      if (carouselInterval) {
        clearInterval(carouselInterval);
      }
      if (!motionQuery.matches) {
        carouselInterval = setInterval(() => showPair(false), 5000);
      }
    }

    showPair(true);
    startInterval();
    bindMediaQueryChange(motionQuery, () => {
      if (motionQuery.matches) {
        clearInterval(carouselInterval);
        carouselInterval = null;
      } else {
        startInterval();
      }
    });
  }

  function buildChips() {
    if (!chipsWrap) {
      return;
    }
    const categories = [...new Set(articles.map(a => a.category).filter(Boolean))].sort();
    let html =
      '<button class="guides-chip active" data-filter="" role="radio" aria-checked="true">All guides</button>';
    categories.forEach(cat => {
      const em = categoryEmoji[cat] || '';
      html += `<button class="guides-chip" data-filter="${escHtml(cat)}" role="radio" aria-checked="false"><span class="guides-chip__icon" aria-hidden="true">${escHtml(em)}</span> ${escHtml(cat)}</button>`;
    });
    chipsWrap.innerHTML = html;
    chipsWrap.querySelectorAll('.guides-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter || '';
        chipsWrap.querySelectorAll('.guides-chip').forEach(b => {
          const isActive = b === btn;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-checked', isActive ? 'true' : 'false');
        });
        showAllGuides = false;
        updateClearBtn();
        renderGrid();
      });
    });
  }

  function handleSearch() {
    searchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
    if (searchClear) {
      searchClear.classList.toggle('visible', searchQuery.length > 0);
    }
    updateClearBtn();
    showAllGuides = false;
    renderGrid();
  }

  function scrollToGuides() {
    const section = document.getElementById('all-guides');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function clearSearch() {
    if (searchInput) {
      searchInput.value = '';
    }
    searchQuery = '';
    if (searchClear) {
      searchClear.classList.remove('visible');
    }
    updateClearBtn();
    showAllGuides = false;
    renderGrid();
  }

  function resetAll() {
    activeFilter = '';
    searchQuery = '';
    sortOrder = 'newest';
    showAllGuides = false;
    if (searchInput) {
      searchInput.value = '';
    }
    if (sortSelect) {
      sortSelect.value = 'newest';
    }
    if (searchClear) {
      searchClear.classList.remove('visible');
    }
    if (chipsWrap) {
      chipsWrap.querySelectorAll('.guides-chip').forEach(b => {
        const isAll = b.dataset.filter === '';
        b.classList.toggle('active', isAll);
        b.setAttribute('aria-checked', isAll ? 'true' : 'false');
      });
    }
    updateClearBtn();
    renderGrid();
  }

  function updateClearBtn() {
    if (!clearAllBtn) {
      return;
    }
    clearAllBtn.classList.toggle('visible', activeFilter !== '' || searchQuery !== '');
  }

  function getFiltered() {
    let list = articles.filter(a => {
      const matchCat = !activeFilter || a.category === activeFilter;
      const matchSearch =
        !searchQuery ||
        a.title.toLowerCase().includes(searchQuery) ||
        a.excerpt.toLowerCase().includes(searchQuery) ||
        a.category.toLowerCase().includes(searchQuery) ||
        a.tags.some(t => t.toLowerCase().includes(searchQuery));
      return matchCat && matchSearch;
    });

    if (sortOrder === 'az') {
      list = list.slice().sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortOrder === 'za') {
      list = list.slice().sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortOrder === 'category') {
      list = list.slice().sort((a, b) => a.category.localeCompare(b.category));
    } else {
      list = list
        .slice()
        .sort((a, b) => new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0));
    }
    return list;
  }

  function renderGrid() {
    if (!guidesGrid) {
      return;
    }
    const list = getFiltered();
    guidesGrid.querySelectorAll('.guide-card').forEach(c => c.remove());
    if (guidesLoading) {
      guidesLoading.style.display = 'none';
    }

    if (!list.length) {
      if (guidesEmpty) {
        guidesEmpty.classList.add('visible');
      }
      if (emptyMsg) {
        if (searchQuery && activeFilter) {
          emptyMsg.textContent = `No guides match "${searchInput ? searchInput.value : ''}" in ${activeFilter}. Try clearing a filter.`;
        } else if (searchQuery) {
          emptyMsg.textContent = `No guides match "${searchInput ? searchInput.value : ''}". Try a different search term.`;
        } else {
          emptyMsg.textContent = 'No guides in this category yet. More coming soon!';
        }
      }
      if (resultsCount) {
        resultsCount.innerHTML = '';
      }
      return;
    }

    if (guidesEmpty) {
      guidesEmpty.classList.remove('visible');
    }
    const totalLabel = list.length === 1 ? '1 guide' : `${list.length} guides`;
    const filterLabel = activeFilter ? ` in <strong>${escHtml(activeFilter)}</strong>` : '';
    const searchLabel =
      searchQuery && searchInput
        ? ` matching "<strong>${escHtml(searchInput.value)}</strong>"`
        : '';
    if (resultsCount) {
      resultsCount.innerHTML = `Showing <strong>${escHtml(totalLabel)}</strong>${filterLabel}${searchLabel}`;
    }

    const shouldCollapse = list.length > INITIAL_GUIDE_LIMIT && !showAllGuides;
    const visibleList = shouldCollapse ? list.slice(0, INITIAL_GUIDE_LIMIT) : list;

    visibleList.forEach((article, i) => {
      const card = document.createElement('article');
      card.className = 'guide-card animate-in';
      card.style.animationDelay = `${Math.min(i * 0.05, 0.3)}s`;
      card.innerHTML = `
        <div class="guide-card__image-wrap">
          <img src="${escHtml(article.image)}" alt="" class="guide-card__image" loading="${i < 4 ? 'eager' : 'lazy'}" width="640" height="360">
        </div>
        <div class="guide-card__body">
          <div class="guide-card__badges">
            <span class="guide-card__category">${categoryEmoji[article.category] || ''} ${escHtml(article.category)}</span>
            <span class="guide-card__tag">#${escHtml(article.primaryTag)}</span>
          </div>
          <h3 class="guide-card__title">${escHtml(article.title)}</h3>
          <p class="guide-card__summary"><strong>TL;DR:</strong> ${escHtml(article.summary)}</p>
          <p class="guide-card__excerpt">${escHtml(article.excerpt)}</p>
          <div class="guide-card__meta" aria-label="Guide details">
            <span class="guide-card__meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${article.readTime} min read</span>
            <span class="guide-card__meta-item guide-card__difficulty">${escHtml(article.difficulty)}</span>
            <span class="guide-card__meta-item">${escHtml(formatGuideDate(article.lastUpdated))}</span>
            ${article.affiliate ? '<span class="guide-card__partner-badge">Partner</span>' : ''}
          </div>
          <div class="guide-card__cta-row">
            <a href="${escHtml(article.link)}" class="guide-card__cta" data-analytics-event="guide_card_click" data-guide-slug="${escHtml(article.slug)}" data-guide-title="${escHtml(article.title)}" aria-label="Read guide: ${escHtml(article.title)}">Read guide <span class="guide-card__cta-arrow" aria-hidden="true">→</span></a>
            ${article.tool ? `<a href="${escHtml(article.tool.href)}" class="article-end-cta__tool guide-card__tool-link" aria-label="${escHtml(article.tool.label)}">${escHtml(article.tool.label)}</a>` : ''}
          </div>
        </div>`;
      guidesGrid.appendChild(card);
    });

    if (shouldCollapse) {
      const remainingCount = list.length - INITIAL_GUIDE_LIMIT;
      const moreCard = document.createElement('article');
      moreCard.className = 'guide-card guide-card--more animate-in';
      moreCard.style.animationDelay = '0.3s';
      moreCard.innerHTML = `
        <div class="guide-card--more__inner">
          <span class="guide-card--more__eyebrow">More guides</span>
          <h3 class="guide-card--more__title">${remainingCount} more ${remainingCount === 1 ? 'guide' : 'guides'} ready for you</h3>
          <p class="guide-card--more__text">Keep browsing the full EventFlow guide library without the fallback link list clutter.</p>
          <button class="guide-card--more__button" type="button">View all ${list.length} guides</button>
        </div>`;
      const moreButton = moreCard.querySelector('button');
      moreButton.addEventListener('click', () => {
        showAllGuides = true;
        renderGrid();
        requestAnimationFrame(() => {
          const firstRevealedCard = guidesGrid.children[INITIAL_GUIDE_LIMIT];
          if (firstRevealedCard) {
            firstRevealedCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });
      guidesGrid.appendChild(moreCard);
    }
  }

  async function fetchJson(url, required) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${url}`);
      }
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (required) {
        throw error;
      }
      return [];
    }
  }

  function normaliseGuide(g) {
    return {
      id: g.id,
      title: g.title || '',
      excerpt: g.excerpt || g.description || '',
      image: g.image || '',
      category: g.category || '',
      tags: Array.isArray(g.tags) ? g.tags : [],
      link: g.href || g.link || '',
      slug: (g.href || g.link || '').replace('/articles/', ''),
      summary: g.summary || g.excerpt || g.description || '',
      difficulty: g.difficulty || 'Beginner',
      primaryTag: g.primaryTag || (Array.isArray(g.tags) && g.tags[0]) || g.category || '',
      readTime: g.readingMins || g.readTime || 0,
      publishedDate: g.publishedDate || '',
      lastUpdated: g.lastUpdated || g.publishedDate || '',
      featured: g.featured || false,
      featuredOrder: g.featuredOrder || 999,
      affiliate: g.affiliate || false,
      tool: g.tool || null,
    };
  }

  async function loadGuides() {
    try {
      const baseGuides = await fetchJson('/assets/data/guides.json', true);
      const byHref = new Map();
      baseGuides.forEach(guide => {
        if (guide && (guide.href || guide.link)) {
          byHref.set(guide.href || guide.link, guide);
        }
      });
      articles = Array.from(byHref.values()).map(normaliseGuide);
      initHeroCarousel();
      buildChips();
      renderGrid();
      if (guidesNoJsList) {
        guidesNoJsList.hidden = true;
      }
    } catch (_) {
      if (guidesLoading) {
        guidesLoading.style.display = 'none';
      }
      if (guidesEmpty) {
        guidesEmpty.classList.add('visible');
        if (emptyMsg) {
          emptyMsg.textContent =
            'Unable to load guides. Please check your connection or try refreshing the page.';
        }
      }
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', handleSearch);
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        clearSearch();
      }
      if (e.key === 'Enter') {
        handleSearch();
        scrollToGuides();
      }
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', clearSearch);
  }
  const searchBtn = document.getElementById('guides-search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      handleSearch();
      scrollToGuides();
    });
  }
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      sortOrder = sortSelect.value;
      showAllGuides = false;
      renderGrid();
    });
  }
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', resetAll);
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', resetAll);
  }

  document.addEventListener('click', event => {
    const target = event.target.closest('[data-analytics-event="guide_card_click"]');
    if (!target) {
      return;
    }
    trackGuideEvent('guide_card_click', {
      guide_slug: target.dataset.guideSlug || '',
      guide_title: target.dataset.guideTitle || target.textContent.trim(),
      location: target.classList.contains('hero-side-card') ? 'guides_hero' : 'guides_grid',
    });
  });

  (function bindAuthGate() {
    const authModal = document.getElementById('guides-auth-modal');
    const authModalClose = document.getElementById('guides-auth-modal-close');
    const authModalBg = document.getElementById('guides-auth-modal-backdrop');
    const authModalSkip = document.getElementById('guides-auth-modal-skip');
    const authModalLogin = document.getElementById('guides-auth-modal-login');
    const authModalReg = document.getElementById('guides-auth-modal-register');
    if (!authModal) {
      return;
    }

    function openAuthModal(targetHref) {
      const redirect = encodeURIComponent(targetHref);
      if (authModalLogin) {
        authModalLogin.href = `/auth?redirect=${redirect}`;
      }
      if (authModalReg) {
        authModalReg.href = `/auth?action=register&redirect=${redirect}`;
      }
      authModal.hidden = false;
      document.body.style.overflow = 'hidden';
      if (authModalClose) {
        authModalClose.focus();
      }
    }

    function closeAuthModal() {
      authModal.hidden = true;
      document.body.style.overflow = '';
    }

    if (authModalClose) {
      authModalClose.addEventListener('click', closeAuthModal);
    }
    if (authModalBg) {
      authModalBg.addEventListener('click', closeAuthModal);
    }
    if (authModalSkip) {
      authModalSkip.addEventListener('click', closeAuthModal);
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !authModal.hidden) {
        closeAuthModal();
      }
    });

    document.querySelectorAll('.guides-tool-card, .guides-tools__cta-btn').forEach(el => {
      el.addEventListener('click', async e => {
        e.preventDefault();
        const href = el.getAttribute('href') || '/';
        if (window.AuthStateManager) {
          try {
            await window.AuthStateManager.init();
          } catch (_) {
            /* ignore */
          }
          if (window.AuthStateManager.user) {
            window.location.href = href;
            return;
          }
        }
        openAuthModal(href);
      });
    });
  })();

  // Guide card images are hotlinked from Pexels; if one fails (rate limit,
  // network, removed photo) swap to a local placeholder instead of showing
  // a broken-image glyph. Two layers: a capture-phase error listener for
  // late failures, plus periodic sweeps that catch images which rendered
  // (or re-rendered) into a broken state regardless of event ordering.
  const GUIDE_IMG_SELECTOR = '.guide-card__image, .hero-side-card__image';
  const GUIDE_IMG_FALLBACK = '/assets/images/placeholders/package-event.svg';

  function applyGuideImageFallback(img) {
    if (!img || img.dataset.fallbackApplied === 'done') {
      return;
    }
    img.dataset.fallbackApplied = 'done';
    img.setAttribute('src', GUIDE_IMG_FALLBACK);
  }

  document.addEventListener(
    'error',
    e => {
      const img = e.target;
      if (img?.tagName === 'IMG' && img.matches?.(GUIDE_IMG_SELECTOR)) {
        applyGuideImageFallback(img);
      }
    },
    true
  );

  function sweepBrokenGuideImages() {
    document.querySelectorAll(GUIDE_IMG_SELECTOR).forEach(img => {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
        applyGuideImageFallback(img);
      }
    });
  }

  window.addEventListener('load', sweepBrokenGuideImages);
  [1500, 4000].forEach(ms => setTimeout(sweepBrokenGuideImages, ms));

  loadGuides();
});
