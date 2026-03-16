/**
 * Phase 2 Initialization Tests - PR #563
 * Tests for proper initialization of folders, labels, advanced search, and grouping features
 *
 * Note: public/messages.html was replaced with a redirect stub as part of the
 * legacy frontend cleanup.  The ServiceWorker tests remain unchanged.
 * The messages.html tests now verify the redirect behaviour.
 */

const fs = require('fs');

describe('Phase 2 Initialization', () => {
  let swContent;
  let messagesContent;

  // Read files once before all tests for better performance
  beforeAll(() => {
    swContent = fs.readFileSync('./public/sw.js', 'utf8');
    messagesContent = fs.readFileSync('./public/messages.html', 'utf8');
  });

  describe('ServiceWorker Cache Error Handling', () => {
    test('should have catch handlers on cache operations', () => {
      // Check for .catch() handlers after cache.put()
      expect(swContent).toContain('cache.put(request, responseClone).catch(err =>');
      expect(swContent).toContain('[SW] Cache write failed');

      // Check for .catch() handlers after caches.open()
      expect(swContent).toContain('.catch(err => {');
      expect(swContent).toContain('[SW] Cache open failed');
    });

    test('should log warnings instead of throwing errors', () => {
      // Should use console.warn for cache failures
      expect(swContent).toContain("console.warn('[SW] Cache write failed:'");
      expect(swContent).toContain("console.warn('[SW] Cache open failed:'");
    });
  });

  describe('messages.html legacy redirect', () => {
    // messages.html was replaced with a redirect stub as part of legacy cleanup.
    // These tests verify that the redirect page is in place.

    test('should redirect to /messenger/ via meta refresh', () => {
      expect(messagesContent).toContain('url=/messenger/');
    });

    test('should redirect to /messenger/ via meta refresh only (CSP hardening removed inline script)', () => {
      // Redirect is now handled by <meta http-equiv="refresh"> only (CSP hardening)
      expect(messagesContent).toContain('url=/messenger/');
      expect(messagesContent).not.toContain("window.location.replace('/messenger/')");
    });

    test('should include a fallback link to /messenger/', () => {
      expect(messagesContent).toContain('href="/messenger/"');
    });

    test('should be a valid HTML document', () => {
      expect(messagesContent).toContain('<!DOCTYPE html>');
      expect(messagesContent).toContain('<html');
      expect(messagesContent).toContain('</html>');
    });
  });
});
