(async function () {
  // Wait for api-client to load (max 3 s / 60 attempts at 50 ms)
  const API_CLIENT_MAX_WAIT = 60;
  function waitForApiClient(attempt) {
    return new Promise((resolve, reject) => {
      if (window.apiClient) {
        resolve();
      } else if ((attempt || 0) >= API_CLIENT_MAX_WAIT) {
        reject(new Error('api-client did not load in time'));
      } else {
        setTimeout(() => waitForApiClient((attempt || 0) + 1).then(resolve, reject), 50);
      }
    });
  }

  try {
    await waitForApiClient();
    const response = await window.apiClient.get('csrf-token');
    if (response.ok) {
      const data = await response.json();
      window.csrfToken = data.csrfToken;
      window.__CSRF_TOKEN__ = data.csrfToken; // Backward compatibility
    } else {
      console.error('Failed to fetch CSRF token:', response.statusText);
    }
  } catch (error) {
    console.error('Error fetching CSRF token:', error);
  }
})();
