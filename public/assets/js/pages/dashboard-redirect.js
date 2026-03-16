(async function () {
  try {
    // Fetch user info to determine role
    const res = await fetch('/api/user', {
      credentials: 'include',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (res.status === 401) {
      // Not authenticated - redirect to login with return URL
      window.location.href = '/auth?redirect=/dashboard';
      return;
    }

    if (!res.ok) {
      console.error('Failed to fetch user:', res.status);
      window.location.href = '/auth?redirect=/dashboard';
      return;
    }

    const data = await res.json();

    // Handle both wrapped ({user: ...}) and unwrapped response formats
    const user = data.user || data;

    if (!user || !user.role) {
      window.location.href = '/auth?redirect=/dashboard';
      return;
    }

    // Redirect based on role
    if (user.role === 'admin') {
      window.location.href = '/admin';
    } else if (user.role === 'supplier') {
      window.location.href = '/dashboard/supplier';
    } else {
      // Default to customer dashboard
      window.location.href = '/dashboard/customer';
    }
  } catch (error) {
    console.error('Error redirecting to dashboard:', error);
    // Fallback to auth page
    window.location.href = '/auth?redirect=/dashboard';
  }
})();
