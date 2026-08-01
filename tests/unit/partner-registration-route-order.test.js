'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(process.cwd(), 'routes/index.js'), 'utf8');

test('mounts secure partner registration before the legacy partner dashboard router', () => {
  const secureRequire = source.indexOf("require('./partner-registration-secure')");
  const legacyRequire = source.indexOf("require('./partner')");
  const secureV1Mount = source.indexOf(
    "app.use('/api/v1/partner', securePartnerRegistrationRoutes)"
  );
  const secureLegacyMount = source.indexOf(
    "app.use('/api/partner', securePartnerRegistrationRoutes)"
  );
  const legacyV1Mount = source.indexOf("app.use('/api/v1/partner', partnerRoutes)");
  const legacyMount = source.indexOf("app.use('/api/partner', partnerRoutes)");

  expect(secureRequire).toBeGreaterThanOrEqual(0);
  expect(legacyRequire).toBeGreaterThan(secureRequire);
  expect(secureV1Mount).toBeGreaterThanOrEqual(0);
  expect(secureLegacyMount).toBeGreaterThanOrEqual(0);
  expect(secureV1Mount).toBeLessThan(legacyV1Mount);
  expect(secureLegacyMount).toBeLessThan(legacyMount);
});
