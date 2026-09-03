'use strict';

const fs = require('fs');
const path = require('path');

const dashboardHtml = fs.readFileSync(
  path.join(process.cwd(), 'public/dashboard-supplier.html'),
  'utf8'
);
const actionsJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-actions.js'),
  'utf8'
);
const breadcrumbJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-breadcrumb.js'),
  'utf8'
);
const dashboardModuleJs = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/js/pages/dashboard-supplier-module.js'),
  'utf8'
);
const aestheticCss = fs.readFileSync(
  path.join(process.cwd(), 'public/assets/css/supplier-dashboard-aesthetic-refresh.css'),
  'utf8'
);

describe('supplier dashboard quick actions', () => {
  it('expands each form before moving focus into it', () => {
    expect(actionsJs).toContain("expandForm('profile-form-section', 'toggle-profile-form')");
    expect(actionsJs).toContain("expandForm('package-form-section', 'toggle-package-form')");
    expect(actionsJs.indexOf("expandForm('package-form-section'")).toBeLessThan(
      actionsJs.indexOf("document.getElementById('pkg-title')")
    );
  });

  it('wires every new-package entry point and targets a real section', () => {
    expect(actionsJs).toContain('querySelectorAll(\'[data-action="new-package"]\')');
    expect(dashboardHtml).toMatch(
      /href="#my-packages"[^>]*id="earnings-create-pkg-cta"|id="earnings-create-pkg-cta"[^>]*href="#my-packages"/
    );
    expect(dashboardHtml).not.toContain('href="#packages-section"');
    expect(dashboardModuleJs).not.toContain("getElementById('packages-section')");
  });

  it('uses the section navigation for stats, support, and messages', () => {
    expect(actionsJs).toContain("activateSection('supplier-stats-grid')");
    expect(actionsJs).toContain("activateSection('tickets-sup')");
    expect(breadcrumbJs).toContain('.mobile-nav-pill[data-section="threads-sup"]');
    expect(breadcrumbJs).toContain('messagesPill.click()');
  });

  it('respects reduced-motion preferences for fallback scrolling', () => {
    expect(actionsJs).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
    expect(breadcrumbJs).toContain("matchMedia?.('(prefers-reduced-motion: reduce)')");
  });

  it('copies review links without blocking browser prompts', () => {
    expect(actionsJs).not.toContain('window.prompt');
    expect(actionsJs).toContain('navigator.clipboard?.writeText');
    expect(actionsJs).toContain("document.execCommand('copy')");
    expect(actionsJs).toContain('copyField?.remove()');
    expect(actionsJs).toContain('Could not copy the review link. Please try again.');
  });

  it('declares non-submit types on all static dashboard buttons', () => {
    const buttons = dashboardHtml.match(/<button\b[^>]*>/g) || [];
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.filter(button => !/\btype=/.test(button))).toEqual([]);
  });

  it('provides visible keyboard focus and anchored-section offsets', () => {
    expect(aestheticCss).toContain('):focus-visible {');
    expect(aestheticCss).toContain('scroll-margin-top:');
  });
});
