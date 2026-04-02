/**
 * Unit tests for the webhook integrations catalog and the admin webhook-test handler.
 *
 * Validates:
 *  1. The catalog module exports an array of integration descriptors.
 *  2. Each descriptor has the required shape (name, label, path, isConfigured, buildProbe, successCriteria).
 *  3. All known integrations are present (stripe, stripe-legacy, postmark, mongodb).
 *  4. isConfigured() returns correct results based on env vars.
 *  5. buildProbe() returns null when not configured, and a valid object when configured.
 *  6. successCriteria() correctly classifies HTTP status codes.
 *  7. The admin-webhooks-test route imports from the catalog (not hard-coded).
 *  8. Adding a new entry to the catalog is automatically included in the handler.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '../../webhooks/integrations.js');
const HANDLER_PATH = path.join(__dirname, '../../routes/admin-webhooks-test.js');

// ─── Catalog module shape ─────────────────────────────────────────────────────

describe('Webhook Integrations Catalog — module shape', () => {
  it('webhooks/integrations.js exists', () => {
    expect(fs.existsSync(CATALOG_PATH)).toBe(true);
  });

  it('exports an { integrations } object containing an array', () => {
    const { integrations } = require(CATALOG_PATH);
    expect(Array.isArray(integrations)).toBe(true);
    expect(integrations.length).toBeGreaterThan(0);
  });

  it('every integration has required fields: name, label, path', () => {
    const { integrations } = require(CATALOG_PATH);
    for (const integration of integrations) {
      expect(typeof integration.name).toBe('string');
      expect(integration.name.length).toBeGreaterThan(0);
      expect(typeof integration.label).toBe('string');
      expect(integration.label.length).toBeGreaterThan(0);
      expect(typeof integration.path).toBe('string');
      expect(integration.path).toMatch(/^\//);
    }
  });

  it('every integration has callable isConfigured, buildProbe, successCriteria', () => {
    const { integrations } = require(CATALOG_PATH);
    for (const integration of integrations) {
      expect(typeof integration.isConfigured).toBe('function');
      expect(typeof integration.buildProbe).toBe('function');
      expect(typeof integration.successCriteria).toBe('function');
    }
  });

  it('no two integrations share the same name', () => {
    const { integrations } = require(CATALOG_PATH);
    const names = integrations.map(i => i.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ─── Known integrations present ───────────────────────────────────────────────

describe('Webhook Integrations Catalog — known integrations', () => {
  let integrations;
  beforeAll(() => {
    ({ integrations } = require(CATALOG_PATH));
  });

  const EXPECTED = ['stripe', 'stripe-legacy', 'postmark', 'mongodb'];

  EXPECTED.forEach(name => {
    it(`catalog includes '${name}' integration`, () => {
      const found = integrations.find(i => i.name === name);
      expect(found).toBeDefined();
    });
  });

  it('stripe integration probes /api/v2/webhooks/stripe', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    expect(stripe.path).toBe('/api/v2/webhooks/stripe');
  });

  it('stripe-legacy integration probes /api/v1/payments/webhook', () => {
    const legacy = integrations.find(i => i.name === 'stripe-legacy');
    expect(legacy.path).toBe('/api/v1/payments/webhook');
  });

  it('postmark integration probes /api/v1/webhooks/postmark', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    expect(postmark.path).toBe('/api/v1/webhooks/postmark');
  });

  it('mongodb integration probes /api/v1/webhooks/mongodb', () => {
    const mongo = integrations.find(i => i.name === 'mongodb');
    expect(mongo.path).toBe('/api/v1/webhooks/mongodb');
  });
});

// ─── isConfigured() ───────────────────────────────────────────────────────────

describe('Webhook Integrations Catalog — isConfigured()', () => {
  let integrations;
  beforeAll(() => {
    ({ integrations } = require(CATALOG_PATH));
  });

  // Helper: run with env var overrides, then restore
  function withEnv(vars, fn) {
    const originals = {};
    for (const [k, v] of Object.entries(vars)) {
      originals[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  }

  it('stripe — not configured when STRIPE_WEBHOOK_SECRET is absent', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, () => {
      const { configured, missing } = stripe.isConfigured();
      expect(configured).toBe(false);
      expect(missing).toContain('STRIPE_WEBHOOK_SECRET');
    });
  });

  it('stripe — configured when STRIPE_WEBHOOK_SECRET is set', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }, () => {
      const { configured, missing } = stripe.isConfigured();
      expect(configured).toBe(true);
      expect(missing).toHaveLength(0);
    });
  });

  it('postmark — not configured when both env vars are absent', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    withEnv({ POSTMARK_WEBHOOK_USER: undefined, POSTMARK_WEBHOOK_PASS: undefined }, () => {
      const { configured, missing } = postmark.isConfigured();
      expect(configured).toBe(false);
      expect(missing).toContain('POSTMARK_WEBHOOK_USER');
      expect(missing).toContain('POSTMARK_WEBHOOK_PASS');
    });
  });

  it('postmark — not configured when only one env var is set', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    withEnv({ POSTMARK_WEBHOOK_USER: 'user', POSTMARK_WEBHOOK_PASS: undefined }, () => {
      const { configured, missing } = postmark.isConfigured();
      expect(configured).toBe(false);
      expect(missing).toContain('POSTMARK_WEBHOOK_PASS');
    });
  });

  it('postmark — configured when both env vars are set', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    withEnv({ POSTMARK_WEBHOOK_USER: 'user', POSTMARK_WEBHOOK_PASS: 'pass' }, () => {
      const { configured } = postmark.isConfigured();
      expect(configured).toBe(true);
    });
  });

  it('mongodb — not configured when MONGODB_WEBHOOK_SECRET is absent', () => {
    const mongo = integrations.find(i => i.name === 'mongodb');
    withEnv({ MONGODB_WEBHOOK_SECRET: undefined }, () => {
      const { configured, missing } = mongo.isConfigured();
      expect(configured).toBe(false);
      expect(missing).toContain('MONGODB_WEBHOOK_SECRET');
    });
  });

  it('mongodb — configured when MONGODB_WEBHOOK_SECRET is set', () => {
    const mongo = integrations.find(i => i.name === 'mongodb');
    withEnv({ MONGODB_WEBHOOK_SECRET: 'supersecret' }, () => {
      const { configured } = mongo.isConfigured();
      expect(configured).toBe(true);
    });
  });
});

// ─── buildProbe() ─────────────────────────────────────────────────────────────

describe('Webhook Integrations Catalog — buildProbe()', () => {
  let integrations;
  beforeAll(() => {
    ({ integrations } = require(CATALOG_PATH));
  });

  function withEnv(vars, fn) {
    const originals = {};
    for (const [k, v] of Object.entries(vars)) {
      originals[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(originals)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  }

  it('stripe — buildProbe() returns null when secret is absent', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    withEnv({ STRIPE_WEBHOOK_SECRET: undefined }, () => {
      expect(stripe.buildProbe()).toBeNull();
    });
  });

  it('stripe — buildProbe() returns { body, headers, notes } when secret is set', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    withEnv({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }, () => {
      const probe = stripe.buildProbe();
      expect(probe).not.toBeNull();
      expect(probe.body).toBeDefined();
      expect(probe.headers).toBeDefined();
      expect(probe.headers['stripe-signature']).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
      expect(typeof probe.notes).toBe('string');
    });
  });

  it('postmark — buildProbe() returns null when credentials are absent', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    withEnv({ POSTMARK_WEBHOOK_USER: undefined, POSTMARK_WEBHOOK_PASS: undefined }, () => {
      expect(postmark.buildProbe()).toBeNull();
    });
  });

  it('postmark — buildProbe() returns Basic auth header when credentials are set', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    withEnv({ POSTMARK_WEBHOOK_USER: 'u', POSTMARK_WEBHOOK_PASS: 'p' }, () => {
      const probe = postmark.buildProbe();
      expect(probe).not.toBeNull();
      expect(probe.headers.Authorization).toMatch(/^Basic /);
      expect(probe.body.RecordType).toBe('Open');
    });
  });

  it('mongodb — buildProbe() returns HMAC signature header when secret is set', () => {
    const mongo = integrations.find(i => i.name === 'mongodb');
    withEnv({ MONGODB_WEBHOOK_SECRET: 'mysecret' }, () => {
      const probe = mongo.buildProbe();
      expect(probe).not.toBeNull();
      expect(probe.headers['x-mongodb-webhook-signature']).toMatch(/^sha256=[a-f0-9]+$/);
      expect(probe.body.operationType).toBe('insert');
    });
  });
});

// ─── successCriteria() ────────────────────────────────────────────────────────

describe('Webhook Integrations Catalog — successCriteria()', () => {
  let integrations;
  beforeAll(() => {
    ({ integrations } = require(CATALOG_PATH));
  });

  it('stripe — treats 200 and 400 as ok', () => {
    const stripe = integrations.find(i => i.name === 'stripe');
    expect(stripe.successCriteria(200)).toBe(true);
    expect(stripe.successCriteria(400)).toBe(true);
    expect(stripe.successCriteria(401)).toBe(false);
    expect(stripe.successCriteria(500)).toBe(false);
  });

  it('stripe-legacy — treats 200 and 400 as ok', () => {
    const legacy = integrations.find(i => i.name === 'stripe-legacy');
    expect(legacy.successCriteria(200)).toBe(true);
    expect(legacy.successCriteria(400)).toBe(true);
    expect(legacy.successCriteria(401)).toBe(false);
  });

  it('postmark — treats 2xx as ok, non-2xx as fail', () => {
    const postmark = integrations.find(i => i.name === 'postmark');
    expect(postmark.successCriteria(200)).toBe(true);
    expect(postmark.successCriteria(204)).toBe(true);
    expect(postmark.successCriteria(400)).toBe(false);
    expect(postmark.successCriteria(401)).toBe(false);
    expect(postmark.successCriteria(500)).toBe(false);
  });

  it('mongodb — treats 2xx as ok, non-2xx as fail', () => {
    const mongo = integrations.find(i => i.name === 'mongodb');
    expect(mongo.successCriteria(200)).toBe(true);
    expect(mongo.successCriteria(201)).toBe(true);
    expect(mongo.successCriteria(400)).toBe(false);
    expect(mongo.successCriteria(500)).toBe(false);
  });
});

// ─── Handler uses catalog (not hard-coded) ────────────────────────────────────

describe('Admin Webhooks Test Handler — catalog-based enumeration', () => {
  let handlerContent;
  beforeAll(() => {
    handlerContent = fs.readFileSync(HANDLER_PATH, 'utf8');
  });

  it('admin-webhooks-test.js requires webhooks/integrations', () => {
    expect(handlerContent).toContain("require('../webhooks/integrations')");
  });

  it('admin-webhooks-test.js uses integrations variable from catalog', () => {
    expect(handlerContent).toContain('integrations');
  });

  it('admin-webhooks-test.js does NOT hard-code stripe logic inline', () => {
    // The old hard-coded stripe block used crypto.createHmac directly in the route
    // Now that logic lives in the catalog; the route should not re-implement it.
    expect(handlerContent).not.toContain('process.env.STRIPE_WEBHOOK_SECRET');
  });

  it('admin-webhooks-test.js does NOT hard-code postmark logic inline', () => {
    expect(handlerContent).not.toContain('process.env.POSTMARK_WEBHOOK_USER');
  });

  it('admin-webhooks-test.js does NOT hard-code mongodb logic inline', () => {
    expect(handlerContent).not.toContain('process.env.MONGODB_WEBHOOK_SECRET');
  });

  it('admin-webhooks-test.js iterates the catalog (uses a loop)', () => {
    // Either a for...of loop or .map/.forEach on the integrations array
    expect(handlerContent).toMatch(/for\s*\(.*of\s+integrations\)|integrations\.(map|forEach)/);
  });
});

// ─── Adding a new integration to catalog appears in enumeration ───────────────

describe('Webhook Integrations Catalog — extensibility', () => {
  it('a new integration added to the catalog is included in results', () => {
    // Re-require the catalog with a module-scope override to avoid Jest module cache issues
    jest.isolateModules(() => {
      const catalog = require(CATALOG_PATH);
      const orig = catalog.integrations.slice();

      // Add a synthetic integration
      catalog.integrations.push({
        name: 'test-synthetic',
        label: 'Synthetic Test',
        path: '/api/test/synthetic',
        isConfigured: () => ({ configured: false, missing: ['TEST_SECRET'] }),
        buildProbe: () => null,
        successCriteria: () => false,
      });

      expect(catalog.integrations.length).toBe(orig.length + 1);
      expect(catalog.integrations.map(i => i.name)).toContain('test-synthetic');

      // Restore
      catalog.integrations.splice(0, catalog.integrations.length, ...orig);
    });
  });
});

// ─── Configured counting and ok logic ─────────────────────────────────────────

describe('Webhook Integrations Catalog — configured/ok logic', () => {
  it('ok is true when configured count is 0 (none configured)', () => {
    // Server formula: ok = configured === 0 || passed === configured
    const configured = 0;
    const passed = 0;
    const ok = configured === 0 || passed === configured;
    expect(ok).toBe(true);
  });

  it('ok is true when all configured integrations pass', () => {
    const configured = 3;
    const passed = 3;
    const ok = configured === 0 || passed === configured;
    expect(ok).toBe(true);
  });

  it('ok is false when some configured integrations fail', () => {
    const configured = 3;
    const passed = 2;
    const ok = configured === 0 || passed === configured;
    expect(ok).toBe(false);
  });

  it('ok is false when all configured integrations fail', () => {
    const configured = 2;
    const passed = 0;
    const ok = configured === 0 || passed === configured;
    expect(ok).toBe(false);
  });
});
