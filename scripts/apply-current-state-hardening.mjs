#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, content) {
  fs.writeFileSync(path.join(root, relativePath), content, 'utf8');
}

function replaceRequired(source, pattern, replacement, description) {
  if (!pattern.test(source)) {
    throw new Error(`Unable to locate ${description}`);
  }
  pattern.lastIndex = 0;
  return source.replace(pattern, replacement);
}

function patchCanonicalRedirect() {
  const file = 'middleware/security.js';
  let source = read(file);

  if (source.includes('function resolveCanonicalProductionOrigin()')) return;

  const pattern = /function configureHTTPSRedirect\(isProduction = false\) \{[\s\S]*?\n\}\n\nmodule\.exports =/;
  const replacement = `function resolveCanonicalProductionOrigin() {
  const configured =
    process.env.CANONICAL_BASE_URL || process.env.BASE_URL || 'https://event-flow.co.uk';

  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

/**
 * Configure HTTPS and canonical-host redirects for production.
 * Only known public hosts may be redirected; unknown Host values are never reflected.
 *
 * @param {boolean} isProduction - Whether running in production
 * @returns {Function} Express middleware
 */
function configureHTTPSRedirect(isProduction = false) {
  return (req, res, next) => {
    if (!isProduction) return next();

    // Railway probes these endpoints directly; do not redirect health traffic.
    if (req.path === '/api/health' || req.path === '/api/ready') return next();

    const canonicalOrigin = resolveCanonicalProductionOrigin();
    const canonicalHost = canonicalOrigin ? new URL(canonicalOrigin).host.toLowerCase() : '';
    const requestHost = String(req.headers.host || '').toLowerCase();
    const requestUrl = req.originalUrl || req.url || '/';
    const productionHosts = new Set(
      PRODUCTION_APP_ORIGINS.map(origin => new URL(origin).host.toLowerCase())
    );
    const isKnownPublicHost = productionHosts.has(requestHost);
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';

    if (!isSecure) {
      if (!canonicalOrigin || !isKnownPublicHost) return next();
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(308, canonicalOrigin + requestUrl);
    }

    if (canonicalOrigin && isKnownPublicHost && requestHost !== canonicalHost) {
      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(308, canonicalOrigin + requestUrl);
    }

    return next();
  };
}

module.exports =`;

  source = replaceRequired(source, pattern, replacement, 'production redirect middleware');
  write(file, source);
}

function patchPublicClaims() {
  const files = [
    'public/assets/js/app.js',
    'public/index.html',
    'public/marketplace.html',
    'tests/helpers/homepage-stabilisation-scenario.js',
  ];

  for (const file of files) {
    let source = read(file);
    source = source.replaceAll(
      'Join over 500+ verified suppliers already on EventFlow',
      'Early supplier access is open now'
    );
    source = source.replaceAll(
      "We're currently building the marketplace platform. Sign up for a free account to be notified when listings go live.",
      'Marketplace listings are opening in stages. Create a free account to list an item, save favourites or message sellers.'
    );

    if (file.endsWith('app.js') && source.includes('Marketplace listings are opening in stages.')) {
      source = source.replace(/(<h2[^>]*>\s*)Coming Soon(\s*<\/h2>)/, '$1Marketplace early access$2');
    }

    write(file, source);
  }
}

patchCanonicalRedirect();
patchPublicClaims();
console.log('Applied canonical-host and public-content hardening.');
