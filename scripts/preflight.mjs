/**
 * Production Preflight Validator
 *
 * Fails hard in `NODE_ENV=production` if:
 *   - Any `REPLACE_ME_…` placeholder remains in environment variables or in
 *     required `config/content-config.js` fallback env vars that would still
 *     resolve to placeholder values at runtime.
 *   - `JWT_SECRET` is missing, is the dev default, or is shorter than 32 chars.
 *   - Required environment variables are missing.
 *
 * In non-production runs this script prints warnings but exits 0 so local
 * development isn't blocked — matching the existing warn-on-start behaviour
 * in server.js.
 *
 * Wire into CI / deploy pipelines BEFORE `node server.js` so a misconfigured
 * deploy fails fast rather than coming up with silent placeholder values.
 *
 *   node scripts/preflight.mjs && node server.js
 *
 * Effort 8.1 / 8.3 — config hygiene.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const PLACEHOLDER_RE = /REPLACE_ME_|change_me|changeme|your[-_ ]?(secret|key|token)|xxxxxx+/i;

// Required env vars — missing any of these in production is a hard fail.
const REQUIRED_IN_PRODUCTION = [
  'JWT_SECRET',
  'MONGODB_URI',
  // BASE_URL is used in email templates, canonical URLs, webhooks
  'BASE_URL',
];

// Secrets that must be at least 32 chars in production.
const MIN_SECRET_LENGTH = 32;
const LENGTH_CHECKED = ['JWT_SECRET', 'SESSION_SECRET', 'CSRF_SECRET'];

// Env vars that are required in production for specific subsystems.  Missing
// these won't be caught by the generic REQUIRED_IN_PRODUCTION list above, but
// still cause hard runtime failures (e.g. `services/queue/index.js` throws on
// startup without REDIS_URL).  Enumerate them here so misconfigured deploys
// fail at preflight rather than at first request.
const REQUIRED_IN_PRODUCTION_SUBSYSTEMS = [
  {
    key: 'REDIS_URL',
    reason:
      'Messenger v4 BullMQ notification/email workers require a real Redis ' +
      '— the in-process queue stub refuses to start in production.',
  },
  {
    key: 'POSTMARK_API_KEY',
    reason:
      'Messenger message email is a production delivery path; workers must ' +
      'not acknowledge the local outbox fallback as external delivery.',
  },
];

// Known bad defaults that must never be used in production.
const FORBIDDEN_SECRETS = new Set([
  'dev-secret-please-change-me',
  'change-me-in-production',
  'change_me',
  'changeme',
  'secret',
  'test',
]);

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

// ---------- Environment variable checks ----------

for (const key of REQUIRED_IN_PRODUCTION) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    (IS_PRODUCTION ? fail : warn)(`Required env var ${key} is missing or empty`);
  }
}

for (const { key, reason } of REQUIRED_IN_PRODUCTION_SUBSYSTEMS) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    (IS_PRODUCTION ? fail : warn)(`Required env var ${key} is missing or empty — ${reason}`);
  }
}

const queueNamespace = String(process.env.EVENTFLOW_QUEUE_NAMESPACE || '').trim();
if (queueNamespace && !/^[a-zA-Z0-9:_-]{1,80}$/.test(queueNamespace)) {
  (IS_PRODUCTION ? fail : warn)(
    'EVENTFLOW_QUEUE_NAMESPACE must be 1-80 letters, digits, colons, underscores, or hyphens'
  );
}

for (const key of LENGTH_CHECKED) {
  const val = process.env[key];
  if (val && val.length < MIN_SECRET_LENGTH) {
    (IS_PRODUCTION ? fail : warn)(
      `${key} must be at least ${MIN_SECRET_LENGTH} characters (got ${val.length})`
    );
  }
}

for (const [key, val] of Object.entries(process.env)) {
  if (typeof val !== 'string') {
    continue;
  }
  // Only scan things that look like config (all-uppercase or mixed-case
  // with underscores). Skip PATH, HOME, LANG, etc. that legitimately
  // contain literal strings which happen to match our regex.
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    continue;
  }
  if (PLACEHOLDER_RE.test(val)) {
    (IS_PRODUCTION ? fail : warn)(`Env var ${key} contains a placeholder value: ${val}`);
  }
  if (FORBIDDEN_SECRETS.has(val.toLowerCase())) {
    (IS_PRODUCTION ? fail : warn)(`Env var ${key} uses a forbidden default value`);
  }
}

// ---------- config/content-config.js fallback-env scan ----------

const contentConfigPath = path.join(REPO_ROOT, 'config', 'content-config.js');
if (fs.existsSync(contentConfigPath)) {
  try {
    const raw = fs.readFileSync(contentConfigPath, 'utf8');

    // Detect env-backed fallback placeholders in patterns like:
    // process.env.COMPANY_NUMBER || 'REPLACE_ME_COMPANY_NUMBER'
    const fallbackRegex =
      /process\.env\.([A-Z0-9_]+)\s*\|\|\s*(?:'(REPLACE_ME_[^']+)'|"(REPLACE_ME_[^"]+)"|`(REPLACE_ME_[^`]+)`)/g;
    const matches = [...raw.matchAll(fallbackRegex)];
    const checkedEnvVars = new Set();

    for (const [
      ,
      envVar,
      singleQuotedPlaceholder,
      doubleQuotedPlaceholder,
      templatePlaceholder,
    ] of matches) {
      if (checkedEnvVars.has(envVar)) {
        continue;
      }
      checkedEnvVars.add(envVar);
      const placeholder = singleQuotedPlaceholder || doubleQuotedPlaceholder || templatePlaceholder;

      const currentValue = process.env[envVar];
      if (!currentValue || currentValue.trim() === '') {
        (IS_PRODUCTION ? fail : warn)(
          `${contentConfigPath} uses ${placeholder} when ${envVar} is unset/empty`
        );
      }
    }
  } catch (err) {
    warn(`Could not read ${contentConfigPath}: ${err.message}`);
  }
}

// ---------- Report ----------

const reset = '\x1b[0m';
const red = '\x1b[31m';
const yellow = '\x1b[33m';
const green = '\x1b[32m';

if (warnings.length > 0) {
  console.warn(`${yellow}⚠  Preflight warnings (non-blocking):${reset}`);
  for (const w of warnings) {
    console.warn(`${yellow}   • ${w}${reset}`);
  }
}

if (errors.length > 0) {
  console.error(`${red}✗  Preflight errors (blocking in NODE_ENV=production):${reset}`);
  for (const e of errors) {
    console.error(`${red}   • ${e}${reset}`);
  }
  if (IS_PRODUCTION) {
    console.error(
      `\n${red}Refusing to start: ${errors.length} preflight error(s) in production mode.${reset}`
    );
    console.error(`${red}Fix the above, or see docs/PRODUCTION_DEPLOYMENT_CHECKLIST.md${reset}`);
    process.exit(1);
  } else {
    console.warn(
      `${yellow}Would fail in production. NODE_ENV=${process.env.NODE_ENV || '(unset)'} — not blocking.${reset}`
    );
  }
}

if (errors.length === 0 && warnings.length === 0) {
  console.log(`${green}✓ Preflight checks passed${reset}`);
}

process.exit(0);
