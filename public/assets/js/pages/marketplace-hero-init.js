(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }
  const hero = document.querySelector('.mkt-hero');
  const cards = document.querySelectorAll('.mkt-hero__card');
  if (!hero || !cards.length) {
    return;
  }

  /* Named constants — rotation matches CSS keyframes, parallax factors control depth */
  const CARD_ROTATIONS = [-4, 1.5, -2.5];
  const PARALLAX_X = [10, 16, 6];
  const PARALLAX_Y = [8, 12, 5];

  let ticking = false;
  hero.addEventListener('mousemove', e => {
    if (ticking) {
      return;
    }
    ticking = true;
    requestAnimationFrame(() => {
      const rect = hero.getBoundingClientRect();
      const cx = (e.clientX - rect.left) / rect.width - 0.5;
      const cy = (e.clientY - rect.top) / rect.height - 0.5;
      for (let i = 0; i < cards.length; i++) {
        cards[i].style.transform =
          `rotate(${CARD_ROTATIONS[i]}deg) ` +
          `translate(${-cx * PARALLAX_X[i]}px,${-cy * PARALLAX_Y[i]}px)`;
      }
      ticking = false;
    });
  });
  hero.addEventListener('mouseleave', () => {
    for (let i = 0; i < cards.length; i++) {
      cards[i].style.transform = '';
    }
  });
})();
