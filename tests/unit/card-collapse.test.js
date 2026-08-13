/**
 * The mobile card-collapse control (public/assets/js/card-collapse.js), driven
 * through a real DOM.
 *
 * Introduced to shorten a long dashboard page on small screens by collapsing
 * cards to their header; extended for the supplier dashboard reorder so that
 * the two highest-priority cards (Profile, Packages) open by default while
 * everything else still collapses, and with a bulk "Expand all / Collapse
 * all" control now that a fully-collapsed page has 17 individual toggles.
 *
 * The scenarios run in a plain Node process (jsdom cannot be loaded through
 * Jest's transform here) and report their outcomes as JSON — the same
 * approach the admin locations editor and supplier-init suites take.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '../..');

const results = JSON.parse(
  execFileSync(process.execPath, [path.join(root, 'tests/helpers/card-collapse-scenarios.js')], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
);

/**
 * The value a scenario produced, failing loudly if the scenario itself threw.
 * @param {string} name Scenario name.
 * @returns {Object} Scenario value.
 */
function outcome(name) {
  const result = results[name];
  if (!result) {
    throw new Error(`No such scenario: ${name}`);
  }
  if (!result.ok) {
    throw new Error(`Scenario "${name}" threw: ${result.error}\n${result.stack}`);
  }
  return result.value;
}

describe('on a mobile viewport (<=1024px)', () => {
  const value = outcome('mobileInit');

  it('never makes the hero collapsible', () => {
    expect(value.heroCollapsible).toBe(false);
  });

  it('opens data-default-expanded cards (Profile, Packages) by default', () => {
    expect(value.profile.collapsed).toBe(false);
    expect(value.packages.collapsed).toBe(false);
  });

  it('collapses every other card by default', () => {
    expect(value.messages.collapsed).toBe(true);
  });

  it('keeps aria-expanded in sync with the collapsed class, in both directions', () => {
    expect(value.profile.ariaExpanded).toBe('true');
    expect(value.messages.ariaExpanded).toBe('false');
  });

  it('sets aria-label to describe the action the button performs next, not the current state', () => {
    expect(value.profile.ariaLabel).toBe('Collapse card');
    expect(value.messages.ariaLabel).toBe('Expand card');
  });

  it('rotates the chevron 180deg (pointing up) only when open — matching .accordion-icon and .article-toc elsewhere on the site, where closed points down', () => {
    expect(value.profile.rotate).toBe('180deg');
    expect(value.messages.rotate).toBe('0deg');
  });

  it('only throbs the hint animation on a card that starts collapsed', () => {
    expect(value.profile.throb).toBeUndefined();
    expect(value.messages.throb).toBe('1');
  });

  it('does not give a nested .package-card its own toggle when its ancestor already has one', () => {
    expect(value.nestedPackageCardIsCollapsible).toEqual([false, false, false]);
  });

  it('does not wrap a card with nothing but a header — there is no body to hide', () => {
    expect(value.lonelyHeaderCardIsCollapsible).toBe(false);
  });

  it('leaves a single-value stat tile alone', () => {
    expect(value.statWidgetIsCollapsible).toBe(false);
  });

  it('renders the bulk expand/collapse control', () => {
    expect(value.bulkActionsVisible).toBe(true);
  });
});

describe('on a desktop viewport (>1024px)', () => {
  const value = outcome('desktopInit');

  it('adds no collapse buttons and marks no card collapsible', () => {
    expect(value.collapsibleCount).toBe(0);
    expect(value.collapseButtonCount).toBe(0);
  });
});

describe('toggling a card', () => {
  const value = outcome('keyboardToggle');

  it('starts collapsed (no data-default-expanded on this card)', () => {
    expect(value.before.collapsed).toBe(true);
  });

  it('opens on the first activation — class, aria-expanded, aria-label and rotate all flip together', () => {
    expect(value.afterFirstToggle).toEqual({
      collapsed: false,
      ariaExpanded: 'true',
      ariaLabel: 'Collapse card',
      rotate: '180deg',
      wrapperDisplay: '',
    });
  });

  it('closes again on the second activation', () => {
    expect(value.afterSecondToggle.collapsed).toBe(true);
    expect(value.afterSecondToggle.ariaExpanded).toBe('false');
    expect(value.afterSecondToggle.rotate).toBe('0deg');
  });
});

describe('the bulk "Expand all / Collapse all" control', () => {
  const value = outcome('bulkActions');

  it('starts from the priority defaults (Profile and Packages open, Messages closed)', () => {
    expect(value.initial).toEqual({ profile: false, packages: false, messages: true });
  });

  it('"Expand all" opens every card, including ones already open', () => {
    expect(value.afterExpandAll).toEqual({ profile: false, packages: false, messages: false });
  });

  it('"Collapse all" closes every card, including the priority ones', () => {
    expect(value.afterCollapseAll).toEqual({ profile: true, packages: true, messages: true });
  });
});

describe('persistence across a re-init (simulating a reload within the same session)', () => {
  const value = outcome('persistenceAcrossReinit');

  it('stores the user’s explicit choice in both directions, not just "collapsed"', () => {
    // packages-section: the user collapsed a card that defaults open -> true.
    // The Messages card's id is a generated hash, so check by value instead of key.
    expect(value.storedRaw['packages-section']).toBe(true);
    expect(Object.values(value.storedRaw)).toContain(false);
  });

  it('keeps a card the user explicitly collapsed collapsed, even though it defaults open', () => {
    expect(value.packagesAfterReinit.collapsed).toBe(true);
  });

  it('keeps a card the user explicitly expanded expanded, even though it defaults closed', () => {
    expect(value.messagesAfterReinit.collapsed).toBe(false);
  });

  it('leaves an untouched default-expanded card resolving to its own default', () => {
    expect(value.profileAfterReinit.collapsed).toBe(false);
  });
});
