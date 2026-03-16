// Initialize core utilities
document.addEventListener('DOMContentLoaded', () => {
  // Initialize error boundary
  window.errorBoundary = new ErrorBoundary({
    showErrorDetails: window.location.hostname === 'localhost',
  });

  // Update SEO for homepage
  if (window.seoHelper) {
    window.seoHelper.setAll({
      title: 'EventFlow — Plan your event the simple way',
      description:
        'Find suppliers, build your plan and keep everything in one place — beautifully simple on mobile and desktop.',
      keywords: [
        'event planning',
        'suppliers',
        'venues',
        'catering',
        'corporate events',
        'birthday parties',
      ],
      canonical: '/',
      type: 'website',
    });
  }
});
