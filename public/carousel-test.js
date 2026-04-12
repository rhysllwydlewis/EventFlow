// Carousel test page initializer
(function () {
  const photos = [
    '/assets/images/hero-venue.jpg',
    '/assets/images/hero-planning.jpg',
    '/assets/images/collage-photography.jpg',
    '/assets/images/collage-catering.jpg',
    '/assets/images/collage-entertainment.jpg',
    '/assets/images/collage-venue.jpg',
  ];
  document.querySelectorAll('#test-gallery img').forEach((img, idx) => {
    img.addEventListener('click', () => {
      window.ImageCarousel.openWithImages(photos, idx, 'Test Supplier');
    });
  });
})();
