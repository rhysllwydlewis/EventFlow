'use strict';
/**
 * Homepage flow layer (pairs with assets/css/homepage-flow.css).
 *
 * Adds the things CSS alone cannot: curved seams between colour bands, the
 * hero's floating decoration repeated down the page, and the hero's
 * highlighter-pen underline on each section heading. Purely visual: it never
 * changes what a section says or links to, and it does nothing unless
 * homepage-approved-lower.js has already claimed the page.
 */
(function () {
  const WAVE_PATHS = {
    top: 'M0 0H1440V30C1260 64 1080 64 900 36C720 8 540 8 360 36C240 56 120 60 0 40Z',
    bottom: 'M0 64H1440V34C1260 0 1080 0 900 28C720 56 540 56 360 28C240 8 120 4 0 24Z',
  };

  // Footer gradient at the point the newsletter band meets it, so the curve
  // reads as the footer rising up rather than a separate shape.
  const FOOTER_GRADIENT_ID = 'ef-flow-footer-gradient';
  const FOOTER_FILL = `url(#${FOOTER_GRADIENT_ID})`;
  const FOOTER_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="${FOOTER_GRADIENT_ID}" x1="0" x2="1"><stop offset="0" stop-color="#06382c"/><stop offset="1" stop-color="#053127"/></linearGradient></defs></svg>`;

  const GREEN = '#13b6a2';
  const GREEN_DARK = '#0b8073';
  const ROSE = '#e07aa8';
  const ROSE_DARK = '#b04880';
  const GOLD = '#f5b942';
  const BLUE = '#6d97f0';

  const wave = (position, fill) =>
    `<svg class="ef-flow-wave ef-flow-wave--${position}" viewBox="0 0 1440 64" preserveAspectRatio="none" aria-hidden="true"><path fill="${fill}" d="${WAVE_PATHS[position]}"/></svg>`;

  const SHAPES = {
    sparkle: c =>
      `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z"/></svg>`,
    plus: c =>
      `<svg viewBox="0 0 24 24"><path stroke="${c}" stroke-width="3.4" stroke-linecap="round" d="M12 3v18M3 12h18"/></svg>`,
    dot: c => `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${c}"/></svg>`,
    ring: c =>
      `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="${c}" stroke-width="3.2"/></svg>`,
    squiggle: c =>
      `<svg viewBox="0 0 48 16"><path fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" d="M3 9c4-9 8-9 12 0s8 9 12 0 8-9 12 0"/></svg>`,
    heart: c =>
      `<svg viewBox="0 0 24 24"><path fill="${c}" d="M12 21s-8-5.2-8-11a4.6 4.6 0 0 1 8-3 4.6 4.6 0 0 1 8 3c0 5.8-8 11-8 11Z"/></svg>`,
    triangle: c =>
      `<svg viewBox="0 0 24 24"><path fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" d="M12 4 21 20H3Z"/></svg>`,
  };

  // [shape, left %, top %, size px, colour, rotation deg, animation delay s]
  const bit = ([shape, x, y, size, colour, rotation = 0, delay = 0]) => {
    const height = shape === 'squiggle' ? size / 3 : size;
    return `<i class="ef-flow-bit" style="left:${x}%;top:${y}%;width:${size}px;height:${height}px;--r:${rotation}deg;animation-delay:${delay}s">${SHAPES[shape](colour)}</i>`;
  };

  const blob = ([x, y, size, colour]) =>
    `<i class="ef-flow-blob" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;background:radial-gradient(circle,${colour} 0,transparent 68%)"></i>`;

  const dots = (x, y, width, height, modifier = '') =>
    `<i class="ef-flow-dots ${modifier}" style="left:${x}%;top:${y}%;width:${width}px;height:${height}px;margin:${-height / 2}px 0 0 ${-width / 2}px"></i>`;

  const ring = (x, y, size, modifier = '') =>
    `<i class="ef-flow-ring ${modifier}" style="left:${x}%;top:${y}%;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px"></i>`;

  // Thin flowing curves, the same motif the footer already carries.
  const lines = (top, colour = 'rgba(11,128,115,.16)') =>
    `<svg class="ef-flow-lines" style="top:${top}%" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">${[
      0, 22, 44,
    ]
      .map(
        (offset, index) =>
          `<path fill="none" stroke="${colour}" stroke-width="${1.4 - index * 0.25}" d="M-20 ${120 + offset}C240 ${40 + offset} 420 ${200 + offset} 720 ${110 + offset}S1200 ${20 + offset} 1460 ${100 + offset}"/>`
      )
      .join('')}</svg>`;

  const bits = list => list.map(bit).join('');

  const addDecor = (section, html) => {
    if (!section || section.querySelector(':scope > .ef-flow-decor')) {
      return;
    }
    const decor = document.createElement('div');
    decor.className = 'ef-flow-decor';
    decor.setAttribute('aria-hidden', 'true');
    decor.innerHTML = html;
    section.prepend(decor);
  };

  // Wrap the last words of each section heading in the hero's marker. Text,
  // order and heading level are unchanged.
  const markHeadings = () => {
    document
      .querySelectorAll(
        'main .ef-approved-heading h2, main .ef-home-locations__hero-text h2, main .hws h2'
      )
      .forEach(heading => {
        if (heading.querySelector('.ef-flow-mark')) {
          return;
        }
        const words = heading.textContent.trim().split(/\s+/);
        const tail = words.length > 4 ? 3 : 2;
        if (words.length <= tail) {
          return;
        }
        const mark = document.createElement('span');
        mark.className = 'ef-flow-mark';
        mark.textContent = words.slice(-tail).join(' ');
        heading.textContent = `${words.slice(0, -tail).join(' ')} `;
        heading.appendChild(mark);
      });
  };

  const init = () => {
    if (!document.body.classList.contains('ef-approved-lower-home')) {
      return;
    }
    const $ = selector => document.querySelector(selector);

    markHeadings();

    addDecor(
      $('.hero-modern'),
      ring(74, 55, 600) +
        blob([20, 15, 420, 'rgba(19,182,162,.16)']) +
        blob([88, 100, 420, 'rgba(245,185,66,.14)']) +
        bits([
          ['sparkle', 50, 12, 24, GREEN, 0, 0],
          ['plus', 56, 66, 18, BLUE, 20, 1],
          ['ring', 3, 78, 18, ROSE, 0, 2],
          ['sparkle', 95, 20, 20, GOLD, 10, 0.5],
          ['squiggle', 62, 8, 54, GREEN_DARK, -8, 1.5],
          ['dot', 47, 80, 11, GOLD, 0, 0],
          ['triangle', 92, 78, 20, GREEN, 15, 2],
        ]) +
        wave('bottom', '#fff')
    );

    addDecor(
      $('.ef-approved-category-section'),
      dots(88, 12, 460, 300) +
        dots(6, 92, 420, 220) +
        blob([92, 8, 380, 'rgba(19,182,162,.10)']) +
        bits([
          ['sparkle', 74, 6, 30, GREEN, 0, 0],
          ['squiggle', 82, 12, 64, GREEN_DARK, -6, 1],
          ['plus', 90, 5, 20, GOLD, 25, 2],
          ['dot', 70, 13, 12, ROSE, 0, 1],
          ['ring', 95, 14, 20, BLUE, 0, 3],
          ['sparkle', 3, 52, 18, GOLD, 0, 1],
          ['plus', 97, 62, 18, GREEN, 10, 2],
        ])
    );

    addDecor(
      $('.ef-home-locations'),
      lines(18) +
        lines(58, 'rgba(11,128,115,.10)') +
        blob([8, 40, 420, 'rgba(19,182,162,.16)']) +
        blob([96, 70, 360, 'rgba(255,255,255,.7)']) +
        bits([
          ['sparkle', 55, 22, 26, '#fff', 0, 0],
          ['sparkle', 93, 20, 18, GREEN, 10, 1],
          ['plus', 3, 20, 18, GREEN_DARK, 0, 2],
          ['dot', 66, 80, 12, '#fff', 0, 1],
          ['ring', 4, 74, 18, GREEN, 0, 0],
        ]) +
        wave('top', '#fff') +
        wave('bottom', '#fff')
    );

    addDecor(
      $('.hws'),
      ring(78, 48, 640, 'ef-flow-ring--rose') +
        dots(12, 20, 380, 260, 'ef-flow-dots--rose') +
        lines(40, 'rgba(176,72,128,.14)') +
        bits([
          ['heart', 54, 9, 26, ROSE, -10, 0],
          ['sparkle', 62, 80, 28, '#fff', 0, 1],
          ['sparkle', 94, 10, 24, ROSE_DARK, 0, 0.5],
          ['plus', 8, 58, 18, ROSE, 20, 2],
          ['dot', 48, 90, 12, ROSE, 0, 1],
          ['heart', 97, 96, 20, ROSE_DARK, 12, 2],
          ['ring', 5, 12, 20, GOLD, 0, 1],
          ['squiggle', 40, 94, 60, ROSE, 5, 0],
        ]) +
        wave('top', '#fff') +
        wave('bottom', '#fff')
    );

    addDecor(
      $('.ef-approved-guides-section'),
      dots(92, 18, 380, 240) +
        dots(4, 88, 360, 200) +
        bits([
          ['sparkle', 84, 9, 26, GREEN, 0, 0],
          ['plus', 90, 14, 18, GOLD, 20, 1],
          ['squiggle', 94, 7, 58, GREEN_DARK, -6, 2],
          ['ring', 3, 20, 18, ROSE, 0, 1],
        ])
    );

    addDecor(
      $('.ef-approved-marketplace-section'),
      blob([88, 70, 360, 'rgba(245,185,66,.12)']) +
        bits([
          ['sparkle', 92, 22, 22, GOLD, 0, 0],
          ['plus', 7, 76, 16, GREEN, 20, 1],
        ])
    );

    addDecor(
      $('.ef-approved-steps-section'),
      lines(8) +
        lines(66, 'rgba(11,128,115,.10)') +
        blob([92, 30, 340, 'rgba(255,255,255,.8)']) +
        bits([
          ['sparkle', 92, 14, 26, '#fff', 0, 0],
          ['sparkle', 3, 12, 18, GREEN, 0, 1],
          ['plus', 97, 92, 18, GREEN_DARK, 20, 2],
          ['dot', 3, 70, 12, GOLD, 0, 1],
        ]) +
        wave('top', '#fff') +
        wave('bottom', '#fff')
    );

    addDecor(
      $('.ef-approved-supplier-section'),
      blob([50, 58, 1100, 'rgba(19,182,162,.15)']) +
        dots(10, 78, 380, 200) +
        dots(92, 60, 360, 200) +
        bits([
          ['sparkle', 4, 30, 24, GREEN, 0, 0],
          ['plus', 96, 24, 18, GOLD, 15, 1],
          ['squiggle', 90, 90, 56, GREEN_DARK, -8, 2],
          ['ring', 6, 86, 20, BLUE, 0, 0],
        ])
    );

    addDecor(
      $('.ef-nl-wrap'),
      lines(10) +
        blob([12, 30, 400, 'rgba(19,182,162,.16)']) +
        blob([90, 80, 360, 'rgba(255,255,255,.75)']) +
        bits([
          ['sparkle', 85, 22, 24, GREEN, 0, 0],
          ['plus', 8, 70, 18, GREEN_DARK, 20, 1],
          ['dot', 92, 70, 12, GOLD, 0, 1],
        ]) +
        wave('top', '#fff') +
        wave('bottom', FOOTER_FILL) +
        FOOTER_DEFS
    );
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // The footer is built by a script that can run after this one; a second pass
  // once everything has loaded picks up anything that was not there yet. Every
  // step skips work it has already done.
  window.addEventListener('load', init, { once: true });
})();
