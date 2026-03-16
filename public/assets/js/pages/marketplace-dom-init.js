// Initialize core utilities
document.addEventListener('DOMContentLoaded', () => {
  // Initialize error boundary
  window.errorBoundary = new ErrorBoundary({
    showErrorDetails: window.location.hostname === 'localhost',
  });

  // Update SEO for marketplace page
  if (window.seoHelper) {
    window.seoHelper.setAll({
      title: 'Event Marketplace — Buy & Sell Pre-Loved Event Items',
      description:
        'Buy and sell pre-loved event items. UK-focused marketplace with no platform fees. Physical items only — arrange payments directly.',
      keywords: [
        'event marketplace',
        'wedding dress resale',
        'event décor',
        'AV equipment',
        'UK marketplace',
      ],
      canonical: '/marketplace',
      type: 'website',
    });
  }
});
