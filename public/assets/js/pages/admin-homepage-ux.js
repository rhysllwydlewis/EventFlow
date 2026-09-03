'use strict';
(() => {
  function findSectionByHeading(text) {
    return Array.from(document.querySelectorAll('main > div')).find(section => {
      const heading = section.querySelector('h2');
      return heading && heading.textContent.toLowerCase().includes(text);
    });
  }

  function createSectionNav(sections) {
    if (document.getElementById('homepageWorkspaceNav')) {
      return;
    }

    const nav = document.createElement('nav');
    nav.id = 'homepageWorkspaceNav';
    nav.className = 'homepage-workspace-nav';
    nav.setAttribute('aria-label', 'Homepage management sections');
    nav.innerHTML = `
      <a href="#adminManagementOverview">Overview</a><a href="#homepageManager">Homepage versions</a>
      ${sections
        .map(section => `<a href="#${section.id}">${section.dataset.navLabel}</a>`)
        .join('')}
    `;

    const overview = document.getElementById('adminManagementOverview');
    if (overview) {
      overview.insertAdjacentElement('afterend', nav);
    }
  }

  function labelWorkspaceSections() {
    const sections = [
      { key: 'collage & media', id: 'homepageCollageWorkspace', label: 'Collage & media' },
      {
        key: 'category cards',
        id: 'homepageCategoryCardsWorkspace',
        label: 'Category cards',
      },
      { key: 'hero images', id: 'homepageHeroImagesWorkspace', label: 'Hero images' },
    ];

    const labelled = [];
    sections.forEach(({ key, id, label }) => {
      const section = findSectionByHeading(key);
      if (!section) {
        return;
      }
      section.id = id;
      section.dataset.navLabel = label;
      section.classList.add('homepage-workspace-section');
      labelled.push(section);
    });

    createSectionNav(labelled);
  }

  function makeDetails(summary, nodes, options = {}) {
    const details = document.createElement('details');
    details.className = `homepage-control-accordion ${options.className || ''}`.trim();
    if (options.open) {
      details.open = true;
    }

    const summaryEl = document.createElement('summary');
    summaryEl.innerHTML = `<span>${summary}</span><small>${options.help || ''}</small>`;
    details.appendChild(summaryEl);

    const body = document.createElement('div');
    body.className = 'homepage-control-accordion__body';
    nodes.forEach(node => {
      node.classList.add('homepage-control-card');
      node.style.background = '';
      node.style.border = '';
      node.style.borderRadius = '';
      body.appendChild(node);
    });
    details.appendChild(body);
    return details;
  }

  function groupCollageControls() {
    const settings = document.getElementById('collageWidgetSettings');
    if (!settings || settings.dataset.uxGrouped === 'true') {
      return;
    }

    const children = Array.from(settings.children);
    const advancedTitles = [
      'hero video controls',
      'hero video playback',
      'video quality settings',
      'video quality',
      'transition effects',
      'preloading & caching',
      'preloading and caching',
      'mobile optimizations',
      'mobile optimisation',
      'content filtering',
      'playback controls',
      'video analytics dashboard',
      'video diagnostics',
    ];
    const pexelsIds = new Set(['pexelsSettingsPanel', 'pexelsVideoQueriesPanel']);
    const uploadIds = new Set(['uploadsGalleryPanel']);
    const fallback = document.getElementById('fallbackToPexels')?.closest('div');
    const saveRow = document.getElementById('saveCollageWidget')?.closest('div');
    const statusMessages = [
      document.getElementById('collageWidgetSuccess'),
      document.getElementById('collageWidgetError'),
    ].filter(Boolean);

    const quickNodes = [];
    const advancedNodes = [];
    const pexelsNodes = [];
    const uploadNodes = [];

    children.forEach(child => {
      const title = child.querySelector('h3')?.textContent.trim().toLowerCase() || '';
      if (advancedTitles.some(item => title.includes(item))) {
        advancedNodes.push(child);
      } else if (pexelsIds.has(child.id)) {
        pexelsNodes.push(child);
      } else if (uploadIds.has(child.id)) {
        uploadNodes.push(child);
      } else if (child === fallback || child === saveRow || statusMessages.includes(child)) {
        return;
      } else {
        quickNodes.push(child);
      }
    });

    settings.innerHTML = '';
    const scopeNote = document.createElement('div');
    scopeNote.className = 'homepage-save-scope-note';
    scopeNote.innerHTML =
      '<strong>Editing scope:</strong> changes are saved to the selected homepage version. If this version is live, saved changes affect the live homepage. Draft versions remain private until you choose “Set live”.';
    settings.appendChild(scopeNote);
    settings.appendChild(
      makeDetails('Essential settings', quickNodes, {
        open: true,
        help: 'Collage state, source, media types and timing.',
      })
    );
    settings.appendChild(
      makeDetails('Advanced playback and performance settings', advancedNodes, {
        help: 'Video behaviour, transitions, mobile optimisation and diagnostics.',
      })
    );
    settings.appendChild(
      makeDetails('Pexels search queries', pexelsNodes, {
        className: 'homepage-pexels-accordion',
        help: 'Photo and video search terms used when Pexels is selected or fallback is on.',
      })
    );
    settings.appendChild(
      makeDetails('Uploaded media gallery', uploadNodes, {
        className: 'homepage-uploads-accordion',
        help: 'Upload and review photos/videos for upload-source collages.',
      })
    );

    if (fallback) {
      fallback.classList.add('homepage-fallback-card');
      settings.appendChild(fallback);
    }
    if (saveRow) {
      saveRow.classList.add('homepage-sticky-actions');
      settings.appendChild(saveRow);
    }
    statusMessages.forEach(message => settings.appendChild(message));

    settings.dataset.uxGrouped = 'true';
  }

  function openRelevantMediaPanel() {
    const source = document.querySelector('input[name="collageSource"]:checked')?.value || 'pexels';
    const videosEnabled = document.getElementById('mediaTypeVideos')?.checked !== false;
    const pexelsAccordion = document.querySelector('.homepage-pexels-accordion');
    const uploadsAccordion = document.querySelector('.homepage-uploads-accordion');
    if (pexelsAccordion) {
      pexelsAccordion.open = source === 'pexels' || videosEnabled;
    }
    if (uploadsAccordion) {
      uploadsAccordion.open = source === 'uploads';
    }
  }

  function improveSaveLabels() {
    const saveButton = document.getElementById('saveCollageWidget');
    if (saveButton) {
      saveButton.textContent = 'Save changes';
    }
    const resetButton = document.getElementById('resetCollageWidget');
    if (resetButton) {
      resetButton.textContent = 'Reset form from saved values';
    }
  }

  function removeUnclearFloatingControls() {
    document
      .querySelectorAll('.floating-action, .admin-fab, [data-floating-action]')
      .forEach(control => {
        const label =
          control.getAttribute('aria-label') ||
          control.getAttribute('title') ||
          control.textContent.trim();
        if (!label || label.length < 2) {
          control.remove();
        }
      });
  }

  function loadQualityFixes() {
    const href = '/assets/css/admin-homepage-quality-fixes.css?v=18.3.1';
    if (document.querySelector(`link[href="${href}"]`)) {
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  function init() {
    loadQualityFixes();
    document.body.classList.add('admin-homepage-ux-overhaul');
    removeUnclearFloatingControls();
    labelWorkspaceSections();
    groupCollageControls();
    improveSaveLabels();
    openRelevantMediaPanel();
    document.querySelectorAll('input[name="collageSource"], #mediaTypeVideos').forEach(input => {
      input.addEventListener('change', openRelevantMediaPanel);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
