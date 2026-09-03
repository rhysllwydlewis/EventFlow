'use strict';
(function () {
  const params = new URLSearchParams(window.location.search);
  const isPreview = params.get('preview') === '1';
  const planId = params.get('plan') || '';

  if (!isPreview || !planId || window.__wwPublicPreviewClientLoaded) {
    return;
  }
  window.__wwPublicPreviewClientLoaded = true;

  const originalFetch = window.fetch.bind(window);
  const slug = window.location.pathname.split('/').filter(Boolean).pop() || '';

  function normalizeWebsite(site) {
    if (!site) {
      return null;
    }
    return {
      ...site,
      slug: site.slug || slug,
      rsvpEnabled: false,
      previewMode: true,
      previewNotice:
        site.status === 'published'
          ? 'Previewing the latest saved version of your live wedding website.'
          : 'Draft preview. Guests cannot see this page until you publish it.',
    };
  }

  window.fetch = function previewAwareFetch(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const isPublicWeddingRequest =
        url.includes('/api/public/wedding-websites/') &&
        decodeURIComponent(url).includes(decodeURIComponent(slug));

      if (isPublicWeddingRequest) {
        return originalFetch(`/api/me/plans/${encodeURIComponent(planId)}/wedding-website`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
        })
          .then(async response => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              return new Response(
                JSON.stringify({
                  error: data.error || 'Unable to load this authenticated preview.',
                }),
                {
                  status: response.status || 500,
                  headers: { 'Content-Type': 'application/json' },
                }
              );
            }
            return new Response(
              JSON.stringify({
                success: true,
                preview: true,
                website: normalizeWebsite(data.website || data.site || data.data?.website || null),
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          })
          .catch(
            () =>
              new Response(
                JSON.stringify({
                  error: 'Unable to load this authenticated preview. Please sign in and try again.',
                }),
                { status: 500, headers: { 'Content-Type': 'application/json' } }
              )
          );
      }
    } catch (_err) {
      // Fall back to the normal request path.
    }
    return originalFetch(input, init);
  };

  function addPreviewBanner() {
    const root = document.getElementById('public-wedding-root');
    if (!root || document.querySelector('.wed-preview-banner')) {
      return;
    }
    const banner = document.createElement('aside');
    banner.className = 'wed-preview-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = `
      <strong>Preview mode</strong>
      <span>This is only visible to you while signed in. RSVPs are disabled in preview.</span>
      <a href="/dashboard/customer">Back to dashboard</a>
    `;
    root.prepend(banner);
  }

  function injectStyles() {
    if (document.getElementById('wed-preview-client-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'wed-preview-client-styles';
    style.textContent = `
      .wed-preview-banner {
        position: sticky;
        top: 0;
        z-index: 50;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: center;
        gap: 0.65rem 0.9rem;
        padding: 0.72rem 1rem;
        border-bottom: 1px solid rgba(80, 192, 176, 0.22);
        background: rgba(255, 255, 255, 0.86);
        color: #24436f;
        box-shadow: 0 12px 30px rgba(36, 67, 111, 0.1);
        backdrop-filter: blur(16px);
        text-align: center;
      }
      .wed-preview-banner strong {
        color: #0b8277;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .wed-preview-banner a {
        color: #0b8277;
        font-weight: 800;
      }
    `;
    document.head.appendChild(style);
  }

  injectStyles();
  const observer = new MutationObserver(addPreviewBanner);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addPreviewBanner);
  } else {
    addPreviewBanner();
  }
})();
