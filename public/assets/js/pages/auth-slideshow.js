/**
 * Auth Page Slideshow — Live Pexels Integration
 *
 * Fetches event-themed photos through our public backend proxy and populates
 * the left-panel crossfading slideshow on desktop.
 *
 * Behaviour:
 * - Only activates on screens ≥ 768 px wide (the left panel is hidden on mobile).
 * - Calls GET /api/public/auth-photos which returns up to 8 Pexels photos or
 *   curated fallback URLs when the Pexels API key is not configured.
 * - Preloads each image before swapping the CSS background-image so there is
 *   no flash of empty/broken content.
 * - Rotates through all returned photos — each slot swaps its image during its
 *   own dark/invisible window so the transition is seamless.
 * - Shows a Pexels attribution credit in #auth-panel-credit as required by the
 *   Pexels licence; credit updates as photos cycle.
 * - Respects prefers-reduced-motion: loads photos statically with no rotation.
 * - If anything fails the static CSS background-images remain in place.
 */

(function () {
  'use strict';

  // Left panel is CSS-hidden on mobile — skip unnecessary work.
  if (!window.matchMedia('(min-width: 768px)').matches) {
    return;
  }

  const API_URL = '/api/public/auth-photos';

  // CSS animation cycle is 32 s; each slot's delay is 0/8/16/24 s.
  // A slot enters its dark (opacity≈0) window at delay + 30% of cycle (= delay + 9600 ms).
  // We schedule background swaps at that moment so the change is invisible.
  // Slot 4 (delay 24 s): dark window starts at 33 600 ms — 1 600 ms into the 2nd cycle.
  const CYCLE_MS = 32000;
  const SLOT_SAFE_OFFSETS_MS = [9600, 17600, 25600, 33600]; // per-slot first safe swap time (ms from animation start)

  const photoSlots = [
    document.querySelector('.auth-panel-photo--1'),
    document.querySelector('.auth-panel-photo--2'),
    document.querySelector('.auth-panel-photo--3'),
    document.querySelector('.auth-panel-photo--4'),
  ].filter(Boolean);

  if (photoSlots.length === 0) {
    return;
  }

  const creditEl = document.getElementById('auth-panel-credit');
  const photosContainer = document.querySelector('.auth-panel-photos');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- helpers ---

  const preloadImage = url =>
    new Promise(resolve => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = resolve; // resolve even on error so Promise.all never rejects
      img.src = url;
    });

  const toSafeCssUrl = url => {
    const encoded = encodeURI(url).replace(/'/g, '%27').replace(/\)/g, '%29');
    return `url('${encoded}')`;
  };

  const setCredit = photo => {
    if (!creditEl || !photo) {
      return;
    }
    const photographer = photo.photographer || 'Pexels';
    const pUrl = photo.photographerUrl || 'https://www.pexels.com';

    // Build DOM nodes (no innerHTML) to stay XSS-safe.
    creditEl.textContent = '';

    const photographerLink = document.createElement('a');
    photographerLink.href = pUrl;
    photographerLink.target = '_blank';
    photographerLink.rel = 'noopener noreferrer';
    photographerLink.textContent = photographer;

    const pexelsLink = document.createElement('a');
    pexelsLink.href = 'https://www.pexels.com';
    pexelsLink.target = '_blank';
    pexelsLink.rel = 'noopener noreferrer';
    pexelsLink.textContent = 'Pexels';

    creditEl.appendChild(document.createTextNode('Photo by '));
    creditEl.appendChild(photographerLink);
    creditEl.appendChild(document.createTextNode(' on '));
    creditEl.appendChild(pexelsLink);

    // Trigger fade-in transition (CSS handles the animation).
    creditEl.classList.remove('auth-panel-credit--fade');
    // Force reflow so removing then adding the class creates a new transition.
    void creditEl.offsetWidth; // eslint-disable-line no-void
    creditEl.classList.add('auth-panel-credit--fade');
  };

  // --- photo application ---

  const applyInitial = (photos, allPhotos) => {
    const slots = photos.slice(0, photoSlots.length);

    Promise.all(slots.map(p => preloadImage(p.url))).then(() => {
      // Remove loading shimmer once first batch is ready.
      if (photosContainer) {
        photosContainer.classList.remove('auth-photos--loading');
      }

      slots.forEach((photo, i) => {
        photoSlots[i].style.backgroundImage = toSafeCssUrl(photo.url);
      });

      setCredit(photos[0]);

      // Schedule rotation through remaining photos.
      // Only runs when we have strictly more photos than slots AND the user
      // hasn't opted in to reduced motion.
      if (!reducedMotion && allPhotos.length > photoSlots.length) {
        scheduleRotation(allPhotos);
      }
    });
  };

  // Per-slot rotation: each slot independently cycles through photos beyond
  // the initial batch, swapping its image during its own dark window.
  const scheduleRotation = allPhotos => {
    photoSlots.forEach((slot, slotIndex) => {
      const safeOffset = SLOT_SAFE_OFFSETS_MS[slotIndex];
      let cycleCount = 1; // slot already shows photos[slotIndex] from cycle 0

      const doSwap = () => {
        // Cycle: slot 0 → photos[4,8,...], slot 1 → photos[5,9,...] etc.
        const nextIdx = (slotIndex + cycleCount * photoSlots.length) % allPhotos.length;
        slot.style.backgroundImage = toSafeCssUrl(allPhotos[nextIdx].url);

        // Credit tracks slot 0's photo (first photo visible after slot 0 fades in).
        if (slotIndex === 0) {
          setCredit(allPhotos[nextIdx]);
        }

        cycleCount++;
      };

      // First swap happens at the end of the first dark window (safeOffset ms after
      // animation start), then repeats every full cycle thereafter.
      setTimeout(() => {
        doSwap();
        setInterval(doSwap, CYCLE_MS);
      }, safeOffset);
    });
  };

  // --- fetch & init ---

  const loadSlideshow = () => {
    // Show loading shimmer while photos are in-flight.
    if (photosContainer) {
      photosContainer.classList.add('auth-photos--loading');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch(API_URL, { signal: controller.signal })
      .then(res => {
        clearTimeout(timeoutId);
        if (!res.ok) {
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data || !data.photos || data.photos.length === 0) {
          if (photosContainer) {
            photosContainer.classList.remove('auth-photos--loading');
          }
          return;
        }
        applyInitial(data.photos, data.photos);
      })
      .catch(() => {
        clearTimeout(timeoutId);
        // Silently fall back — the static CSS background-images remain in place.
        if (photosContainer) {
          photosContainer.classList.remove('auth-photos--loading');
        }
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSlideshow);
  } else {
    loadSlideshow();
  }
})();
