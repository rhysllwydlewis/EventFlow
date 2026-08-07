'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

describe('messaging production delivery contract', () => {
  it('runs production preflight before every web server start path', () => {
    expect(read('Dockerfile')).toContain('node scripts/preflight.mjs && exec node');
    expect(read('railway.json')).toContain('node scripts/preflight.mjs && exec node');
  });

  it('uses the repository production-audit policy in Deploy', () => {
    const deploy = read('.github/workflows/deploy.yml');
    expect(deploy).toContain('run: npm run audit');
    expect(deploy).not.toContain('run: npm audit --omit=dev');
  });

  it('requires queue and worker health before readiness succeeds', () => {
    const system = read('routes/system.js');
    const dockerfile = read('Dockerfile');
    expect(read('railway.json')).toContain('"healthcheckPath": "/api/ready"');
    expect(dockerfile).toContain('/api/ready');
    expect(dockerfile).toContain('EVENTFLOW_PROCESS_TYPE');
    expect(system).toContain("missingCritical.push('REDIS_URL')");
    expect(system).toContain('const queueHealth = await getQueueHealth()');
    expect(system).toContain("reason: 'Messaging delivery unavailable'");
  });

  it('starts the worker heartbeat and durable fan-out reconciler', () => {
    const worker = read('scripts/worker.js');
    expect(worker).toContain('await startWorkerHeartbeat()');
    expect(worker).toContain('await startNotificationFanoutReconciler');
    expect(worker).toContain("'POSTMARK_API_KEY'");
    expect(worker).toContain('BASE_URL must use HTTPS');
    expect(worker).toContain('await startHealthServer()');
    expect(read('railway.worker.json')).toContain('"EVENTFLOW_PROCESS_TYPE": "worker"');
    expect(read('railway.worker.json')).toContain('"healthcheckPath": "/api/ready"');
  });

  it('requires the real email provider and isolates shared Redis environments', () => {
    const preflight = read('scripts/preflight.mjs');
    const envExample = read('.env.example');
    expect(preflight).toContain("key: 'POSTMARK_API_KEY'");
    expect(preflight).toContain('EVENTFLOW_QUEUE_NAMESPACE');
    expect(envExample).toContain('EVENTFLOW_QUEUE_NAMESPACE=');
  });
});
