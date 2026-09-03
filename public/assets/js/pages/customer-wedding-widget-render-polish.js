'use strict';
(function () {
  const DIALOG_SELECTOR = '.ww-app-dialog';
  const TRUST_LINE_HTML =
    '<span class="ww-render-trust-icon" aria-hidden="true">🔒</span><span>Your data is secure and private. Only you can see your event.</span>';
  let queued = false;

  function normaliseText(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function ensureElement(parent, selector, tagName, className) {
    if (!parent) {
      return null;
    }
    const existing = parent.querySelector(selector);
    if (existing) {
      return existing;
    }
    const element = document.createElement(tagName);
    element.className = className;
    element.setAttribute('aria-hidden', 'true');
    parent.appendChild(element);
    return element;
  }

  function setActiveTab(dialog) {
    if (!dialog) {
      return;
    }
    const activeButton = dialog.querySelector('.ww-app-tabs button[aria-selected="true"]');
    const activeTab = activeButton?.dataset?.tab || 'overview';
    dialog.dataset.activeTab = activeTab;
    dialog.querySelector('.ww-app-shell')?.setAttribute('data-active-tab', activeTab);
  }

  function enhanceHeader(dialog) {
    const header = dialog.querySelector('.ww-app-header');
    if (!header) {
      return;
    }
    header.classList.add('ww-render-header');
    const art = ensureElement(header, '.ww-render-header-art', 'div', 'ww-render-header-art');
    if (art && !art.innerHTML) {
      art.innerHTML = '<span></span><span></span><span></span>';
    }
  }

  function enhanceTrustLine(dialog) {
    const shell = dialog.querySelector('.ww-app-shell');
    if (!shell || shell.querySelector('.ww-render-trust-line')) {
      return;
    }
    const trustLine = document.createElement('div');
    trustLine.className = 'ww-render-trust-line';
    trustLine.innerHTML = TRUST_LINE_HTML;
    shell.appendChild(trustLine);
  }

  function enhanceOverview(dialog) {
    const pane = dialog.querySelector('[data-pane="overview"]');
    if (!pane) {
      return;
    }
    pane.querySelectorAll('.ww-app-panel, .ww-empty-state').forEach((panel, index) => {
      const text = normaliseText(panel.textContent);
      if (
        index === 0 ||
        text.includes('no wedding workspace') ||
        text.includes('next best action')
      ) {
        panel.classList.add('ww-render-overview-hero');
        ensureElement(panel, '.ww-render-panel-art', 'div', 'ww-render-panel-art');
      } else {
        panel.classList.add('ww-render-overview-panel');
      }
    });

    pane.querySelectorAll('.ww-overview-grid article, .ww-tiles > div').forEach((card, index) => {
      card.classList.add('ww-render-metric-card');
      card.style.setProperty('--ww-render-index', String(index));
    });
  }

  function inferChoiceType(card) {
    const text = normaliseText(card.textContent);
    if (text.includes('free wedding website') || text.includes('guest website')) {
      return 'free';
    }
    if (text.includes('full eventflow plan') || text.includes('budget')) {
      return 'full';
    }
    if (text.includes('existing plan')) {
      return 'existing';
    }
    return '';
  }

  function choiceIconSvg(type) {
    if (type === 'existing') {
      return '<svg viewBox="0 0 24 24" fill="none"><path d="M3.75 7.5h6l1.8 2.1h8.7v8.65a1.75 1.75 0 0 1-1.75 1.75h-13A1.75 1.75 0 0 1 3.75 18.25V7.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    if (type === 'full') {
      return '<svg viewBox="0 0 24 24" fill="none"><path d="M8 5.25h8A1.75 1.75 0 0 1 17.75 7v12A1.75 1.75 0 0 1 16 20.75H8A1.75 1.75 0 0 1 6.25 19V7A1.75 1.75 0 0 1 8 5.25Z" stroke="currentColor" stroke-width="1.8"/><path d="M9 4h6M9.25 10.5h5.5M9.25 14h5.5M9.25 17.5h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" stroke="currentColor" stroke-width="1.8"/><path d="M3.6 12h16.8M12 3c2.25 2.2 3.4 5.2 3.4 9S14.25 18.8 12 21M12 3c-2.25 2.2-3.4 5.2-3.4 9s1.15 6.8 3.4 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  function enhanceChoiceCard(card, index) {
    if (!card) {
      return;
    }
    const type =
      card.dataset.wwChoice || inferChoiceType(card) || ['free', 'full', 'existing'][index] || '';
    if (type) {
      card.dataset.wwChoice = type;
    }
    card.classList.add('ww-render-choice-card');

    if (!card.querySelector('.ww-render-choice-icon')) {
      const icon = document.createElement('span');
      icon.className = 'ww-render-choice-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = choiceIconSvg(type);
      card.prepend(icon);
    }

    card.querySelectorAll('button, .cta, select').forEach(control => {
      control.classList.add(`ww-render-${type || 'choice'}-control`);
    });
  }

  function enhanceWorkspace(dialog) {
    const pane = dialog.querySelector('[data-pane="workspace"]');
    if (!pane) {
      return;
    }

    pane.querySelectorAll('.ww-empty-state, .ww-app-panel').forEach((panel, index) => {
      const text = normaliseText(panel.textContent);
      if (text.includes('create your wedding website workspace') || text.includes('start with')) {
        panel.classList.add('ww-render-workspace-start');
        ensureElement(panel, '.ww-render-workspace-art', 'div', 'ww-render-workspace-art');
      } else if (index === 0) {
        panel.classList.add('ww-render-workspace-panel');
      }
    });

    pane
      .querySelectorAll('.ww-choice-grid')
      .forEach(grid => grid.classList.add('ww-render-choice-grid'));
    pane.querySelectorAll('.ww-choice-card').forEach(enhanceChoiceCard);
  }

  function enhanceDialog(dialog) {
    if (!dialog) {
      return;
    }

    if (dialog.dataset.wwRenderPolished !== 'true') {
      dialog.dataset.wwRenderPolished = 'true';
      dialog.classList.add('ww-render-polish');
      dialog.querySelector('.ww-app-shell')?.classList.add('ww-render-shell');
    }

    setActiveTab(dialog);
    enhanceHeader(dialog);
    enhanceTrustLine(dialog);
    enhanceOverview(dialog);
    enhanceWorkspace(dialog);
  }

  function enhanceOpenDialogs() {
    document.querySelectorAll(DIALOG_SELECTOR).forEach(enhanceDialog);
  }

  function schedule() {
    if (queued) {
      return;
    }
    queued = true;
    window.requestAnimationFrame(() => {
      queued = false;
      enhanceOpenDialogs();
    });
  }

  document.addEventListener(
    'click',
    event => {
      if (
        event.target instanceof Element &&
        event.target.closest('.ww-app-tabs button,[data-tab]')
      ) {
        window.setTimeout(schedule, 0);
      }
    },
    true
  );

  const observer = new MutationObserver(mutations => {
    if (
      mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(
          node =>
            node instanceof Element &&
            (node.matches?.(DIALOG_SELECTOR) || node.querySelector?.(DIALOG_SELECTOR))
        )
      )
    ) {
      schedule();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  schedule();
})();
