'use strict';

const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const dashboardHtml = read('public/dashboard-supplier.html');
const homeJs = read('public/assets/js/pages/supplier-dashboard-home.js');
const homeCss = read('public/assets/css/supplier-dashboard-home.css');

describe('supplier dashboard page actions', () => {
  it('expands each form before moving focus into it', () => {
    expect(homeJs).toContain("openForm('profile-form-section', 'toggle-profile-form'");
    expect(homeJs).toContain(
      "openForm('package-form-section', 'toggle-package-form', 'pkg-title')"
    );
    const openForm = homeJs.slice(homeJs.indexOf('function openForm('));
    expect(openForm.indexOf('toggle.click()')).toBeLessThan(openForm.indexOf('field.focus('));
  });

  it('routes every next-step button to a real card or form', () => {
    ['#profile-card', '#packages-section', '#sdh-reviews', '#my-packages'].forEach(target => {
      expect(homeJs).toContain(`'${target}'`);
      expect(dashboardHtml).toContain(`id="${target.slice(1)}"`);
    });
    expect(homeJs).toContain("target: 'availability-calendar'");
    expect(dashboardHtml).toContain('id="availability-calendar"');
  });

  it('respects reduced-motion preferences when scrolling', () => {
    expect(homeJs).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(homeJs).toContain("prefersReducedMotion() ? 'auto' : 'smooth'");
  });

  it('declares non-submit types on all static dashboard buttons', () => {
    const buttons = dashboardHtml.match(/<button\b[^>]*>/g) || [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter(button => !/\btype=/.test(button))).toEqual([]);
  });

  it('provides visible keyboard focus and anchored-section offsets', () => {
    expect(homeCss).toContain('):focus-visible {');
    expect(homeCss).toContain('scroll-margin-top:');
  });

  it('has no "Messages" hero chip: messages are a card and a tile, so nothing is left without a handler', () => {
    expect(dashboardHtml).not.toContain('viewConversationsBtn');
    expect(dashboardHtml).not.toContain('dashboard-action-chip');
  });
});
