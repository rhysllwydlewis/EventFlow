/**
 * Integration tests for JadeAssist widget loading
 * Ensures all HTML files use the self-hosted vendor script instead of the CDN.
 * Self-hosting avoids browser Tracking Prevention (Edge, Brave, Firefox, Safari)
 * blocking cdn.jsdelivr.net from accessing storage, which prevented widget initialization.
 */

const path = require('path');
const fs = require('fs');

// Helper function to recursively find all HTML files
function findHtmlFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
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
      // Find all HTML files in public directory
      const htmlFiles = findHtmlFiles(publicDir);

      const filesWithMain = [];
      for (const filePath of htmlFiles) {
        const content = fs.readFileSync(filePath, 'utf8');

        // Check for @main reference in JadeAssist URL
        if (content.includes('cdn.jsdelivr.net/gh/rhysllwydlewis/JadeAssist@main')) {
          filesWithMain.push(path.relative(publicDir, filePath));
        }
      }

      expect(filesWithMain).toEqual([]);
    });

    it('should use self-hosted vendor script instead of CDN in all HTML files', () => {
      // All HTML files must reference the local vendor file, not the CDN
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

      // No HTML files should reference the CDN directly
      expect(filesWithCDN).toEqual([]);
      // At least some HTML files should load the self-hosted vendor script
      expect(filesWithLocalScript.length).toBeGreaterThan(0);
    });

    it('should have self-hosted vendor file present', () => {
      const vendorPath = path.join(publicDir, 'assets/js/vendor/jade-widget.js');
      expect(fs.existsSync(vendorPath)).toBe(true);
    });
  });

  describe('Widget Initialization', () => {
    it('should have jadeassist-init.v2.js for widget configuration', () => {
      const initPath = path.join(publicDir, 'assets/js/jadeassist-init.v2.js');
      expect(fs.existsSync(initPath)).toBe(true);
    });

    it('should have legacy jadeassist-init.js for backwards compatibility', () => {
      const initPath = path.join(publicDir, 'assets/js/jadeassist-init.js');
      expect(fs.existsSync(initPath)).toBe(true);
    });

    it('should reference versioned init script in HTML files', () => {
      const htmlFiles = findHtmlFiles(publicDir);
      const filesWithVersionedInit = [];
      const filesWithOldInit = [];

      for (const filePath of htmlFiles) {
        const content = fs.readFileSync(filePath, 'utf8');

        if (content.includes('/assets/js/jadeassist-init.v2.js')) {
          filesWithVersionedInit.push(path.relative(publicDir, filePath));
        }
        // Check for old init script reference (not followed by .v2)
        if (content.match(/\/assets\/js\/jadeassist-init\.js["'\s>]/)) {
          filesWithOldInit.push(path.relative(publicDir, filePath));
        }
      }

      // All HTML files with JadeAssist should use the versioned init script
      expect(filesWithOldInit).toEqual([]);
      expect(filesWithVersionedInit.length).toBeGreaterThan(0);
    });
  });
});
