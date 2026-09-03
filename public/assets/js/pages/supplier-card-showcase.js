/**
 * Supplier Card Showcase — demo page interactivity
 * Shows live viewport dimensions in the header and bootstraps the
 * package carousels so the cards look identical to the live suppliers page.
 */
'use strict';
(function () {
  // ── Viewport label ─────────────────────────────────────────────────────────
  const lbl = document.getElementById('viewport-label');
  function updateLabel() {
    if (lbl) {
      lbl.textContent = `Supplier Cards — viewport: ${window.innerWidth}px \u00d7 ${
        window.innerHeight
      }px`;
    }
  }
  updateLabel();
  window.addEventListener('resize', updateLabel);

  // ── Carousel init (mirrors suppliers-init.js logic) ────────────────────────
  const MOBILE_BP = 640;

  function attachCarousels() {
    const visibleCount = window.innerWidth <= MOBILE_BP ? 1 : 2;
    document.querySelectorAll('.sp-pkg-carousel').forEach(carousel => {
      const track = carousel.querySelector('.sp-pkg-carousel-track');
      const prevBtn = carousel.querySelector('.sp-pkg-arrow--prev');
      const nextBtn = carousel.querySelector('.sp-pkg-arrow--next');
      if (!track || !prevBtn || !nextBtn) {
        return;
      }
      const items = Array.from(track.querySelectorAll('.sp-pkg-mini'));
      const total = items.length;
      if (total <= visibleCount) {
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      let idx = 0;
      const maxIdx = total - visibleCount;

      function getStep() {
        const gap = parseFloat(getComputedStyle(track).columnGap) || 6;
        return items[0] ? items[0].getBoundingClientRect().width + gap : 212;
      }

      function update() {
        track.style.transform = `translateX(${-idx * getStep()}px)`;
        prevBtn.disabled = idx === 0;
        nextBtn.disabled = idx >= maxIdx;
      }

      prevBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (idx > 0) {
          idx--;
          update();
        }
      });
      nextBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (idx < maxIdx) {
          idx++;
          update();
        }
      });
      update();
    });
  }

  attachCarousels();
  window.addEventListener('resize', () => {
    attachCarousels();
  });
})();
