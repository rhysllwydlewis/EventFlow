// Breadcrumb Navigation Update
document.addEventListener('DOMContentLoaded', () => {
  const breadcrumbSection = document.getElementById('breadcrumb-section');
  const breadcrumbSectionName = document.getElementById('breadcrumb-section-name');

  // Section name mapping
  const sectionNames = {
    'welcome-section': 'Overview',
    'supplier-stats-grid': 'Statistics',
    'my-suppliers': 'Profiles',
    'my-packages': 'Packages',
    'threads-sup': 'Messages',
    'tickets-sup': 'Support Tickets',
  };

  const updateBreadcrumb = sectionId => {
    if (sectionId && sectionNames[sectionId]) {
      breadcrumbSection.style.display = 'flex';
      breadcrumbSection.style.alignItems = 'center';
      breadcrumbSection.style.gap = '0.5rem';
      breadcrumbSectionName.textContent = sectionNames[sectionId];
    } else {
      breadcrumbSection.style.display = 'none';
    }
  };

  const activePill = document.querySelector('.mobile-nav-pill.active');
  if (activePill) {
    updateBreadcrumb(activePill.dataset.section);
  }

  // Keep breadcrumb synced to nav click + scroll-spy updates from enhancements script
  window.addEventListener('supplier-nav-section-change', e => {
    updateBreadcrumb(e.detail?.sectionId);
  });
});

// Quick Actions: Handle view conversations button
document.addEventListener('DOMContentLoaded', () => {
  const viewConvBtn = document.getElementById('viewConversationsBtn');
  if (viewConvBtn) {
    viewConvBtn.addEventListener('click', () => {
      const threadsSection = document.getElementById('threads-sup');
      if (threadsSection) {
        threadsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }
});
