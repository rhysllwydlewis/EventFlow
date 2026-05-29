(function () {
  'use strict';

  if (window.__weddingWidgetMediaStabiliserLoaded) return;
  window.__weddingWidgetMediaStabiliserLoaded = true;

  const ROOT_SELECTOR = '#wedding-website-dashboard-root';

  function relabelThemeMediaPanel(root) {
    const panel = root.querySelector('.ww-theme-media-panel');
    if (!panel || panel.dataset.mediaStabilised === 'true') return;
    panel.dataset.mediaStabilised = 'true';

    const summary = panel.querySelector('summary');
    if (summary) summary.textContent = 'Theme & photos';

    panel.querySelectorAll('h4').forEach(heading => {
      if (/hero photo/i.test(heading.textContent || '')) {
        heading.textContent = 'Cover photo';
      }
      if (/gallery photos/i.test(heading.textContent || '')) {
        heading.textContent = 'Gallery photos';
      }
    });

    const coverEmpty = panel.querySelector('.ww-cover-empty');
    if (coverEmpty) coverEmpty.textContent = 'Upload a cover photo';

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
      note.textContent = 'Cover photo, colours and gallery images now save through one Theme & photos panel.';
      tools.insertBefore(note, tools.firstElementChild?.nextSibling || tools.firstChild);
    }
  }

  function hideDuplicateCoverUpload(root) {
    const themePanel = root.querySelector('.ww-theme-media-panel');
    const builderCover = root.querySelector('.ww-cover-upload-field');
    if (!themePanel || !builderCover || builderCover.dataset.mediaStabilised === 'true') return;

    builderCover.dataset.mediaStabilised = 'true';
    builderCover.hidden = true;
    builderCover.setAttribute('aria-hidden', 'true');

    const input = builderCover.querySelector('[name="coverImageUrl"]');
    if (input) input.disabled = true;
  }

  function stabilise(root) {
    if (!root) return;
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
