import fs from 'node:fs';

const rendererPath = 'utils/template-renderer.js';
const renderTestPath = 'tests/integration/anonymous-public-render-path.test.js';
const widgetTestPath = 'tests/integration/jadeassist-widget.test.js';
const version = '20260723-1';

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Unable to apply ${label}: expected source block was not found`);
  }
  return source.replace(search, replacement);
}

let renderer = fs.readFileSync(rendererPath, 'utf8');

if (!renderer.includes('const JADEASSIST_ASSET_VERSION')) {
  renderer = replaceOnce(
    renderer,
    "const ANONYMOUS_SANITIZER_COMMENT = '<!-- eventflow-anonymous-sanitizer: active -->';",
    "const ANONYMOUS_SANITIZER_COMMENT = '<!-- eventflow-anonymous-sanitizer: active -->';\nconst JADEASSIST_ASSET_VERSION = '20260723-1';",
    'JadeAssist asset version constant'
  );
}

if (!renderer.includes('function versionJadeAssistAssetUrls')) {
  const marker = `function isAnonymousRequest(req) {\n  return !(req && req.user);\n}`;
  const replacement = `function versionJadeAssistAssetUrls(content) {\n  return content\n    .replace(\n      /\\/assets\\/js\\/vendor\\/jade-widget\\.js(?:\\?[^\"'\\s>]*)?/g,\n      \`/assets/js/vendor/jade-widget.js?v=\${JADEASSIST_ASSET_VERSION}\`\n    )\n    .replace(\n      /\\/assets\\/js\\/jadeassist-init\\.v2\\.js(?:\\?[^\"'\\s>]*)?/g,\n      \`/assets/js/jadeassist-init.v2.js?v=\${JADEASSIST_ASSET_VERSION}\`\n    );\n}\n\n${marker}`;
  renderer = replaceOnce(renderer, marker, replacement, 'JadeAssist URL versioning helper');
}

const oldProcessing = `  const processedContent = injectGlobalAnalyticsScripts(\n    sanitizeAnonymousPublicHtml(replacePlaceholders(content), requestPath, req),\n    requestPath\n  );`;
const newProcessing = `  const processedContent = versionJadeAssistAssetUrls(\n    injectGlobalAnalyticsScripts(\n      sanitizeAnonymousPublicHtml(replacePlaceholders(content), requestPath, req),\n      requestPath\n    )\n  );`;
if (!renderer.includes(newProcessing)) {
  renderer = replaceOnce(renderer, oldProcessing, newProcessing, 'rendered HTML cache busting');
}

if (!renderer.includes('  versionJadeAssistAssetUrls,')) {
  renderer = replaceOnce(
    renderer,
    '  replacePlaceholders,\n',
    '  replacePlaceholders,\n  versionJadeAssistAssetUrls,\n  JADEASSIST_ASSET_VERSION,\n',
    'JadeAssist renderer exports'
  );
}

fs.writeFileSync(rendererPath, renderer);

let renderTests = fs.readFileSync(renderTestPath, 'utf8');
const renderAssertionMarker = `    expect(res.text).toContain('eventflow-anonymous-sanitizer: active');`;
const renderAssertions = `${renderAssertionMarker}\n    expect(res.text).toContain('/assets/js/vendor/jade-widget.js?v=${version}');\n    expect(res.text).toContain('/assets/js/jadeassist-init.v2.js?v=${version}');\n    expect(res.text).not.toContain('src=\"/assets/js/vendor/jade-widget.js\"');\n    expect(res.text).not.toContain('src=\"/assets/js/jadeassist-init.v2.js\"');`;
if (!renderTests.includes(`/assets/js/vendor/jade-widget.js?v=${version}`)) {
  renderTests = replaceOnce(
    renderTests,
    renderAssertionMarker,
    renderAssertions,
    'render-path cache-bust assertions'
  );
}
fs.writeFileSync(renderTestPath, renderTests);

let widgetTests = fs.readFileSync(widgetTestPath, 'utf8');
if (!widgetTests.includes('should cache-bust the deployed widget scripts')) {
  const insertionPoint = `  describe('Approved launcher assets and dismissal behaviour', () => {`;
  const cacheTest = `  describe('Deployed JadeAssist asset freshness', () => {\n    it('should cache-bust the deployed widget scripts through the template renderer', () => {\n      const renderer = fs.readFileSync(\n        path.join(process.cwd(), 'utils/template-renderer.js'),\n        'utf8'\n      );\n      expect(renderer).toContain(\"const JADEASSIST_ASSET_VERSION = '${version}'\");\n      expect(renderer).toContain('versionJadeAssistAssetUrls');\n      expect(renderer).toContain('jade-widget.js?v=\\${JADEASSIST_ASSET_VERSION}');\n      expect(renderer).toContain('jadeassist-init.v2.js?v=\\${JADEASSIST_ASSET_VERSION}');\n    });\n  });\n\n`;
  widgetTests = replaceOnce(
    widgetTests,
    insertionPoint,
    cacheTest + insertionPoint,
    'JadeAssist cache-bust integration test'
  );
}
fs.writeFileSync(widgetTestPath, widgetTests);

console.log(`Applied JadeAssist script cache bust version ${version}.`);
