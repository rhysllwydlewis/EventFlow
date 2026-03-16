// Escape HTML helper
function escapeHtml(unsafe) {
  if (typeof unsafe !== 'string') {
    return '';
  }
  const div = document.createElement('div');
  div.textContent = unsafe;
  return div.innerHTML;
}

// Check auth and personalize dashboard
(async function () {
  try {
    const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!response.ok) {
      // Redirect to homepage if not authenticated
      window.location.href = '/';
      return;
    }
    const data = await response.json();
    const user = data.user;

    if (user) {
      // Personalize welcome message - using textContent is safe but also escape for consistency
      const welcomeHeading = document.getElementById('welcome-heading');
      if (welcomeHeading) {
        if (user.firstName) {
          welcomeHeading.textContent = `Welcome ${escapeHtml(user.firstName)}!`;
        } else if (user.name) {
          const firstName = user.name.split(' ')[0];
          welcomeHeading.textContent = `Welcome ${escapeHtml(firstName)}!`;
        } else {
          welcomeHeading.textContent = `Welcome to your Supplier Dashboard!`;
        }
      }
    }
  } catch (error) {
    console.error('Failed to load user data:', error);
  }
})();
