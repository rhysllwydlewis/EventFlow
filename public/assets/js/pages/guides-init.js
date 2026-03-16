window.__EF_PAGE__ = 'guides';

document.addEventListener('DOMContentLoaded', () => {
  // ──────────────────────────────────────────────
  //  DATA
  // ──────────────────────────────────────────────
  let articles = [];

  // Category emoji map
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
  };

  // ──────────────────────────────────────────────
  //  HELPERS
  // ──────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ──────────────────────────────────────────────
  //  STATE
  // ──────────────────────────────────────────────
  let activeFilter = '';
  let searchQuery = '';
  let sortOrder = 'newest';

  const searchInput = document.getElementById('guides-search-input');
  const searchClear = document.getElementById('guides-search-clear');
  const guidesGrid = document.getElementById('guides-grid');
  const guidesLoading = document.getElementById('guides-loading');
  const guidesEmpty = document.getElementById('guides-empty');
  const emptyMsg = document.getElementById('guides-empty-msg');
  const chipsWrap = document.getElementById('guides-chips');
  const sortSelect = document.getElementById('guides-sort');
  const clearAllBtn = document.getElementById('guides-clear-all');
  const resetBtn = document.getElementById('guides-reset-btn');
  const resultsCount = document.getElementById('guides-results-count');

  // ──────────────────────────────────────────────
  //  HERO CAROUSEL
  // ──────────────────────────────────────────────
  function buildSideCardHTML(article, eager) {
    return `
        <a href="${escHtml(article.link)}" class="hero-side-card" aria-label="Read guide: ${escHtml(article.title)}">
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
              <span class="hero-side-card__cta" aria-hidden="true">
                Read guide
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </span>
            </span>
          </div>
        </a>
      `;
  }

  function buildDots(count, activeIdx, dotsEl) {
    if (!dotsEl) {
      return;
    }
    dotsEl.innerHTML = '';
    for (let i = 0; i < count; i++) {
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
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

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

    // Respond to live changes in the user's motion preference
    motionQuery.addEventListener('change', () => {
      if (motionQuery.matches) {
        clearInterval(carouselInterval);
        carouselInterval = null;
      } else {
        startInterval();
      }
    });
  }

  // ──────────────────────────────────────────────
  //  FILTER CHIPS
  // ──────────────────────────────────────────────
  function buildChips() {
    if (!chipsWrap) {
      return;
    }
    const categories = [...new Set(articles.map(a => a.category))].sort();

    let html = `<button class="guides-chip active" data-filter="" role="radio" aria-checked="true">All guides</button>`;
    categories.forEach(cat => {
      const em = categoryEmoji[cat] || '';
      html += `<button class="guides-chip" data-filter="${cat}" role="radio" aria-checked="false">
          <span class="guides-chip__icon" aria-hidden="true">${em}</span> ${cat}
        </button>`;
    });
    chipsWrap.innerHTML = html;

    chipsWrap.querySelectorAll('.guides-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        activeFilter = btn.dataset.filter;
        chipsWrap.querySelectorAll('.guides-chip').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
        });
        updateClearBtn();
        renderGrid();
      });
    });
  }

  // ──────────────────────────────────────────────
  //  SEARCH
  // ──────────────────────────────────────────────
  function handleSearch() {
    searchQuery = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('visible', searchQuery.length > 0);
    updateClearBtn();
    renderGrid();
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
    searchClear.classList.remove('visible');
    updateClearBtn();
    renderGrid();
  }

  // ──────────────────────────────────────────────
  //  SORT
  // ──────────────────────────────────────────────
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      sortOrder = sortSelect.value;
      renderGrid();
    });
  }

  // ──────────────────────────────────────────────
  //  CLEAR ALL
  // ──────────────────────────────────────────────
  function resetAll() {
    activeFilter = '';
    searchQuery = '';
    sortOrder = 'newest';
    if (searchInput) {
      searchInput.value = '';
    }
    if (sortSelect) {
      sortSelect.value = 'newest';
    }
    searchClear.classList.remove('visible');
    chipsWrap.querySelectorAll('.guides-chip').forEach(b => {
      const isAll = b.dataset.filter === '';
      b.classList.toggle('active', isAll);
      b.setAttribute('aria-checked', isAll ? 'true' : 'false');
    });
    updateClearBtn();
    renderGrid();
  }

  clearAllBtn.addEventListener('click', resetAll);
  resetBtn.addEventListener('click', resetAll);

  function updateClearBtn() {
    const hasFilter = activeFilter !== '' || searchQuery !== '';
    clearAllBtn.classList.toggle('visible', hasFilter);
  }

  // ──────────────────────────────────────────────
  //  FILTER + SORT
  // ──────────────────────────────────────────────
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
      // newest: sort by publishedDate descending
      list = list
        .slice()
        .sort((a, b) => new Date(b.publishedDate || 0) - new Date(a.publishedDate || 0));
    }
    return list;
  }

  // ──────────────────────────────────────────────
  //  RENDER GRID
  // ──────────────────────────────────────────────
  function renderGrid() {
    const list = getFiltered();

    // Remove all existing cards (not loading/empty placeholders)
    guidesGrid.querySelectorAll('.guide-card').forEach(c => c.remove());

    if (guidesLoading) {
      guidesLoading.style.display = 'none';
    }

    if (list.length === 0) {
      guidesEmpty.classList.add('visible');
      if (searchQuery && activeFilter) {
        emptyMsg.textContent = `No guides match "${searchInput.value}" in ${activeFilter}. Try clearing a filter.`;
      } else if (searchQuery) {
        emptyMsg.textContent = `No guides match "${searchInput.value}". Try a different search term.`;
      } else {
        emptyMsg.textContent = `No guides in this category yet. More coming soon!`;
      }
      resultsCount.innerHTML = '';
    } else {
      guidesEmpty.classList.remove('visible');
      const totalLabel = list.length === 1 ? '1 guide' : `${list.length} guides`;
      const filterLabel = activeFilter ? ` in <strong>${escHtml(activeFilter)}</strong>` : '';
      const searchLabel = searchQuery
        ? ` matching "<strong>${escHtml(searchInput.value)}</strong>"`
        : '';
      resultsCount.innerHTML = `Showing <strong>${escHtml(totalLabel)}</strong>${filterLabel}${searchLabel}`;
    }

    list.forEach((article, i) => {
      const card = document.createElement('article');
      card.className = 'guide-card animate-in';
      card.style.animationDelay = `${Math.min(i * 0.05, 0.3)}s`;
      card.innerHTML = `
          <div class="guide-card__image-wrap">
            <img src="${escHtml(article.image)}" alt="" class="guide-card__image" loading="${i < 4 ? 'eager' : 'lazy'}" width="640" height="360">
          </div>
          <div class="guide-card__body">
            <span class="guide-card__category">${categoryEmoji[article.category] || ''} ${escHtml(article.category)}</span>
            <h3 class="guide-card__title">${escHtml(article.title)}</h3>
            <p class="guide-card__excerpt">${escHtml(article.excerpt)}</p>
            <div class="guide-card__meta">
              <span class="guide-card__meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                ${article.readTime} min read
              </span>
              ${article.affiliate ? '<span class="guide-card__partner-badge">Partner</span>' : ''}
            </div>
            <div class="guide-card__cta-row">
              <a href="${escHtml(article.link)}" class="guide-card__cta" aria-label="Read guide: ${escHtml(article.title)}">
                Read guide <span class="guide-card__cta-arrow" aria-hidden="true">→</span>
              </a>
              ${article.tool ? `<a href="${escHtml(article.tool.href)}" class="article-end-cta__tool guide-card__tool-link" aria-label="${escHtml(article.tool.label)}">${escHtml(article.tool.label)}</a>` : ''}
            </div>
          </div>
        `;
      guidesGrid.appendChild(card);
    });
  }

  // ──────────────────────────────────────────────
  //  INIT — load data then render
  // ──────────────────────────────────────────────
  fetch('/assets/data/guides.json')
    .then(r => r.json())
    .then(data => {
      articles = data.map(g => ({
        id: g.id,
        title: g.title,
        excerpt: g.excerpt || g.description || '',
        image: g.image || '',
        category: g.category || '',
        tags: Array.isArray(g.tags) ? g.tags : [],
        link: g.href || g.link || '',
        readTime: g.readingMins || g.readTime || 0,
        publishedDate: g.publishedDate || '',
        featured: g.featured || false,
        featuredOrder: g.featuredOrder || 999,
        affiliate: g.affiliate || false,
        tool: g.tool || null,
      }));
      initHeroCarousel();
      buildChips();
      renderGrid();
    })
    .catch(() => {
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
    });

  // ──────────────────────────────────────────────
  //  AUTH GATE FOR PLANNING TOOLS
  // ──────────────────────────────────────────────
  (function () {
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
      // Append redirect so user lands on the tool after signing in
      const redirect = encodeURIComponent(targetHref);
      if (authModalLogin) {
        authModalLogin.href = `/auth?redirect=${redirect}`;
      }
      if (authModalReg) {
        authModalReg.href = `/auth?action=register&redirect=${redirect}`;
      }
      authModal.hidden = false;
      document.body.style.overflow = 'hidden';
      // Focus the close button for keyboard users
      authModalClose && authModalClose.focus();
    }

    function closeAuthModal() {
      authModal.hidden = true;
      document.body.style.overflow = '';
    }

    authModalClose && authModalClose.addEventListener('click', closeAuthModal);
    authModalBg && authModalBg.addEventListener('click', closeAuthModal);
    authModalSkip && authModalSkip.addEventListener('click', closeAuthModal);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !authModal.hidden) {
        closeAuthModal();
      }
    });

    // Intercept clicks on every tool card and the CTA button
    const toolTargets = document.querySelectorAll('.guides-tool-card, .guides-tools__cta-btn');
    toolTargets.forEach(el => {
      el.addEventListener('click', async e => {
        e.preventDefault();
        const href = el.getAttribute('href') || '/';

        // If AuthStateManager is available, wait for it to resolve
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
});
