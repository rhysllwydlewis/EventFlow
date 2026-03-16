// Global image error handler for supplier avatars and other images
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener(
    'error',
    e => {
      if (e.target.tagName === 'IMG') {
        const img = e.target;
        // Only handle once per image
        if (img.dataset.errorHandled) {
          return;
        }
        img.dataset.errorHandled = 'true';

        // Prevent error propagation (note: browser console errors may still appear)
        e.stopPropagation();

        // Log 404 errors for upload paths to help debug upload issues
        if (img.src && img.src.includes('/uploads/')) {
          console.warn('Image upload 404 - File not found:', img.src);
        }

        // Check if it's a supplier avatar, profile image, or package image
        if (
          img.src &&
          (img.src.includes('/uploads/suppliers/') ||
            img.src.includes('/uploads/packages/') ||
            img.classList.contains('supplier-avatar') ||
            img.classList.contains('profile-image') ||
            img.classList.contains('package-image') ||
            img.closest('.package-card') ||
            img.closest('.supplier-card'))
        ) {
          // Determine the appropriate placeholder based on context
          let placeholderSvg;

          if (
            img.src.includes('/uploads/packages/') ||
            img.classList.contains('package-image') ||
            img.closest('.package-card')
          ) {
            // Package placeholder with box icon
            placeholderSvg =
              'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23f3f4f6"/%3E%3Cpath d="M50 25L25 37.5v25L50 75l25-12.5v-25L50 25zm0 5l18.75 9.375L50 48.75l-18.75-9.375L50 30zm-20 12.5L45 50v17.5L30 60V42.5zm40 0v17.5L55 67.5V50l15-7.5z" fill="%239ca3af"/%3E%3C/svg%3E';
            img.alt = 'Package image placeholder';
            img.title = 'Package image not available';
          } else {
            // Profile placeholder with person icon
            placeholderSvg =
              'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"%3E%3Crect width="100" height="100" fill="%23e5e7eb"/%3E%3Cpath d="M50 45c8.284 0 15-6.716 15-15s-6.716-15-15-15-15 6.716-15 15 6.716 15 15 15zm0 5c-10 0-30 5-30 15v10h60V65c0-10-20-15-30-15z" fill="%239ca3af"/%3E%3C/svg%3E';
            img.alt = 'Profile placeholder';
            img.title = 'Image not available';
          }

          img.src = placeholderSvg;

          // Maintain aspect ratio and theme styling
          img.style.objectFit = 'cover';
          img.style.backgroundColor = '#f3f4f6';
        }
      }
    },
    true
  );
});

// Screen reader announcement helper
window.announceToSR = function (message) {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    announcer.textContent = message;
    setTimeout(() => {
      announcer.textContent = '';
    }, 1000);
  }
};
