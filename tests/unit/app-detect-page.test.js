/**
 * app.js efDetectPage(): the page tag for pages that do not set window.__EF_PAGE__.
 * It replaced a nested ternary, so the expected tags below are what that chain returned (minus
 * dash_customer, whose onboarding box was removed). The function is read out of the real file.
 */

const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../public/assets/js/app.js'), 'utf8');
const start = source.indexOf('function efDetectPage(pathname)');
const end = source.indexOf('\n}\n', start) + 3;
// eslint-disable-next-line no-new-func
const efDetectPage = new Function(`${source.slice(start, end)}\nreturn efDetectPage;`)();

describe('efDetectPage', () => {
  test.each([
    ['/admin-users', 'admin_users'],
    ['/admin-users.html', 'admin_users'],
    ['/admin', 'admin'],
    ['/admin.html', 'admin'],
    ['/auth', 'auth'],
    ['/auth.html', 'auth'],
    ['/verify', 'verify'],
    ['/verify.html', 'verify'],
    ['/dashboard/supplier', 'dash_supplier'],
    ['/dashboard-supplier.html', 'dash_supplier'],
    ['/suppliers', 'suppliers'],
    ['/suppliers.html', 'suppliers'],
    ['/supplier', 'supplier'],
    ['/supplier.html', 'supplier'],
    ['/supplier/profile-customization.html', 'supplier'],
    ['/supplier/subscription.html', 'supplier'],
    ['/plan', 'plan'],
    ['/plan.html', 'plan'],
  ])('%s is tagged %s', (pathname, expected) => {
    expect(efDetectPage(pathname)).toBe(expected);
  });

  test.each([
    '/',
    '/index.html',
    '/budget',
    '/guests',
    '/dashboard/customer',
    '/dashboard-customer.html',
    '/admin-audit',
    '/auth/',
    '/plans',
  ])('%s has no tag', pathname => {
    expect(efDetectPage(pathname)).toBe('');
  });

  test('"/suppliers" is not mistaken for "/supplier", which also matches by prefix', () => {
    expect(efDetectPage('/suppliers')).toBe('suppliers');
    expect(efDetectPage('/suppliersx')).toBe('supplier');
  });
});
