(function () {
  const btn = document.getElementById('sp-map-toggle-btn');
  const section = document.getElementById('sp-map-section');
  if (btn && section) {
    btn.addEventListener('click', () => {
      const isOpen = section.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      section.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      // `inert` tracks aria-hidden: while the map is collapsed its iframe stays
      // in the tab order otherwise, so a keyboard user could land inside a map
      // that screen readers are told is not there.
      section.inert = !isOpen;
      const iframe = section.querySelector('iframe[data-src]');
      if (iframe && isOpen) {
        iframe.src = iframe.getAttribute('data-src');
        iframe.removeAttribute('data-src');
      }
    });
  }
})();
