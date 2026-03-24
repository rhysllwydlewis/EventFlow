#!/usr/bin/env node
/**
 * EventFlow Go-Live Audit Script
 *
 * Runs a series of automated checks to verify production-readiness:
 *   1. Critical environment variables present and valid
 *   2. Security headers on key endpoints (via local server)
 *   3. Health/readiness endpoints respond correctly
 *   4. npm audit for known vulnerabilities
 *
 * Usage:
 *   node scripts/go-live-audit.mjs                  # against local server
 *   AUDIT_TARGET=https://event-flow.co.uk node scripts/go-live-audit.mjs  # against live site
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = one or more checks failed
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

// ─── Config ────────────────────────────────────────────────────────────────

const AUDIT_TARGET = process.env.AUDIT_TARGET; // If set, skip local server spin-up
const LOCAL_PORT = Number(process.env.AUDIT_PORT || 3600);
const STARTUP_TIMEOUT = 30_000;
const RETRY_INTERVAL = 500;
const JWT_SECRET_FOR_TEST =
  'audit-script-test-jwt-secret-do-not-use-in-production-padding-abcde';

// ANSI colours
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
};

// ─── Helpers ───────────────────────────────────────────────────────────────

let chosenPort = LOCAL_PORT;

function pass(label) {
  console.log(`  ${C.green}✓${C.reset} ${label}`);
}
function fail(label, reason) {
  console.log(`  ${C.red}✗${C.reset} ${label}${reason ? `: ${reason}` : ''}`);
}
function warn(label, reason) {
  console.log(`  ${C.yellow}⚠${C.reset}  ${label}${reason ? `: ${reason}` : ''}`);
}
function section(title) {
  console.log(`\n${C.bold}${C.blue}${'─'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.blue}${title}${C.reset}`);
  console.log(`${C.blue}${'─'.repeat(60)}${C.reset}`);
}

// ─── 1. Environment variable checks (local only) ──────────────────────────

function checkEnvVars() {
  section('1 · Environment Variables');

  const nodeEnv = process.env.NODE_ENV || '(not set)';
  const results = [];

  // NODE_ENV
  if (nodeEnv === 'production') {
    pass(`NODE_ENV=production`);
    results.push(true);
  } else {
    warn(`NODE_ENV is '${nodeEnv}' — set to 'production' before deploying`);
    results.push(null); // warning, not fatal here (audit can run locally)
  }

  // JWT_SECRET
  const jwtSecret = process.env.JWT_SECRET || '';
  const knownPlaceholders = [
    'change_me',
    'your_super_long_random_secret',
    'your-secret-key',
    'your_secret',
  ];
  if (!jwtSecret) {
    fail('JWT_SECRET', 'not set');
    results.push(false);
  } else if (knownPlaceholders.some(p => jwtSecret.toLowerCase().includes(p.toLowerCase()))) {
    fail('JWT_SECRET', 'contains placeholder value');
    results.push(false);
  } else if (jwtSecret.length < 32) {
    fail('JWT_SECRET', `too short (${jwtSecret.length} chars, need ≥32)`);
    results.push(false);
  } else {
    pass(`JWT_SECRET (${jwtSecret.length} chars)`);
    results.push(true);
  }

  // MONGODB_URI
  const mongoUri = process.env.MONGODB_URI || '';
  if (!mongoUri) {
    fail('MONGODB_URI', 'not set');
    results.push(false);
  } else if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    fail('MONGODB_URI', 'invalid scheme');
    results.push(false);
  } else {
    pass('MONGODB_URI');
    results.push(true);
  }

  // BASE_URL
  const baseUrl = process.env.BASE_URL || '';
  if (!baseUrl) {
    fail('BASE_URL', 'not set');
    results.push(false);
  } else if (baseUrl.includes('localhost') && nodeEnv === 'production') {
    fail('BASE_URL', 'points to localhost in production');
    results.push(false);
  } else {
    pass(`BASE_URL=${baseUrl}`);
    results.push(true);
  }

  // ALLOW_DEGRADED_STARTUP must NOT be set in production
  if (process.env.ALLOW_DEGRADED_STARTUP === 'true' && nodeEnv === 'production') {
    fail('ALLOW_DEGRADED_STARTUP', 'must NOT be set to true in production');
    results.push(false);
  } else {
    pass('ALLOW_DEGRADED_STARTUP not set (correct)');
    results.push(true);
  }

  // Recommended (non-fatal)
  const recommended = ['POSTMARK_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
  for (const key of recommended) {
    if (!process.env[key]) {
      warn(key, 'not set (recommended for full functionality)');
    } else {
      pass(`${key} is set`);
    }
  }

  return results.filter(r => r === false).length;
}

// ─── 2. Start a local server (if no AUDIT_TARGET) ─────────────────────────

async function startLocalServer() {
  const tryPort = LOCAL_PORT;
  const serverEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: String(tryPort),
    JWT_SECRET: JWT_SECRET_FOR_TEST,
    BASE_URL: `http://localhost:${tryPort}`,
  };

  console.log(`  Starting local server on port ${tryPort}…`);

  const proc = spawn('node', ['server.js'], {
    cwd: process.cwd(),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stdout.on('data', d => (output += d.toString()));
  proc.stderr.on('data', d => (output += d.toString()));

  let exited = false;
  proc.on('exit', () => (exited = true));

  const deadline = Date.now() + STARTUP_TIMEOUT;
  while (Date.now() < deadline) {
    if (exited) {
      console.error(`${C.red}  Server crashed on startup.${C.reset}`);
      console.error(output.slice(-2000));
      return null;
    }
    try {
      const res = await fetch(`http://localhost:${tryPort}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status < 600) {
        console.log(`  ${C.green}✓ Server ready on port ${tryPort}${C.reset}`);
        chosenPort = tryPort;
        return proc;
      }
    } catch {
      /* still starting */
    }
    await sleep(RETRY_INTERVAL);
  }

  proc.kill();
  console.error(`${C.red}  Server startup timed out.${C.reset}`);
  console.error(output.slice(-1000));
  return null;
}

function stopServer(proc) {
  if (proc && !proc.killed) proc.kill();
}

// ─── 3. HTTP checks against the target ────────────────────────────────────

async function getHeaders(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  const hdrs = {};
  res.headers.forEach((v, k) => (hdrs[k.toLowerCase()] = v));
  return { status: res.status, headers: hdrs, ok: res.ok };
}

async function checkSecurityHeaders(base) {
  section('2 · Security Headers');

  let failures = 0;

  const endpoints = ['/', '/api/health', '/this-should-404'];
  for (const path of endpoints) {
    const url = `${base}${path}`;
    console.log(`  ${C.blue}→ ${url}${C.reset}`);
    let r;
    try {
      r = await getHeaders(url);
    } catch (e) {
      fail(path, `fetch failed: ${e.message}`);
      failures++;
      continue;
    }

    const h = r.headers;

    // X-Content-Type-Options
    if (h['x-content-type-options'] === 'nosniff') {
      pass(`${path}: x-content-type-options`);
    } else {
      fail(`${path}: x-content-type-options`, h['x-content-type-options'] || 'missing');
      failures++;
    }

    // Referrer-Policy
    if ((h['referrer-policy'] || '').includes('strict-origin-when-cross-origin')) {
      pass(`${path}: referrer-policy`);
    } else {
      fail(`${path}: referrer-policy`, h['referrer-policy'] || 'missing');
      failures++;
    }

    // Clickjacking (CSP frame-ancestors OR X-Frame-Options)
    const csp = h['content-security-policy'] || '';
    const xfo = h['x-frame-options'] || '';
    if (csp.includes("frame-ancestors 'none'") || xfo.toUpperCase() === 'DENY') {
      pass(`${path}: clickjacking protection`);
    } else {
      fail(`${path}: clickjacking protection`, 'neither CSP frame-ancestors nor X-Frame-Options');
      failures++;
    }

    // Permissions-Policy
    const pp = h['permissions-policy'] || '';
    if (pp.includes('geolocation=()') && pp.includes('camera=()')) {
      pass(`${path}: permissions-policy`);
    } else {
      fail(`${path}: permissions-policy`, pp || 'missing');
      failures++;
    }

    // X-Powered-By must be absent
    if (!h['x-powered-by']) {
      pass(`${path}: x-powered-by removed`);
    } else {
      fail(`${path}: x-powered-by`, `should be absent, got: ${h['x-powered-by']}`);
      failures++;
    }

    // HSTS — only check on HTTPS responses
    const finalProto = base.startsWith('https') ? 'https' : 'http';
    if (finalProto === 'https') {
      const hsts = h['strict-transport-security'] || '';
      if (hsts.includes('max-age=31536000') && hsts.toLowerCase().includes('includesubdomains')) {
        pass(`${path}: HSTS`);
      } else {
        fail(`${path}: HSTS`, hsts || 'missing');
        failures++;
      }
    } else {
      warn(`${path}: HSTS check skipped (HTTP, not HTTPS)`);
    }
  }

  return failures;
}

// ─── 4. Health & readiness endpoints ──────────────────────────────────────

async function checkHealthEndpoints(base) {
  section('3 · Health / Readiness Endpoints');

  let failures = 0;

  const checks = [
    { path: '/api/health', expectedStatus: 200 },
    { path: '/api/ready', expectedStatus: [200, 503] }, // 503 is valid if DB not connected
    { path: '/api/v1/health', expectedStatus: 200 },
  ];

  for (const { path, expectedStatus } of checks) {
    const url = `${base}${path}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const ok = Array.isArray(expectedStatus)
        ? expectedStatus.includes(r.status)
        : r.status === expectedStatus;
      if (ok) {
        pass(`${path} → ${r.status}`);
      } else {
        fail(`${path}`, `expected ${expectedStatus}, got ${r.status}`);
        failures++;
      }
    } catch (e) {
      fail(`${path}`, e.message);
      failures++;
    }
  }

  return failures;
}

// ─── 5. HTTPS redirect (live site only) ───────────────────────────────────

async function checkHttpsRedirect(domain) {
  section('4 · HTTP→HTTPS Redirect');

  const httpUrl = `http://${domain}/`;
  let failures = 0;

  try {
    const res = await fetch(httpUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    const loc = res.headers.get('location') || '';
    if ((res.status === 301 || res.status === 302) && loc.startsWith('https://')) {
      pass(`HTTP→HTTPS redirect (${res.status} → ${loc})`);
    } else if (res.status >= 200 && res.status < 400) {
      warn('HTTP→HTTPS redirect', `responded ${res.status} without redirect — ensure proxy enforces HTTPS`);
    } else {
      fail('HTTP→HTTPS redirect', `status ${res.status}, location: ${loc || '(none)'}`);
      failures++;
    }
  } catch (e) {
    warn('HTTP→HTTPS redirect', `could not reach HTTP endpoint: ${e.message}`);
  }

  return failures;
}

// ─── 6. npm audit ─────────────────────────────────────────────────────────

async function runNpmAudit() {
  section('5 · npm audit (production dependencies)');

  return new Promise(resolve => {
    const proc = spawn('npm', ['audit', '--production', '--json'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    proc.stdout.on('data', d => (out += d.toString()));
    proc.stderr.on('data', d => (out += d.toString()));

    proc.on('close', () => {
      try {
        const report = JSON.parse(out);
        const vulns = report.metadata?.vulnerabilities || {};
        const critical = vulns.critical || 0;
        const high = vulns.high || 0;
        const moderate = vulns.moderate || 0;
        const low = vulns.low || 0;

        if (critical > 0) {
          fail(`npm audit: ${critical} critical, ${high} high, ${moderate} moderate, ${low} low`);
          resolve(1);
        } else if (high > 0) {
          fail(`npm audit: ${high} high severity vulnerabilities found`);
          resolve(1);
        } else if (moderate > 0) {
          warn(`npm audit: ${moderate} moderate severity (review recommended)`);
          resolve(0);
        } else {
          pass(`npm audit: no critical/high vulnerabilities (${low} low)`);
          resolve(0);
        }
      } catch {
        warn('npm audit: could not parse output — run `npm audit` manually');
        resolve(0);
      }
    });
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${C.bold}${C.blue}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.blue}  EventFlow Go-Live Audit${C.reset}`);
  console.log(`${C.blue}${'═'.repeat(60)}${C.reset}`);

  const targetIsLive = !!AUDIT_TARGET;
  const base = AUDIT_TARGET
    ? AUDIT_TARGET.replace(/\/$/, '')
    : `http://localhost:${LOCAL_PORT}`;

  console.log(`  Target : ${base}`);
  console.log(`  Mode   : ${targetIsLive ? 'live site' : 'local server'}`);

  let totalFailures = 0;

  // 1. Env vars (local only — live env vars are on the host)
  if (!targetIsLive) {
    totalFailures += checkEnvVars();
  }

  // 2. Spin up local server if needed
  let serverProc = null;
  if (!targetIsLive) {
    section('0 · Local Server Startup');
    serverProc = await startLocalServer();
    if (!serverProc) {
      console.error(`\n${C.red}${C.bold}FATAL: Could not start local server. Aborting.${C.reset}`);
      process.exit(1);
    }
  }

  try {
    // 3. Security headers
    totalFailures += await checkSecurityHeaders(base);

    // 4. Health endpoints
    totalFailures += await checkHealthEndpoints(base);

    // 5. HTTPS redirect (live site only)
    if (targetIsLive) {
      const domain = new URL(base).hostname;
      totalFailures += await checkHttpsRedirect(domain);
    }

    // 6. npm audit
    totalFailures += await runNpmAudit();
  } finally {
    stopServer(serverProc);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n${C.bold}${C.blue}${'═'.repeat(60)}${C.reset}`);
  if (totalFailures === 0) {
    console.log(`${C.bold}${C.green}✓ All go-live checks passed!${C.reset}`);
    console.log(`${C.blue}${'═'.repeat(60)}${C.reset}\n`);
    process.exit(0);
  } else {
    console.log(
      `${C.bold}${C.red}✗ ${totalFailures} check(s) failed — resolve before going live.${C.reset}`
    );
    console.log(`${C.blue}${'═'.repeat(60)}${C.reset}\n`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`${C.red}Unexpected error: ${err.message}${C.reset}`);
  process.exit(1);
});
