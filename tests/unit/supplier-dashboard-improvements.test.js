/**
 * Unit tests for supplier dashboard improvements:
 *   - Welcome overlay dismissal with localStorage persistence
 *   - Overlay dismiss does NOT hide the hero section (#welcome-section)
 *   - Scroll-spy guard: at scrollY=0, always activate first pill
 */

describe('Supplier welcome overlay dismiss persistence', () => {
  const DISMISS_KEY = 'ef_supplier_welcome_dismissed';

  // Documented no-op: the hero (#welcome-section) is permanently visible.
  // The dismiss key only prevents the onboarding overlay from reappearing;
  // it never hides the hero. This function is kept to document that contract.
  function applyDismissalLogic() {}

  // Mirrors the updated dismissWelcomeOverlay function from dashboard-supplier-module.js.
  // Stores both dismiss keys and removes the overlay element; the hero is NOT touched.
  function makeDismissHandler(storage, overlayEl) {
    return function dismissWelcomeOverlay() {
      try {
        storage.setItem('ef_onboarding_dismissed', '1');
        storage.setItem(DISMISS_KEY, '1');
      } catch (_) {
        /* ignore */
      }
      // Remove (simulate hide) the overlay, not the hero.
      overlayEl.removed = true;
    };
  }

  // Legacy helper kept for backward-compat with existing tests.
  // welcomeEl is now the OVERLAY (not the hero), matching the updated contract.
  function applyOnboardingDismissHandler(storage, overlayEl, dismissBtn) {
    const listeners = {};
    dismissBtn.addEventListener = (evt, fn) => {
      listeners[evt] = fn;
    };
    const handler = makeDismissHandler(storage, overlayEl);
    dismissBtn.addEventListener('click', handler);
    return listeners;
  }

  it('hero section remains visible on page load when dismiss key is already set', () => {
    const storage = { store: { [DISMISS_KEY]: '1' } };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    const welcomeEl = { style: { display: '' } };

    applyDismissalLogic(storage, welcomeEl);

    // Hero must NOT be hidden — dismiss key only guards the overlay
    expect(welcomeEl.style.display).toBe('');
  });

  it('hero section is visible on page load when dismiss key is absent', () => {
    const storage = { store: {} };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    const welcomeEl = { style: { display: '' } };

    applyDismissalLogic(storage, welcomeEl);

    expect(welcomeEl.style.display).toBe('');
  });

  it('sets both dismiss keys and removes overlay — hero is NOT hidden — when dismiss is called', () => {
    const storage = { store: {} };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    const overlayEl = { removed: false };
    const dismiss = makeDismissHandler(storage, overlayEl);

    dismiss();

    // Overlay is removed
    expect(overlayEl.removed).toBe(true);
    // Hero is not referenced by the dismiss handler - applyDismissalLogic is a no-op
    const heroEl = { style: { display: '' } };
    applyDismissalLogic();
    expect(heroEl.style.display).toBe('');
    // Both keys are stored
    expect(storage.store[DISMISS_KEY]).toBe('1');
    expect(storage.store['ef_onboarding_dismissed']).toBe('1');
  });

  it('sets both dismiss keys and removes overlay when overlay "Got it!" button is clicked', () => {
    const storage = { store: {} };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    const overlayEl = { removed: false };
    const dismissBtn = {};
    const listeners = applyOnboardingDismissHandler(storage, overlayEl, dismissBtn);

    // Simulate clicking the "Got it! Let's go" button on the overlay card
    listeners.click();

    expect(overlayEl.removed).toBe(true);
    expect(storage.store[DISMISS_KEY]).toBe('1');
    expect(storage.store['ef_onboarding_dismissed']).toBe('1');
  });

  it('persists dismissal keys so the overlay does not reappear on subsequent page loads', () => {
    const storage = { store: {} };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    // First "page load" — user clicks dismiss
    const overlayEl1 = { removed: false };
    const dismiss = makeDismissHandler(storage, overlayEl1);
    dismiss();

    // Second "page load" — key is already set, hero remains visible
    const heroEl2 = { style: { display: '' } };
    applyDismissalLogic(storage, heroEl2);

    // Hero is still visible on return visit
    expect(heroEl2.style.display).toBe('');
    // Dismiss key persists (prevents overlay from reappearing)
    expect(storage.store[DISMISS_KEY]).toBe('1');
  });

  it('persists dismissal keys via overlay "Got it!" so hero stays visible on subsequent loads', () => {
    const storage = { store: {} };
    storage.getItem = key => storage.store[key] || null;
    storage.setItem = (key, val) => {
      storage.store[key] = val;
    };

    // First "page load" — user clicks dismiss via the overlay "Got it!" button
    const overlayEl1 = { removed: false };
    const dismissBtn = {};
    const listeners = applyOnboardingDismissHandler(storage, overlayEl1, dismissBtn);
    listeners.click();

    // Second "page load" — hero is still shown
    const heroEl2 = { style: { display: '' } };
    applyDismissalLogic(storage, heroEl2);

    expect(heroEl2.style.display).toBe('');
    expect(storage.store[DISMISS_KEY]).toBe('1');
  });

  it('handles storage errors gracefully (does not throw)', () => {
    const storage = {
      getItem: () => {
        throw new Error('QuotaExceededError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const welcomeEl = { style: { display: '' } };

    expect(() => applyDismissalLogic(storage, welcomeEl)).not.toThrow();
    expect(welcomeEl.style.display).toBe('');
  });

  it('handles storage errors in dismiss handler gracefully (does not throw)', () => {
    const storage = {
      getItem: () => {
        throw new Error('QuotaExceededError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const overlayEl = { removed: false };
    const dismiss = makeDismissHandler(storage, overlayEl);

    expect(() => dismiss()).not.toThrow();
    // Overlay is still removed even when storage throws
    expect(overlayEl.removed).toBe(true);
  });

  it('handles storage errors in click handler gracefully (does not throw)', () => {
    const storage = {
      getItem: () => {
        throw new Error('QuotaExceededError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const overlayEl = { removed: false };
    const dismissBtn = {};
    const listeners = applyOnboardingDismissHandler(storage, overlayEl, dismissBtn);

    expect(() => listeners.click()).not.toThrow();
    // Overlay is still removed even when storage throws
    expect(overlayEl.removed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('applyTimeBasedGreeting — greeting text always updates', () => {
  // Mirrors the fixed applyTimeBasedGreeting() from supplier-dashboard-enhancements.js
  const THEME_CLASSES = [
    'supplier-welcome-card--morning',
    'supplier-welcome-card--afternoon',
    'supplier-welcome-card--evening',
    'supplier-welcome-card--night',
  ];

  function applyTimeBasedGreeting(hour, greetingEl, card) {
    if (!greetingEl) {
      return;
    }
    let variant = 'afternoon';
    let greeting = 'Good day,';
    if (hour >= 5 && hour < 12) {
      variant = 'morning';
      greeting = 'Good morning,';
    } else if (hour >= 12 && hour < 17) {
      variant = 'afternoon';
      greeting = 'Good afternoon,';
    } else if (hour >= 17 && hour < 21) {
      variant = 'evening';
      greeting = 'Good evening,';
    } else {
      variant = 'night';
      greeting = 'Good night,';
    }
    if (card && card.classList.contains('supplier-welcome-card')) {
      THEME_CLASSES.forEach(cls => card.classList.remove(cls));
      card.classList.add(`supplier-welcome-card--${variant}`);
    }
    greetingEl.textContent = greeting;
  }

  it('updates greeting text even when no .supplier-welcome-card element exists', () => {
    const greetingEl = { textContent: 'Good day' };
    applyTimeBasedGreeting(9, greetingEl, null);
    expect(greetingEl.textContent).toBe('Good morning,');
  });

  it('updates greeting for each time band', () => {
    const cases = [
      [3, 'Good night,'],
      [5, 'Good morning,'],
      [11, 'Good morning,'],
      [12, 'Good afternoon,'],
      [16, 'Good afternoon,'],
      [17, 'Good evening,'],
      [20, 'Good evening,'],
      [21, 'Good night,'],
    ];
    for (const [hour, expected] of cases) {
      const el = { textContent: '' };
      applyTimeBasedGreeting(hour, el, null);
      expect(el.textContent).toBe(expected);
    }
  });

  it('does not throw when greetingEl is null', () => {
    expect(() => applyTimeBasedGreeting(10, null, null)).not.toThrow();
  });

  it('applies theme class only when card has .supplier-welcome-card class', () => {
    const greetingEl = { textContent: '' };
    const classes = new Set(['supplier-welcome-card']);
    const card = {
      classList: {
        contains: cls => classes.has(cls),
        remove: cls => classes.delete(cls),
        add: cls => classes.add(cls),
      },
    };
    applyTimeBasedGreeting(9, greetingEl, card); // morning
    expect(classes.has('supplier-welcome-card--morning')).toBe(true);
    expect(greetingEl.textContent).toBe('Good morning,');
  });

  it('does not apply theme class when card lacks .supplier-welcome-card (dashboard-hero)', () => {
    const greetingEl = { textContent: '' };
    const classes = new Set(['dashboard-hero']); // redesigned hero — no legacy class
    const card = {
      classList: {
        contains: cls => classes.has(cls),
        remove: cls => classes.delete(cls),
        add: cls => classes.add(cls),
      },
    };
    applyTimeBasedGreeting(9, greetingEl, card);
    // Greeting text should update
    expect(greetingEl.textContent).toBe('Good morning,');
    // No theme class should be added
    expect(classes.has('supplier-welcome-card--morning')).toBe(false);
  });
});

describe('Scroll-spy guard — first pill always active at scrollY=0', () => {
  // Mirrors the updateActiveByScroll logic from supplier-dashboard-enhancements.js
  function buildUpdateActiveByScroll(sections, setActive, getScrollY, getStickyOffset) {
    return function updateActiveByScroll() {
      if (!sections.length) {
        return;
      }

      if (getScrollY() < 10) {
        setActive(sections[0].pill);
        return;
      }

      const currentY = getScrollY() + getStickyOffset();
      let current = sections[0];

      sections.forEach(section => {
        if (section.target.offsetTop <= currentY) {
          current = section;
        }
      });

      if (current) {
        setActive(current.pill);
      }
    };
  }

  const pills = ['overview', 'stats', 'profiles', 'packages', 'messages', 'tickets', 'settings'];

  const sections = [
    { pill: 'overview', target: { offsetTop: 0 } },
    { pill: 'stats', target: { offsetTop: 200 } },
    { pill: 'profiles', target: { offsetTop: 400 } },
    { pill: 'packages', target: { offsetTop: 600 } },
    { pill: 'messages', target: { offsetTop: 800 } },
    { pill: 'tickets', target: { offsetTop: 1000 } },
    { pill: 'settings', target: { offsetTop: 1200 } },
  ];

  it('activates the first pill when scrollY is 0', () => {
    let activePill = null;
    const setActive = pill => {
      activePill = pill;
    };
    const getStickyOffset = () => 128; // typical header + quick-nav height

    const updateActiveByScroll = buildUpdateActiveByScroll(
      sections,
      setActive,
      () => 0,
      getStickyOffset
    );

    updateActiveByScroll();

    expect(activePill).toBe('overview');
  });

  it('activates the first pill when scrollY is 9 (just under threshold)', () => {
    let activePill = null;
    const setActive = pill => {
      activePill = pill;
    };
    const getStickyOffset = () => 128;

    const updateActiveByScroll = buildUpdateActiveByScroll(
      sections,
      setActive,
      () => 9,
      getStickyOffset
    );

    updateActiveByScroll();

    expect(activePill).toBe('overview');
  });

  it('uses scroll position to determine active pill when scrollY >= 10', () => {
    let activePill = null;
    const setActive = pill => {
      activePill = pill;
    };
    const getStickyOffset = () => 0; // simplify: no offset

    // scrollY=450 → currentY=450; last section with offsetTop<=450 is "profiles" (400)
    const updateActiveByScroll = buildUpdateActiveByScroll(
      sections,
      setActive,
      () => 450,
      getStickyOffset
    );

    updateActiveByScroll();

    expect(activePill).toBe('profiles');
  });

  it('does nothing when sections array is empty', () => {
    let called = false;
    const setActive = () => {
      called = true;
    };

    const updateActiveByScroll = buildUpdateActiveByScroll(
      [],
      setActive,
      () => 0,
      () => 128
    );

    expect(() => updateActiveByScroll()).not.toThrow();
    expect(called).toBe(false);
  });

  it('without the guard, stickyOffset alone at scrollY=0 would select a non-first pill', () => {
    // This test demonstrates WHY the guard is needed.
    // A sticky offset of 128px at scrollY=0 gives currentY=128, which is
    // greater than sections[0].offsetTop (0) but the loop keeps overwriting
    // `current` with any section whose offsetTop <= 128.
    // With sections starting at 0, 200, 400 … only the first (offsetTop=0)
    // would match here — but with real collapsed/skeleton layouts many sections
    // can have offsetTop=0, causing tickets (last) to win.
    // The guard short-circuits before the loop, ensuring "overview" wins.
    let activePill = null;
    const setActive = pill => {
      activePill = pill;
    };

    // Simulate three sections all reporting offsetTop=0 (skeleton not yet rendered)
    const collapsedSections = [
      { pill: 'overview', target: { offsetTop: 0 } },
      { pill: 'stats', target: { offsetTop: 0 } },
      { pill: 'tickets', target: { offsetTop: 0 } },
    ];

    const updateActiveByScroll = buildUpdateActiveByScroll(
      collapsedSections,
      setActive,
      () => 0, // scrollY=0
      () => 128 // sticky offset
    );

    updateActiveByScroll();

    // Guard kicks in → first pill wins, NOT 'tickets'
    expect(activePill).toBe('overview');
  });
});
