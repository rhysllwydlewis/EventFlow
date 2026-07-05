(function () {
  const surfaceConfig = {
    homepage: {
      kicker: 'Homepage operations',
      title: 'Homepage command centre',
      subtitle:
        'A fast read on the active homepage version, collage readiness, content dependencies and media health.',
      stats: overview => [
        {
          value: overview.homepage.activeVersionLabel,
          label: 'Published homepage version',
        },
        {
          value: overview.homepage.collageEnabled ? 'On' : 'Off',
          label: `${overview.homepage.collageSource} dynamic collage source`,
        },
        {
          value: overview.homepage.uploadGalleryCount,
          label: 'Uploaded gallery assets',
        },
        {
          value: `${overview.homepage.categories.visible}/${overview.homepage.categories.total}`,
          label: 'Visible homepage categories',
        },
      ],
      links: [
        {
          label: 'Manage homepage copy',
          meta: 'Hero content',
          href: '/admin-content?tab=homepage',
        },
        { label: 'Open Media Center', meta: 'Pexels and assets', href: '/admin-media' },
        { label: 'Review supplier photos', meta: 'Approval queue', href: '/admin-photos' },
      ],
    },
    content: {
      kicker: 'Content operations',
      title: 'Content command centre',
      subtitle:
        'Track hero copy, announcements, FAQs and featured package coverage from one place before editing.',
      stats: overview => [
        {
          value: overview.content.heroComplete ? 'Ready' : 'Needs copy',
          label: overview.content.heroHasImage ? 'Hero includes image' : 'Hero image not set',
        },
        {
          value: overview.content.announcements.active,
          label: `${overview.content.announcements.total} total announcements`,
        },
        {
          value: overview.content.faqs.total,
          label: `${overview.content.faqs.categories} FAQ categories`,
        },
        {
          value: overview.content.featuredPackages.approved,
          label: `${overview.content.featuredPackages.total} featured packages`,
        },
      ],
      links: [
        { label: 'Tune homepage versions', meta: 'Homepage manager', href: '/admin-homepage' },
        { label: 'Find fresh media', meta: 'Photos and videos', href: '/admin-media' },
        { label: 'Open package admin', meta: 'Feature controls', href: '/admin-packages' },
      ],
    },
    media: {
      kicker: 'Media operations',
      title: 'Media command centre',
      subtitle:
        'Check supplier photo moderation, uploaded homepage collage files and Pexels service health.',
      stats: overview => [
        {
          value: overview.media.supplierPhotos.pending,
          label: overview.media.supplierPhotos.autoApprove
            ? 'Supplier photos needing manual review'
            : `${overview.media.supplierPhotos.storedPending} supplier photos stored as pending`,
        },
        {
          value: overview.media.homepageCollage.total,
          label: `${overview.media.homepageCollage.videos} uploaded videos`,
        },
        {
          value: overview.media.pexels.configured ? 'Ready' : 'Missing',
          label: 'Pexels API configuration',
        },
        {
          value: `${overview.media.pexels.cacheHitRate}%`,
          label: `${overview.media.pexels.totalRequests} Pexels requests tracked`,
        },
      ],
      links: [
        {
          label: 'Configure homepage collage',
          meta: 'Source and playback',
          href: '/admin-homepage',
        },
        { label: 'Edit site content', meta: 'Hero and FAQs', href: '/admin-content' },
        { label: 'Review photo queue', meta: 'Moderation', href: '/admin-photos' },
      ],
    },
  };

  function escapeHtml(value) {
    if (window.AdminShared?.escapeHtml) {
      return window.AdminShared.escapeHtml(String(value ?? ''));
    }
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  async function getOverview() {
    if (window.AdminShared?.api) {
      return window.AdminShared.api('/api/admin/management/overview');
    }

    const response = await fetch('/api/admin/management/overview', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Overview request failed (${response.status})`);
    }
    return response.json();
  }

  function recommendationPriority(recommendation) {
    const order = { critical: 0, warning: 1, action: 2, info: 3 };
    return order[recommendation.severity] ?? 4;
  }

  function renderTasks(overview, surface) {
    const scoped = overview.recommendations
      .filter(item => item.surface === surface || item.surface === 'all')
      .sort((a, b) => recommendationPriority(a) - recommendationPriority(b));
    const tasks = scoped;

    if (tasks.length === 0) {
      return '<div class="admin-ops-empty">Everything looks tidy for this area right now.</div>';
    }

    return tasks
      .map(
        task => `
          <a class="admin-ops-task" href="${escapeHtml(task.href || '#')}">
            <span class="admin-ops-task-dot is-${escapeHtml(task.severity)}"></span>
            <span>
              <span class="admin-ops-task-title">${escapeHtml(task.title)}</span>
              <span class="admin-ops-task-detail">${escapeHtml(task.detail)}</span>
            </span>
            <span class="admin-ops-task-arrow">Open</span>
          </a>
        `
      )
      .join('');
  }

  function renderStats(stats) {
    return stats
      .map(
        stat => `
          <div class="admin-ops-stat">
            <strong>${escapeHtml(stat.value)}</strong>
            <span>${escapeHtml(stat.label)}</span>
          </div>
        `
      )
      .join('');
  }

  function renderLinks(links) {
    return links
      .map(
        link => `
          <a class="admin-ops-link" href="${escapeHtml(link.href)}">
            ${escapeHtml(link.label)}
            <span>${escapeHtml(link.meta)}</span>
          </a>
        `
      )
      .join('');
  }

  function renderOverview(mount, surface, overview) {
    const config = surfaceConfig[surface] || surfaceConfig.content;
    const surfaceRecommendations = overview.recommendations.filter(
      item => item.surface === surface || item.surface === 'all'
    );
    const hasWarnings = surfaceRecommendations.some(item =>
      ['critical', 'warning', 'action'].includes(item.severity)
    );

    mount.innerHTML = `
      <div class="admin-ops-panel">
        <div class="admin-ops-header">
          <div>
            <p class="admin-ops-kicker">${escapeHtml(config.kicker)}</p>
            <h2 class="admin-ops-title">${escapeHtml(config.title)}</h2>
            <p class="admin-ops-subtitle">${escapeHtml(config.subtitle)}</p>
          </div>
          <div class="admin-ops-health ${hasWarnings ? 'is-warning' : ''}">
            ${hasWarnings ? 'Needs review' : 'Looks good'}
          </div>
        </div>
        <div class="admin-ops-grid">${renderStats(config.stats(overview))}</div>
        <div class="admin-ops-body">
          <div>
            <h3 class="admin-ops-section-title">Recommended next actions</h3>
            <div class="admin-ops-tasks">${renderTasks(overview, surface)}</div>
          </div>
          <div>
            <h3 class="admin-ops-section-title">Related workflows</h3>
            <div class="admin-ops-links">${renderLinks(config.links)}</div>
          </div>
        </div>
      </div>
    `;
  }

  async function init() {
    const mount = document.getElementById('adminManagementOverview');
    if (!mount) {
      return;
    }

    const surface = mount.dataset.managementSurface || 'content';
    mount.classList.add('admin-ops-shell');
    mount.innerHTML = '<div class="admin-ops-empty">Loading management overview...</div>';

    try {
      const response = await getOverview();
      renderOverview(mount, surface, response.overview || response);
    } catch (error) {
      console.warn('Failed to load admin management overview:', error);
      mount.innerHTML =
        '<div class="admin-ops-error">Management overview could not be loaded. The page tools below are still available.</div>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
