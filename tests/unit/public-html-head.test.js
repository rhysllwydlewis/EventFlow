'use strict';

const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '../../public');
const htmlFiles = fs
  .readdirSync(PUBLIC)
  .filter(file => file.endsWith('.html'))
  .filter(file => !file.startsWith('test-'));

describe('public HTML head and PWA icon markup', () => {
  test.each(htmlFiles)('%s has one well-formed head section', file => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    expect((html.match(/<head\b/gi) || []).length).toBe(1);
    expect((html.match(/<\/head>/gi) || []).length).toBe(1);
    expect(html.indexOf('<head')).toBeLessThan(html.indexOf('</head>'));
  });

  test.each(htmlFiles)('%s keeps favicon and manifest links inside head', file => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] || '';
    const outsideHead = html.replace(head, '');
    expect(outsideHead).not.toMatch(/rel=["'](?:icon|apple-touch-icon|manifest)["']/i);
    expect(head).toMatch(/rel=["']icon["'][^>]+href=["']\/favicon\.ico["']/i);
    expect(head).toMatch(/rel=["']apple-touch-icon["'][^>]+href=["']\/apple-touch-icon\.png["']/i);
    expect(head).toMatch(/rel=["']manifest["'][^>]+href=["']\/site\.webmanifest["']/i);
    expect(head).not.toMatch(/<link[^>]*<script/i);
  });
});
