(() => {
  'use strict';

  const menuButton = document.querySelector('.hv2-menu');
  const mobileNav = document.getElementById('hv2-mobile-nav');
  const categoryField = document.getElementById('hv2-category');
  const searchForm = document.querySelector('.hv2-search');
  const heroImage = document.querySelector('.hv2-hero__image');
  const popularButtons = document.querySelectorAll('.hv2-popular button[data-category]');

  const pexelsImageParams = 'auto=compress&cs=tinysrgb&w=2400&h=1500&fit=crop';
  const heroFallbackImageIds = ['169190', '265947', '587741', '1128783'];
  const heroFallbackImages = heroFallbackImageIds.map(
    id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?${pexelsImageParams}`
  );

  const pexelsHeroQueries = [
    'luxury wedding reception table flowers warm lights',
    'elegant wedding table flowers glasses reception',
    'premium event table flowers chairs soft light',
    'white floral wedding reception tablescape',
  ];

  const heroCueWords = [
    'wedding',
    'reception',
    'tablescape',
    'table',
    'flowers',
    'floral',
    'event',
    'dining',
    'decor',
    'lights',
    'chairs',
  ];

  const heroAvoidWords = ['person', 'woman', 'man', 'bride', 'groom', 'portrait', 'dress close'];

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

  function setHeroBackground(url) {
    if (!heroImage || !url) {
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    heroImage.classList.add('is-changing');
    image.onload = () => {
      heroImage.style.setProperty('--hv2-hero-bg', `url('${url}')`);
      window.setTimeout(() => heroImage.classList.remove('is-changing'), 260);
    };
    image.onerror = () => heroImage.classList.remove('is-changing');
    image.src = url;
  }

  function getPhotoUrl(photo) {
    if (!photo || !photo.src) {
      return '';
    }

    return photo.src.landscape || photo.src.large2x || photo.src.large || photo.src.original || '';
  }

  function isUsefulHeroPhoto(photo) {
    const alt = `${photo.alt || ''} ${photo.photographer || ''}`.toLowerCase();
    const isLandscape = !photo.width || !photo.height || photo.width >= photo.height;
    const hasEventCue = containsAny(alt, heroCueWords);
    const avoidPortraitCue = containsAny(alt, heroAvoidWords);

    return isLandscape && hasEventCue && !avoidPortraitCue;
  }

  async function fetchPexelsHeroImages() {
    const urls = [];

    for (const query of pexelsHeroQueries) {
      try {
        const response = await fetch(
          `/api/pexels/search?q=${encodeURIComponent(query)}&per_page=8`
        );

        if (!response.ok) {
          continue;
        }

        const data = await response.json();
        const photos = Array.isArray(data.photos) ? data.photos : [];
        photos
          .filter(isUsefulHeroPhoto)
          .map(getPhotoUrl)
          .filter(Boolean)
          .forEach(url => {
            if (!urls.includes(url)) {
              urls.push(url);
            }
          });
      } catch {
        return urls;
      }
    }

    return urls;
  }

  async function initialiseHeroImages() {
    if (!heroImage) {
      return;
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pexelsImages = await fetchPexelsHeroImages();
    const heroImages = [...heroFallbackImages, ...pexelsImages].filter(Boolean);

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
    }, 11000);
  }

  if (menuButton && mobileNav) {
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

  popularButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (categoryField) {
        categoryField.value = button.dataset.category || '';
      }
      if (searchForm) {
        searchForm.requestSubmit();
      }
    });
  });

  if (searchForm) {
    searchForm.addEventListener('submit', () => {
      const submitButton = searchForm.querySelector('.hv2-search__button');
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute('aria-busy', 'true');
      }
    });
  }

  initialiseHeroImages();
})();
