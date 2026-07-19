const E2E_HEADERS = Object.freeze({ 'x-eventflow-e2e': 'backend-suite' });

export function createRunId(label) {
  const safeLabel = String(label || 'suite')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const nonce = Math.random().toString(36).slice(2, 9);
  return `${safeLabel || 'suite'}-${Date.now().toString(36)}-${nonce}`;
}

async function requireOk(response, action) {
  if (response.ok()) {
    return response;
  }
  const body = await response.text().catch(() => '');
  throw new Error(`${action} failed with HTTP ${response.status()}: ${body.slice(0, 500)}`);
}

export async function seedBackendFixtures(request, runId) {
  const response = await request.post('/__e2e/seed', {
    headers: E2E_HEADERS,
    data: { runId },
  });
  await requireOk(response, 'Backend E2E fixture seed');
  return response.json();
}

export async function cleanupBackendFixtures(request, runId) {
  if (!runId) return;
  const response = await request.post('/__e2e/cleanup', {
    headers: E2E_HEADERS,
    data: { runId },
  });
  await requireOk(response, 'Backend E2E fixture cleanup');
}

export async function inspectBackendFixtures(request, runId) {
  const response = await request.get(`/__e2e/inspect?runId=${encodeURIComponent(runId)}`, {
    headers: E2E_HEADERS,
  });
  await requireOk(response, 'Backend E2E fixture inspection');
  return response.json();
}

export async function loginAs(page, user) {
  const response = await page.request.post('/api/auth/login', {
    data: {
      email: user.email,
      password: user.password,
      remember: false,
    },
  });
  await requireOk(response, `Login as ${user.role}`);
  return response.json();
}

export async function getCsrfToken(page) {
  const response = await page.request.get('/api/csrf-token');
  await requireOk(response, 'CSRF token request');
  const body = await response.json();
  const token = body.csrfToken || body.token;
  if (!token) throw new Error('CSRF response did not include a token');
  return token;
}

export async function putWithCsrf(page, url, data) {
  const csrfToken = await getCsrfToken(page);
  return page.request.put(url, {
    headers: { 'x-csrf-token': csrfToken },
    data,
  });
}

export async function postWithCsrf(page, url, data = {}) {
  const csrfToken = await getCsrfToken(page);
  return page.request.post(url, {
    headers: { 'x-csrf-token': csrfToken },
    data,
  });
}

export { E2E_HEADERS };
