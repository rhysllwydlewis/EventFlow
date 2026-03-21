/**
 * Regression test for the vendored JadeAssist widget bundle.
 *
 * Ensures the self-hosted bundle targets the public /api/widget/chat endpoint
 * (added in JadeAssist PR #18) and does NOT call the JWT-protected /api/chat
 * endpoint, which would cause 401 errors on public pages.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const BUNDLE_PATH = path.resolve(
  __dirname,
  '../../public/assets/js/vendor/jade-widget.js'
);

describe('vendored jade-widget.js bundle', () => {
  let bundleSource;

  beforeAll(() => {
    bundleSource = fs.readFileSync(BUNDLE_PATH, 'utf8');
  });

  it('exists and is non-empty', () => {
    expect(bundleSource.length).toBeGreaterThan(0);
  });

  it('calls /api/widget/chat (the public unauthenticated endpoint)', () => {
    expect(bundleSource).toContain('/api/widget/chat');
  });

  it('does NOT call the JWT-protected /api/chat endpoint directly', () => {
    // The fetch path must not be the old authenticated endpoint.
    // We check for the fetch string specifically to avoid false positives from
    // comment strings or error messages that might mention /api/chat.
    expect(bundleSource).not.toMatch(/fetch\([^)]*\/api\/chat[^)]*\)/);
  });
});
