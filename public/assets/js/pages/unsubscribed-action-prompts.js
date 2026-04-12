(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('success')) {
    document.getElementById('success-content').style.display = 'block';
  } else {
    const errorMsgEl = document.getElementById('error-message');
    const errorType = params.get('error');
    if (errorType === 'notfound') {
      errorMsgEl.textContent =
        'We could not find your account. Please manage preferences in your account settings.';
    }
    document.getElementById('error-content').style.display = 'block';
  }
})();
