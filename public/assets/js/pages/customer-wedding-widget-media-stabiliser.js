'use strict';
(function () {
  if (window.__weddingWidgetMediaStabiliserLoaded) {
    return;
  }
  window.__weddingWidgetMediaStabiliserLoaded = true;

  const ROOT_SELECTOR = '#wedding-website-dashboard-root';
  const STYLE_ID = 'ww-media-stabiliser-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .ww-theme-media-panel[data-media-stabilised='true'] {
        border-color: rgba(80, 192, 176, 0.2) !important;
        background:
          radial-gradient(circle at 0% 0%, rgba(80, 192, 176, 0.12), transparent 32%),
          linear-gradient(135deg, rgba(255, 255, 255, 0.88), rgba(246, 253, 252, 0.74)) !important;
      }

      .ww-theme-media-panel[data-media-stabilised='true'] > summary {
        align-items: center;
        color: var(--ww-navy, #24436f);
        font-weight: 900;
        letter-spacing: -0.015em;
      }

      .ww-theme-media-panel[data-media-stabilised='true'] > summary::before {
        content: '🎨';
        display: inline-grid;
        width: 2rem;
        height: 2rem;
        margin-right: 0.48rem;
        place-items: center;
        border: 1px solid rgba(80, 192, 176, 0.22);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.82);
        box-shadow: 0 8px 18px rgba(36, 67, 111, 0.06);
      }

      .ww-media-stabiliser-note {
        margin: 0.25rem 0 0.85rem;
        padding: 0.62rem 0.72rem;
        border: 1px solid rgba(80, 192, 176, 0.18);
        border-radius: 14px;
        background: rgba(240, 253, 250, 0.76);
        color: var(--ww-navy, #24436f) !important;
        font-weight: 750 !important;
      }

      .ww-theme-media-panel[data-media-stabilised='true'] .ww-cover-preview,
      .ww-theme-media-panel[data-media-stabilised='true'] .ww-theme-preview {
        box-shadow: 0 16px 34px rgba(36, 67, 111, 0.08);
      }
    `;
    document.head.appendChild(style);
  }

  function relabelThemeMediaPanel(root) {
    const panel = root.querySelector('.ww-theme-media-panel');
    if (!panel || panel.dataset.mediaStabilised === 'true') {
      return;
    }
    panel.dataset.mediaStabilised = 'true';

    const summary = panel.querySelector('summary');
    if (summary) {
      summary.textContent = 'Theme & photos';
    }

    panel.querySelectorAll('h4').forEach(heading => {
      if (/hero photo/i.test(heading.textContent || '')) {
        heading.textContent = 'Cover photo';
      }
      if (/gallery photos/i.test(heading.textContent || '')) {
        heading.textContent = 'Gallery photos';
      }
    });

    const coverEmpty = panel.querySelector('.ww-cover-empty');
    if (coverEmpty) {
      coverEmpty.textContent = 'Upload a cover photo';
    }

    panel.querySelectorAll('label').forEach(label => {
      const firstText = Array.from(label.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
      if (firstText && /choose hero photo/i.test(firstText.textContent || '')) {
        firstText.textContent = 'Choose cover photo';
      }
    });

    const tools = panel.querySelector('.ww-theme-tools');
    if (tools && !tools.querySelector('.ww-media-stabiliser-note')) {
      const note = document.createElement('p');
      note.className = 'small ww-media-stabiliser-note';
      note.textContent =
        'Cover photo, colours and gallery images now save through one Theme & photos panel.';
      tools.insertBefore(note, tools.firstElementChild?.nextSibling || tools.firstChild);
    }
  }

  function hideDuplicateCoverUpload(root) {
    const themePanel = root.querySelector('.ww-theme-media-panel');
    const builderCover = root.querySelector('.ww-cover-upload-field');
    if (!themePanel || !builderCover || builderCover.dataset.mediaStabilised === 'true') {
      return;
    }

    builderCover.dataset.mediaStabilised = 'true';
    builderCover.hidden = true;
    builderCover.setAttribute('aria-hidden', 'true');

    const input = builderCover.querySelector('[name="coverImageUrl"]');
    if (input) {
      input.disabled = true;
    }
  }

  function stabilise(root) {
    if (!root) {
      return;
    }
    injectStyles();
    relabelThemeMediaPanel(root);
    hideDuplicateCoverUpload(root);
  }

  function run() {
    stabilise(document.querySelector(ROOT_SELECTOR));
  }

  const observer = new MutationObserver(run);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('load', run);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
