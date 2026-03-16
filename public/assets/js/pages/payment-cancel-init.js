// Log cancellation for analytics (optional)
try {
  const urlParams = new URLSearchParams(window.location.search);
  const sessionId = urlParams.get('session_id');

  if (sessionId) {
    console.log('Payment cancelled for session:', sessionId);
    // You could send this to an analytics service here
  }
} catch (error) {
  console.error('Error logging cancellation:', error);
}
