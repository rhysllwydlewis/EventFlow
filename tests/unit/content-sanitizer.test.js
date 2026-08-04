/**
 * The fallback sanitiser (`basicSanitize`) runs whenever DOMPurify/jsdom
 * cannot initialise in the current runtime. It had no test coverage at all,
 * and two of its regular expressions were flagged by CodeQL as polynomial
 * ReDoS risks reachable with attacker-controlled content. These tests force
 * that fallback path deterministically (rather than relying on DOMPurify
 * actually being unavailable) and assert both its output and its timing
 * against adversarial input.
 */

'use strict';

describe('content sanitizer — fallback path (DOMPurify unavailable)', () => {
  let sanitizer;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('jsdom', () => {
      throw new Error('jsdom unavailable in this test');
    });
    jest.doMock('dompurify', () => {
      throw new Error('dompurify unavailable in this test');
    });
    sanitizer = require('../../services/contentSanitizer');
  });

  afterEach(() => {
    jest.dontMock('jsdom');
    jest.dontMock('dompurify');
  });

  it('confirms the fallback is actually in effect', () => {
    // DOMPurify would strip a disallowed tag like <div> but keep its content
    // (KEEP_CONTENT: true); the fallback has no tag allowlist at all and
    // leaves non-script/style tags untouched. This is the signal every other
    // test in this file relies on.
    expect(sanitizer.sanitizeContent('<div>kept</div>')).toBe('<div>kept</div>');
  });

  describe('strict mode', () => {
    it('removes every tag, keeping the text between them', () => {
      expect(sanitizer.stripHtml('<p>hello <b>world</b></p>')).toBe('hello world');
    });

    it('keeps content whose tag has no closing pair', () => {
      // <b> is a complete, terminated tag; it simply has no matching </b>.
      // stripTags removes each tag independently, so the content survives.
      expect(sanitizer.stripHtml('before <b>bold text with no close')).toBe(
        'before bold text with no close'
      );
    });

    it('drops a genuinely unterminated tag (no ">" at all) and everything after it', () => {
      expect(sanitizer.stripHtml('before <b bold text with no closing bracket')).toBe('before ');
    });

    it('handles plain text with no tags at all', () => {
      expect(sanitizer.stripHtml('plain text')).toBe('plain text');
    });
  });

  describe('non-strict mode', () => {
    it('removes a script block including its content', () => {
      expect(sanitizer.sanitizeContent('<p>ok</p><script>evil()</script>after')).toBe(
        '<p>ok</p>after'
      );
    });

    it('removes a style block including its content, case-insensitively', () => {
      expect(sanitizer.sanitizeContent('<STYLE>body{color:red}</STYLE>kept')).toBe('kept');
    });

    it('tolerates whitespace and attributes around the tag name', () => {
      expect(sanitizer.sanitizeContent('<Script Type="text/javascript" >bad</Script >kept')).toBe(
        'kept'
      );
    });

    it('does not mistake a tag name that merely starts with "script" for a real tag', () => {
      expect(sanitizer.sanitizeContent('<scripter>not a script</scripter>')).toBe(
        '<scripter>not a script</scripter>'
      );
    });

    it('removes inline event handler attributes', () => {
      expect(sanitizer.sanitizeContent('<a onclick="bad()">x</a>')).toBe('<a>x</a>');
    });

    it('removes the javascript: scheme prefix from an href', () => {
      // Pre-existing behaviour, unchanged by this fix: only the "javascript:"
      // token itself is removed, leaving the rest of the value as an
      // attribute rather than an executable scheme.
      expect(sanitizer.sanitizeContent('<a href="javascript:alert(1)">x</a>')).toBe(
        '<a href="alert(1)">x</a>'
      );
    });

    it('removes multiple separate script and style blocks', () => {
      expect(sanitizer.sanitizeContent('<script>a</script><style>b</style><b>kept</b>')).toBe(
        '<b>kept</b>'
      );
    });

    it('drops an unclosed script block and everything after it', () => {
      expect(sanitizer.sanitizeContent('before<script>never closed')).toBe('before');
    });
  });

  describe('adversarial input completes promptly', () => {
    // Each of these targets a specific expression that was rewritten:
    // stripTags (strict mode), and stripTagBlocks (script/style removal in
    // non-strict mode). All must stay well under a second regardless of how
    // the hostile input is shaped.
    const LIMIT = 20000;
    const cases = {
      'a long run of unclosed "<" (strict)': () => sanitizer.stripHtml('<'.repeat(LIMIT)),
      'many unclosed "<script" openings': () => sanitizer.sanitizeContent('<script'.repeat(LIMIT)),
      'many complete <script> blocks back to back': () =>
        sanitizer.sanitizeContent('<script>x</script>'.repeat(LIMIT / 10)),
      'many complete <style> blocks back to back': () =>
        sanitizer.sanitizeContent('<style>x</style>'.repeat(LIMIT / 10)),
      'a flood of near-miss tag names ("<scripter>")': () =>
        sanitizer.sanitizeContent('<scripter>'.repeat(LIMIT / 5)),
      'alternating complete script, style and ordinary tags': () =>
        sanitizer.sanitizeContent('<script>a</script><style>b</style><b>c</b>'.repeat(LIMIT / 20)),
    };

    Object.entries(cases).forEach(([description, run]) => {
      it(`handles ${description} in well under a second`, () => {
        const started = Date.now();
        run();
        expect(Date.now() - started).toBeLessThan(1000);
      });
    });
  });
});

// There is deliberately no "DOMPurify available" counterpart to the suite
// above. `require('jsdom')` fails inside this repository's Jest environment
// with "Unexpected token 'export'" — one of jsdom's transitive dependencies
// ships ES modules that Jest's configured transform does not parse — so
// getPurifier() always falls back to basicSanitize under Jest, everywhere in
// this suite, regardless of any mocking. That is a pre-existing gap between
// the test and production environments unrelated to this change; production
// itself is unaffected (plain Node loads jsdom without issue, verified
// directly). Explicitly forcing the fallback above, rather than relying on
// this incidental behaviour, is what makes these tests mean the same thing
// whether or not that gap is ever closed.
