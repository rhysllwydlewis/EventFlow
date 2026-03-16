window.EF_CANONICAL_BASE = 'https://event-flow.co.uk';

// Read page identifier from <meta name="ef-page" content="..."> if present
(function () {
  const meta = document.querySelector('meta[name="ef-page"]');
  if (meta && meta.content) {
    window.__EF_PAGE__ = meta.content;
  }
})();
