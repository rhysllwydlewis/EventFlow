(() => {
  'use strict';

  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const categoryField = document.getElementById('hv2-category');
  const keywordField = document.getElementById('hv2-keyword');
  const locationField = document.getElementById('hv2-location');
  const searchForm = document.querySelector('.hv2-search');
  const heroImage = document.querySelector('.hv2-hero__image');
  const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');
  const revealTargets = document.querySelectorAll(
    ['.hv2-category', '.hv2-dashboard', '.hv2-supplier-band__grid'].join(', ')
  );
  const isHomeV3Preview = window.__EF_HOME_V3_PREVIEW__ === true;

  const pexelsImageParams = 'auto=compress&cs=tinysrgb&w=2600&h=1600&fit=crop';
  const eventDecorHeroFallbackImages = [
    {
      url: `https://images.pexels.com/photos/265947/pexels-photo-265947.jpeg?${pexelsImageParams}`,
      position: 'center right',
    },
    {
      url: `https://images.pexels.com/photos/169190/pexels-photo-169190.jpeg?${pexelsImageParams}`,
      position: 'center right',
    },
    {
      url: `https://images.pexels.com/photos/587741/pexels-photo-587741.jpeg?${pexelsImageParams}`,
      position: 'center center',
    },
    {
      url: `https://images.pexels.com/photos/931162/pexels-photo-931162.jpeg?${pexelsImageParams}`,
      position: 'center right',
    },
  ];
  const weddingCoupleHeroFallbackImages = [
    {
      url: `https://images.pexels.com/photos/15536198/pexels-photo-15536198.jpeg?${pexelsImageParams}`,
      position: 'center center',
    },
    {
      url: `https://images.pexels.com/photos/5037207/pexels-photo-5037207.jpeg?${pexelsImageParams}`,
      position: 'center center',
    },
    {
      url: `https://images.pexels.com/photos/13024233/pexels-photo-13024233.jpeg?${pexelsImageParams}`,
      position: 'center 45%',
    },
    {
      url: `https://images.pexels.com/photos/30739915/pexels-photo-30739915.jpeg?${pexelsImageParams}`,
      position: 'center center',
    },
  ];
  const heroFallbackImages = isHomeV3Preview
    ? weddingCoupleHeroFallbackImages
    : eventDecorHeroFallbackImages;

  const pexelsHeroQueries = [
    'luxury wedding reception table flowers warm lights',
    'elegant wedding reception table centrepiece candles',
    'premium event dining table floral arrangement',
    'wedding breakfast table flowers glasses soft light',
    'white floral wedding reception tablescape',
    'luxury banquet table flowers string lights',
  ];

  const preferredHeroWords = [
    'reception',
    'table',
    'tablescape',
    'dining',
    'dinner',
    'flowers',
    'floral',
    'centrepiece',
    'centerpiece',
    'glasses',
    'chairs',
    'lights',
    'wedding',
    'event',
    'decor',
    'banquet',
    'restaurant',
  ];

  const weakHeroWords = [
    'person',
    'woman',
    'man',
    'bride',
    'groom',
    'portrait',
    'dress',
    'close up',
    'bouquet only',
    'hand',
    'makeup',
    'cake',
  ];

  function containsAny(text, words) {
    return words.some(word => text.includes(word));
  }

  function closeMenu() {
    if (!menuButton || !mobileNav) {
      return;
    }

    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.setAttribute('aria-label', 'Open navigation menu');
    mobileNav.hidden = true;
  }

  function normaliseHeroImage(heroCandidate) {
    if (typeof heroCandidate === 'string') {
      return { position: 'center right', url: heroCandidate };
    }

    return {
      position: heroCandidate.position || 'center right',
      url: heroCandidate.url || '',
    };
  }

  function setHeroBackground(heroCandidate) {
    if (!heroImage) {
      return;
    }

    const hero = normaliseHeroImage(heroCandidate);

    if (!hero.url) {
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    heroImage.classList.add('is-changing');

    image.onload = () => {
      heroImage.style.setProperty('--hv2-hero-bg', `url('${hero.url}')`);
      heroImage.style.setProperty('--hv2-hero-position', hero.position);
      window.setTimeout(() => heroImage.classList.remove('is-changing'), 260);
    };

    image.onerror = () => heroImage.classList.remove('is-changing');
    image.src = hero.url;
  }

  function getPhotoUrl(photo) {
    if (!photo || !photo.src) {
      return '';
    }

    return photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original || '';
  }

  function inferHeroPosition(photo) {
    const alt = `${photo.alt || ''}`.toLowerCase();

    if (containsAny(alt, ['table', 'tablescape', 'banquet', 'dining'])) {
      return 'center right';
    }

    if (containsAny(alt, ['flowers', 'floral', 'centrepiece', 'centerpiece'])) {
      return 'center center';
    }

    return 'center right';
  }

  function scoreHeroPhoto(photo) {
    if (!photo || !photo.src) {
      return -100;
    }

    const alt = `${photo.alt || ''} ${photo.photographer || ''}`.toLowerCase();
    const isLandscape = !photo.width || !photo.height || photo.width >= photo.height;
    let score = isLandscape ? 10 : -28;

    preferredHeroWords.forEach(word => {
      if (alt.includes(word)) {
        score += 4;
      }
    });

    weakHeroWords.forEach(word => {
      if (alt.includes(word)) {
        score -= 10;
      }
    });

    if (photo.width && photo.width >= 2200) {
      score += 5;
    }

    if (photo.height && photo.height >= 1200) {
      score += 4;
    }

    if (containsAny(alt, ['reception', 'tablescape', 'dining table', 'wedding table'])) {
      score += 14;
    }

    if (containsAny(alt, ['close-up', 'closeup', 'bouquet'])) {
      score -= 12;
    }

    return score;
  }

  async function fetchPexelsHeroImages() {
    const seenUrls = new Set();
    const candidates = [];

    for (const query of pexelsHeroQueries) {
      try {
        const response = await fetch(
          `/api/pexels/search?q=${encodeURIComponent(query)}&per_page=12`
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const photos = Array.isArray(data.photos) ? data.photos : [];

        photos.forEach(photo => {
          const url = getPhotoUrl(photo);
          const score = scoreHeroPhoto(photo);

          if (!url || seenUrls.has(url) || score < 12) {
            return;
          }

          seenUrls.add(url);
          candidates.push({
            position: inferHeroPosition(photo),
            score,
            url,
          });
        });
      } catch {
        return candidates.sort((a, b) => b.score - a.score);
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  function getReduceMotionPreference() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  async function initialiseHeroImages() {
    if (!heroImage) {
      return;
    }

    const reduceMotion = getReduceMotionPreference();
    const pexelsImages = isHomeV3Preview ? [] : await fetchPexelsHeroImages();
    const heroImages = [...pexelsImages, ...heroFallbackImages].filter(candidate => {
      return normaliseHeroImage(candidate).url;
    });

    if (heroImages.length === 0) {
      return;
    }

    setHeroBackground(heroImages[0]);

    if (reduceMotion || heroImages.length < 2) {
      return;
    }

    let imageIndex = 0;
    window.setInterval(() => {
      imageIndex = (imageIndex + 1) % heroImages.length;
      setHeroBackground(heroImages[imageIndex]);
    }, 13500);
  }

  function initialiseMenu() {
    if (!menuButton || !mobileNav) {
      return;
    }

    menuButton.addEventListener('click', () => {
      const isOpen = menuButton.getAttribute('aria-expanded') === 'true';
      menuButton.setAttribute('aria-expanded', String(!isOpen));
      menuButton.setAttribute(
        'aria-label',
        isOpen ? 'Open navigation menu' : 'Close navigation menu'
      );
      mobileNav.hidden = isOpen;
    });

    mobileNav.addEventListener('click', event => {
      if (event.target instanceof HTMLAnchorElement) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    });

    document.addEventListener('focusin', event => {
      if (!mobileNav.hidden && !mobileNav.contains(event.target) && event.target !== menuButton) {
        closeMenu();
      }
    });
  }

  function initialisePopularSearches() {
    popularButtons.forEach(button => {
      button.addEventListener('click', () => {
        if (categoryField) {
          categoryField.value = button.dataset.category || '';
        }

        if (keywordField) {
          keywordField.value = button.textContent.trim();
        }

        if (locationField && button.dataset.location) {
          locationField.value = button.dataset.location;
        }

        if (searchForm) {
          searchForm.requestSubmit();
        }
      });
    });
  }

  function initialiseSearchState() {
    if (!searchForm) {
      return;
    }

    searchForm.addEventListener('submit', () => {
      const submitButton = searchForm.querySelector('.hv2-search__button');

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }
    });
  }

  function initialiseReveals() {
    if (
      getReduceMotionPreference() ||
      revealTargets.length === 0 ||
      !('IntersectionObserver' in window)
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) {
            return;
          }

          entry.target.classList.add('hv2-reveal');
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.12 }
    );

    revealTargets.forEach(target => observer.observe(target));
  }

  initialiseMenu();
  initialisePopularSearches();
  initialiseSearchState();
  initialiseReveals();
  initialiseHeroImages();
})();
