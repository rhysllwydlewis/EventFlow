(function () {
  const tabSign = document.getElementById('tab-signin');
  const tabCreate = document.getElementById('tab-create');
  const panelSign = document.getElementById('panel-signin');
  const panelCreate = document.getElementById('panel-create');

  function activateTab(activeTab, activePanel, inactiveTab, inactivePanel, moveFocus) {
    activeTab.setAttribute('aria-selected', 'true');
    activeTab.setAttribute('tabindex', '0');
    inactiveTab.setAttribute('aria-selected', 'false');
    inactiveTab.setAttribute('tabindex', '-1');
    activePanel.hidden = false;
    inactivePanel.hidden = true;
    if (moveFocus) {
      activeTab.focus();
    }

    // Update the page heading to match the active tab
    const heading = document.querySelector('.auth-heading');
    if (heading) {
      heading.textContent = activeTab.id === 'tab-create' ? 'Create your account' : 'Welcome back';
    }
  }

  if (tabSign && tabCreate && panelSign && panelCreate) {
    tabSign.addEventListener('click', () => {
      activateTab(tabSign, panelSign, tabCreate, panelCreate, false);
    });

    tabCreate.addEventListener('click', () => {
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    });

    // Keyboard navigation: ArrowLeft/ArrowRight to move between tabs
    [tabSign, tabCreate].forEach(tab => {
      tab.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          if (tab === tabSign) {
            activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
          } else {
            activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
          }
        } else if (e.key === 'Home') {
          e.preventDefault();
          activateTab(tabSign, panelSign, tabCreate, panelCreate, true);
        } else if (e.key === 'End') {
          e.preventDefault();
          activateTab(tabCreate, panelCreate, tabSign, panelSign, true);
        }
      });
    });

    // Activate the correct tab based on URL hash (no focus steal on page load)
    if (window.location.hash === '#create' || window.location.search.includes('tab=create')) {
      activateTab(tabCreate, panelCreate, tabSign, panelSign, false);
    }
  }
})();
