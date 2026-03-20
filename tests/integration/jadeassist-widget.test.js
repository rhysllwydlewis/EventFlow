/**
 * Integration tests for JadeAssist widget loading.
 *
 * Covers:
 * - Self-hosted vendor script (not CDN) — avoids browser Tracking Prevention
 *   blocking cdn.jsdelivr.net in Edge/Brave/Firefox/Safari
 * - All HTML pages use jadeassist-init.v2.js (not the legacy script)
 * - v2 init script contains required features: teaser, accessibility, debug mode
 */

const path = require('path');
const fs = require('fs');

// Helper: recursively find all HTML files under a directory
function findHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      findHtmlFiles(filePath, fileList);
    } else if (file.endsWith('.html')) {
      fileList.push(filePath);
    }
  });
  return fileList;
}

describe('JadeAssist Widget Pinning', () => {
  const publicDir = path.join(__dirname, '../../public');

  describe('Widget Script URLs', () => {
    it('should not reference @main in any HTML files', () => {
      const htmlFiles = findHtmlFiles(publicDir);
      const filesWithMain = htmlFiles.filter(f =>
        fs.readFileSync(f, 'utf8').includes('cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@main')
      );
      expect(filesWithMain.map(f => path.relative(publicDir, f))).toEqual([]);
    });

    it('should use self-hosted vendor script instead of CDN in all HTML files', () => {
      const htmlFiles = findHtmlFiles(publicDir);
      const filesWithCDN = [];
      const filesWithLocalScript = [];

      for (const filePath of htmlFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@')) {
          filesWithCDN.push(path.relative(publicDir, filePath));
        }
        if (content.includes('/assets/js/vendor/jade-widget.js')) {
          filesWithLocalScript.push(path.relative(publicDir, filePath));
        }
      }

      expect(filesWithCDN).toEqual([]);
      expect(filesWithLocalScript.length).toBeGreaterThan(0);
    });

    it('should have self-hosted vendor file present', () => {
      expect(fs.existsSync(path.join(publicDir, 'assets/js/vendor/jade-widget.js'))).toBe(true);
    });
  });

  describe('Widget Initialization', () => {
    it('should have jadeassist-init.v2.js for widget configuration', () => {
      expect(fs.existsSync(path.join(publicDir, 'assets/js/jadeassist-init.v2.js'))).toBe(true);
    });

    it('should have legacy jadeassist-init.js present', () => {
      expect(fs.existsSync(path.join(publicDir, 'assets/js/jadeassist-init.js'))).toBe(true);
    });

    it('should reference versioned init script in HTML files and not the legacy one', () => {
      const htmlFiles = findHtmlFiles(publicDir);
      const filesWithVersionedInit = [];
      const filesWithOldInit = [];

      for (const filePath of htmlFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes('/assets/js/jadeassist-init.v2.js')) {
          filesWithVersionedInit.push(path.relative(publicDir, filePath));
        }
        // Detect bare legacy reference (not followed by .v2)
        if (content.match(/\/assets\/js\/jadeassist-init\.js["'\s>]/)) {
          filesWithOldInit.push(path.relative(publicDir, filePath));
        }
      }

      expect(filesWithOldInit).toEqual([]);
      expect(filesWithVersionedInit.length).toBeGreaterThan(0);
    });
  });

  describe('v2 Init Script Feature Completeness', () => {
    let v2Content;

    beforeAll(() => {
      v2Content = fs.readFileSync(path.join(publicDir, 'assets/js/jadeassist-init.v2.js'), 'utf8');
    });

    it('should contain double-init guard', () => {
      expect(v2Content).toContain('__JADE_WIDGET_INITIALIZED__');
    });

    it('should support ?jade-debug query param for debug mode in any environment', () => {
      expect(v2Content).toContain("urlParams.has('jade-debug')");
      // The shouldEnableDebug function must not gate logs behind isDevelopment
      // Verify that shouldEnableDebug() is used directly as the debug condition (not isDevelopment)
      expect(v2Content).toContain('shouldEnableDebug');
      // Must NOT double-gate debug output with isDevelopment check
      expect(v2Content).not.toMatch(/if\s*\(debug\)\s*\{[^}]*if\s*\(isDevelopment\)/s);
    });

    it('should contain teaser bubble constants', () => {
      expect(v2Content).toContain('TEASER_DELAY');
      expect(v2Content).toContain('TEASER_STORAGE_KEY');
      expect(v2Content).toContain('TEASER_EXPIRY_DAYS');
      expect(v2Content).toContain('MOBILE_BREAKPOINT');
    });

    it('should contain A/B teaser variants', () => {
      expect(v2Content).toContain('TEASER_VARIANTS');
      // All three variants present (keys may be quoted or unquoted)
      expect(v2Content).toMatch(/A\s*:/);
      expect(v2Content).toMatch(/B\s*:/);
      expect(v2Content).toMatch(/C\s*:/);
    });

    it('should have keyboard-accessible teaser (Enter/Space/Escape)', () => {
      expect(v2Content).toContain("'Enter'");
      expect(v2Content).toContain("' '");
      expect(v2Content).toContain("'Escape'");
    });

    it('should not force close button to be unreachable via keyboard', () => {
      // The close button is a <button> element (naturally focusable).
      // We must NOT set tabindex="-1" on it — that would make it unreachable
      // for keyboard-only users who want to dismiss without opening the chat.
      expect(v2Content).not.toContain('tabindex="-1"');
    });

    it('should emit analytics custom events', () => {
      expect(v2Content).toContain('jadeassist:teaser-clicked');
      expect(v2Content).toContain('jadeassist:widget-opened');
      expect(v2Content).toContain('jadeassist:teaser-dismissed');
    });

    it('should include safe-area-inset CSS for iOS', () => {
      expect(v2Content).toContain('safe-area-inset-bottom');
    });

    it('should implement scroll engagement trigger at 25%', () => {
      // Verify the specific scroll calculation is present
      expect(v2Content).toMatch(/scrollY\s*\/\s*scrollable.*\*\s*100|pct\s*>=?\s*25/s);
      expect(v2Content).toContain("addEventListener('scroll'");
    });

    it('should resolve avatar URL for subpath deployments', () => {
      expect(v2Content).toContain('getAvatarUrl');
      expect(v2Content).toContain('jade-avatar.png');
    });

    it('should disable native greetingTooltipText to avoid duplicate teaser', () => {
      expect(v2Content).toContain("greetingTooltipText: ''");
    });
  });
});
