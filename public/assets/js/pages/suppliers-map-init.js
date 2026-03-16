(function () {
  const btn = document.getElementById('sp-map-toggle-btn');
  const section = document.getElementById('sp-map-section');
  if (btn && section) {
    btn.addEventListener('click', () => {
      const isOpen = section.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      section.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
      const iframe = section.querySelector('iframe[data-src]');
      if (iframe && isOpen) {
        iframe.src = iframe.getAttribute('data-src');
        iframe.removeAttribute('data-src');
      }
    });
  }
})();
