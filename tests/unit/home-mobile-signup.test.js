'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const RUNNER_PATH = path.join(ROOT, 'tests/helpers/home-mobile-signup-node-runner.cjs');
const CSS_PATH = path.join(ROOT, 'public/assets/css/home-mobile-signup.css');
const ACTIVE_CLASS = 'ef-home-mobile-signup-active';

describe('homepage mobile sign-up CTA', () => {
  it('passes its browser-behaviour regression suite in the supported Node/jsdom runtime', () => {
    const result = spawnSync(process.execPath, [RUNNER_PATH], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'test',
      },
    });

    expect({
      status: result.status,
      signal: result.signal,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    }).toEqual({
      status: 0,
      signal: null,
      stdout: 'Homepage mobile sign-up behaviour passed in the Node 22 jsdom runtime.',
      stderr: '',
    });
  });

  it('keeps assets versioned, touch targets accessible and mobile contrast intact', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const homeLoader = fs.readFileSync(path.join(ROOT, 'public/assets/js/home.js'), 'utf8');
    const v2Loader = fs.readFileSync(
      path.join(ROOT, 'public/assets/js/pages/home-v2-navbar-parity.js'),
      'utf8'
    );

    expect(css).toContain('min-height: 44px');
    expect(css).toContain('@keyframes ef-home-mobile-signup-glow');
    expect(css).toMatch(/ef-home-mobile-signup-glow[^;]+\s3\sboth/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(`.ef-header.${ACTIVE_CLASS} .ef-header-actions > #ef-auth-link`);
    expect(css).toContain('.home-v2-page .hv2-mobile-nav .hv2-mobile-signup-menu:hover');
    expect(homeLoader).toContain('/assets/css/home-mobile-signup.css?v=1.3.0');
    expect(homeLoader).toContain('/assets/js/components/home-mobile-signup.js?v=1.3.0');
    expect(v2Loader).toContain('/assets/css/home-mobile-signup.css?v=1.3.0');
    expect(v2Loader).toContain('/assets/js/components/home-mobile-signup.js?v=1.3.0');
  });
});
