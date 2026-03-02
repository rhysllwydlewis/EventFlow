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

  // Password show/hide toggles
  const eyePath = 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z';
  const eyeCircle = '<circle cx="12" cy="12" r="3"/>';
  const eyeOffPaths =
    'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94' +
    'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24';

  document.querySelectorAll('.auth-pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
      const svg = btn.querySelector('svg');
      if (svg) {
        if (isPassword) {
          svg.innerHTML =
            '<path d="' + eyeOffPaths + '"/>' +
            '<line x1="1" y1="1" x2="23" y2="23"/>';
        } else {
          svg.innerHTML = '<path d="' + eyePath + '"/>' + eyeCircle;
        }
      }
    });
  });
})();
