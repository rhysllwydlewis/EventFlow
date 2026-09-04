/**
 * Security Headers Verification Script
 *
 * Verifies that all required security headers are properly configured
 * in both development and production modes without requiring Playwright.
 *
 * This script:
 * - Starts the Express server as a child process
 * - Tests headers on multiple endpoints (/, /api/config, 404)
 * - Validates HSTS behavior (absent in dev, present in prod)
 * - Verifies clickjacking protection (CSP frame-ancestors or X-Frame-Options)
 * - Ensures X-Powered-By is removed
 */

import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

// Configuration
const BASE_PORT = Number(process.env.TEST_PORT || 3500);
const MAX_PORT_TRIES = 10;
const STARTUP_TIMEOUT = 30000; // 30 seconds
const RETRY_INTERVAL = 500; // 500ms between retries
const JWT_SECRET = 'test-jwt-secret-for-header-verification-only-min-32-chars';

// Global variable to store the chosen port
let currentPort = BASE_PORT;

// ANSI color codes for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

/**
 * Start the Express server as a child process
 * Tries multiple ports if the preferred port is in use
 */
async function startServer(env = 'development') {
  // Try multiple ports until we find one that works
  for (let portOffset = 0; portOffset < MAX_PORT_TRIES; portOffset++) {
    const tryPort = BASE_PORT + portOffset;

    const serverEnv = {
      ...process.env,
      NODE_ENV: env,
      PORT: tryPort.toString(),
      JWT_SECRET,
      // Only set BASE_URL if not already defined, to avoid redirect loops
      ...(!process.env.BASE_URL && { BASE_URL: `http://localhost:${tryPort}` }),
    };

    console.log(
      `${colors.blue}Starting server in ${env} mode on port ${tryPort}...${colors.reset}`
    );

    // Production app startup intentionally requires live infrastructure. Use a
    // minimal server for that mode so this package script verifies the real
    // security middleware without weakening production configuration guards.
    const serverScript =
      env === 'production' ? 'scripts/security-header-test-server.js' : 'server.js';
    const serverProcess = spawn(process.execPath, [serverScript], {
      cwd: process.cwd(),
      env: { ...serverEnv, SECURITY_HEADERS_MODE: env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capture server output for debugging if needed
    let serverOutput = '';
    serverProcess.stdout.on('data', data => {
      serverOutput += data.toString();
    });
    serverProcess.stderr.on('data', data => {
      serverOutput += data.toString();
    });

    // Wait for server to be ready
    const startTime = Date.now();
    let serverReady = false;
    let serverExited = false;
    let serverExitCode = null;

    // Track if server exits early
    serverProcess.on('exit', code => {
      serverExited = true;
      serverExitCode = code;
    });

    while (Date.now() - startTime < STARTUP_TIMEOUT) {
      // Check if process exited early
      if (serverExited) {
        // Check if it's EADDRINUSE (port in use)
        const isPortInUse =
          serverOutput.includes('EADDRINUSE') ||
          serverOutput.includes('address already in use') ||
          serverOutput.includes('port is already allocated');

        if (isPortInUse) {
          console.log(
            `${colors.yellow}Port ${tryPort} unavailable, trying next port...${colors.reset}`
          );
          break; // Try next port
        } else {
          // Real error - fail fast with captured output
          console.error(
            `${colors.red}✗ Server crashed on startup (exit code: ${serverExitCode})${colors.reset}`
          );
          console.error(`${colors.red}Server output:${colors.reset}`);
          console.error(serverOutput || '(no output captured)');
          throw new Error(
            `Server failed to start. Exit code: ${serverExitCode}. Check output above for details.`
          );
        }
      }

      try {
        // Try /api/config first (more stable than /api/health)
        let response;
        try {
          response = await fetch(`http://localhost:${tryPort}/api/config`, {
            signal: AbortSignal.timeout(2000),
          });
        } catch (err) {
          // If /api/config fails, try root
          response = await fetch(`http://localhost:${tryPort}/`, {
            signal: AbortSignal.timeout(2000),
          });
        }

        if (response.ok || response.status === 404) {
          // Server is responding
          console.log(
            `${colors.green}✓ Server started successfully on port ${tryPort}${colors.reset}`
          );
          currentPort = tryPort;
          serverReady = true;
          return { process: serverProcess, output: serverOutput, port: tryPort };
        }
      } catch (err) {
        // Server not ready yet, continue waiting
      }
      await sleep(RETRY_INTERVAL);
    }

    // If we got here, either timeout or process exited (due to port in use)
    if (!serverReady) {
      if (!serverExited) {
        serverProcess.kill();
      }

      // If this was the last port to try, throw error
      if (portOffset === MAX_PORT_TRIES - 1) {
        console.error(
          `${colors.red}✗ Server failed to start on any port (${BASE_PORT}-${BASE_PORT + MAX_PORT_TRIES - 1})${colors.reset}`
        );
        console.error('Server output:', serverOutput);
        throw new Error('Server startup failed on all attempted ports');
      }
      // Otherwise, continue to next port (loop continues)
    }
  }

  throw new Error('Unexpected: loop exited without starting server or throwing error');
}

/**
 * Stop the server process
 */
function stopServer(serverProcess) {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    console.log(`${colors.blue}Server stopped${colors.reset}`);
  }
}

/**
 * Fetch headers from an endpoint
 */
async function fetchHeaders(path) {
  const url = `http://localhost:${currentPort}${path}`;
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow', // Follow redirects to get final headers
      signal: AbortSignal.timeout(5000),
    });

    // Convert headers to object for easier access
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    // Determine if the final response is HTTPS
    const finalUrl = new URL(response.url);
    const isHttps = finalUrl.protocol === 'https:';

    return {
      status: response.status,
      headers,
      ok: response.ok,
      isHttps,
      url: response.url,
    };
  } catch (err) {
    throw new Error(`Failed to fetch ${path}: ${err.message}`);
  }
}

/**
 * Verify a specific header
 */
function verifyHeader(headers, headerName, expectedValue, checkType = 'exact') {
  const actualValue = headers[headerName.toLowerCase()];

  if (checkType === 'absent') {
    if (actualValue !== undefined) {
      throw new Error(`Header '${headerName}' should be absent but found: ${actualValue}`);
    }
    return true;
  }

  if (!actualValue) {
    throw new Error(`Header '${headerName}' is missing`);
  }

  if (checkType === 'exact' && actualValue !== expectedValue) {
    throw new Error(`Header '${headerName}' expected '${expectedValue}' but got '${actualValue}'`);
  }

  if (checkType === 'contains' && !actualValue.includes(expectedValue)) {
    throw new Error(
      `Header '${headerName}' should contain '${expectedValue}' but got '${actualValue}'`
    );
  }

  return true;
}

/**
 * Test security headers on an endpoint
 */
async function testEndpoint(path, mode = 'development') {
  console.log(`\n${colors.blue}Testing ${path}...${colors.reset}`);

  const result = await fetchHeaders(path);
  const { headers } = result;

  const checks = [];

  // Check X-Content-Type-Options
  try {
    verifyHeader(headers, 'x-content-type-options', 'nosniff', 'exact');
    checks.push({ name: 'X-Content-Type-Options', status: 'pass' });
  } catch (err) {
    checks.push({ name: 'X-Content-Type-Options', status: 'fail', error: err.message });
  }

  // Check Referrer-Policy
  try {
    verifyHeader(headers, 'referrer-policy', 'strict-origin-when-cross-origin', 'contains');
    checks.push({ name: 'Referrer-Policy', status: 'pass' });
  } catch (err) {
    checks.push({ name: 'Referrer-Policy', status: 'fail', error: err.message });
  }

  // Check Permissions-Policy
  try {
    const permPolicy = headers['permissions-policy'];
    if (!permPolicy) {
      throw new Error('Permissions-Policy header is missing');
    }
    if (!permPolicy.includes('geolocation=()')) {
      throw new Error('Permissions-Policy should include geolocation=()');
    }
    if (!permPolicy.includes('camera=()')) {
      throw new Error('Permissions-Policy should include camera=()');
    }
    if (!permPolicy.includes('microphone=()')) {
      throw new Error('Permissions-Policy should include microphone=()');
    }
    checks.push({ name: 'Permissions-Policy', status: 'pass' });
  } catch (err) {
    checks.push({ name: 'Permissions-Policy', status: 'fail', error: err.message });
  }

  // Check Clickjacking Protection (CSP frame-ancestors OR X-Frame-Options)
  try {
    const csp = headers['content-security-policy'];
    const xFrameOptions = headers['x-frame-options'];

    const hasCspFrameAncestors = csp && csp.includes("frame-ancestors 'none'");
    const hasXFrameOptions = xFrameOptions && xFrameOptions.toUpperCase() === 'DENY';

    if (!hasCspFrameAncestors && !hasXFrameOptions) {
      throw new Error('Neither CSP frame-ancestors nor X-Frame-Options is set');
    }
    checks.push({ name: 'Clickjacking Protection', status: 'pass' });
  } catch (err) {
    checks.push({ name: 'Clickjacking Protection', status: 'fail', error: err.message });
  }

  // Check X-Powered-By is absent
  try {
    verifyHeader(headers, 'x-powered-by', null, 'absent');
    checks.push({ name: 'X-Powered-By Removal', status: 'pass' });
  } catch (err) {
    checks.push({ name: 'X-Powered-By Removal', status: 'fail', error: err.message });
  }

  // Helmet emits HSTS for production configuration. Browsers enforce it only
  // over HTTPS, but the local middleware contract can still require the header.
  if (mode === 'production') {
    try {
      const hsts = headers['strict-transport-security'];
      if (!hsts) {
        throw new Error('HSTS header missing in production mode');
      }
      if (!hsts.includes('max-age=31536000')) {
        throw new Error('HSTS should include max-age=31536000');
      }
      if (!hsts.toLowerCase().includes('includesubdomains')) {
        throw new Error('HSTS should include includeSubDomains');
      }
      checks.push({ name: 'HSTS (Production)', status: 'pass' });
    } catch (err) {
      checks.push({ name: 'HSTS (Production)', status: 'fail', error: err.message });
    }
  } else {
    // Development mode - HSTS should be absent
    try {
      verifyHeader(headers, 'strict-transport-security', null, 'absent');
      checks.push({ name: 'HSTS (Dev - Absent)', status: 'pass' });
    } catch (err) {
      checks.push({ name: 'HSTS (Dev - Absent)', status: 'fail', error: err.message });
    }
  }

  // Print results
  let allPassed = true;
  checks.forEach(check => {
    if (check.status === 'pass') {
      console.log(`  ${colors.green}✓${colors.reset} ${check.name}`);
    } else {
      console.log(`  ${colors.red}✗${colors.reset} ${check.name}: ${check.error}`);
      allPassed = false;
    }
  });

  return allPassed;
}

/**
 * Test server in a specific mode
 */
async function testMode(mode) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`${colors.yellow}Testing ${mode.toUpperCase()} Mode${colors.reset}`);
  console.log(`${'='.repeat(70)}`);

  let server = null;
  try {
    server = await startServer(mode);

    // Test multiple endpoints
    const endpoints = ['/', '/api/config', '/this-page-should-404'];

    let allPassed = true;
    for (const endpoint of endpoints) {
      const passed = await testEndpoint(endpoint, mode);
      allPassed = allPassed && passed;
    }

    if (allPassed) {
      console.log(`\n${colors.green}✓ All ${mode} mode tests passed${colors.reset}`);
      return true;
    } else {
      console.log(`\n${colors.red}✗ Some ${mode} mode tests failed${colors.reset}`);
      return false;
    }
  } finally {
    if (server) {
      stopServer(server.process);
    }
    // Give server time to shut down
    await sleep(1000);
  }
}

/**
 * Main execution
 */
async function main() {
  // Check Node.js version compatibility
  const nodeMajorVersion = parseInt(process.version.slice(1).split('.')[0], 10);
  if (nodeMajorVersion !== 22) {
    console.error(`${colors.red}✗ Unsupported Node.js version: ${process.version}${colors.reset}`);
    console.error(`${colors.red}  This project requires Node.js 22.x.${colors.reset}`);
    console.error(
      `${colors.red}  Use the version pinned in .node-version for local and CI parity.${colors.reset}`
    );
    console.error(
      `${colors.red}  Install it with your Node version manager, then rerun this check.${colors.reset}`
    );
    process.exit(1);
  }

  console.log(`${'='.repeat(70)}`);
  console.log(`${colors.blue}Security Headers Verification${colors.reset}`);
  console.log(`${'='.repeat(70)}`);

  try {
    // Test development mode
    const devPassed = await testMode('development');

    // Test production mode
    const prodPassed = await testMode('production');

    // Final results
    console.log(`\n${'='.repeat(70)}`);
    if (devPassed && prodPassed) {
      console.log(`${colors.green}✓ All security header tests passed!${colors.reset}`);
      console.log(`${'='.repeat(70)}`);
      process.exit(0);
    } else {
      console.log(`${colors.red}✗ Some security header tests failed${colors.reset}`);
      console.log(`${'='.repeat(70)}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n${colors.red}✗ Fatal error: ${err.message}${colors.reset}`);
    console.error(err.stack);
    process.exit(1);
  }
}

// Run the tests
main();
