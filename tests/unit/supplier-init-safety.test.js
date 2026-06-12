'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const scenarioRunner = path.join(__dirname, '../helpers/supplier-init-safety-scenario.js');

function runSupplierInitScenario({ payload, url }) {
  const encoded = Buffer.from(JSON.stringify({ payload, url }), 'utf8').toString('base64');
  const output = execFileSync(process.execPath, [scenarioRunner, encoded], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
  });
  return JSON.parse(output);
}

describe('supplier-init profile fetch safety', () => {
  test('appends preview to same-origin supplier API requests and sanitises package payloads', () => {
    const result = runSupplierInitScenario({
      url: '/api/suppliers/sup_1/packages?limit=4',
      payload: {
        packages: [
          null,
          {
            title: 'Safe package',
            image: 'javascript:alert(1)',
            imageUrl: 'https://cdn.test/a.jpg',
          },
        ],
      },
    });

    expect(result.requestedUrls[0]).toBe('/api/suppliers/sup_1/packages?limit=4&preview=true');
    expect(result.data.packages).toHaveLength(1);
    expect(result.data.packages[0]).toMatchObject({
      image: '',
      imageUrl: 'https://cdn.test/a.jpg',
    });
  });

  test('sanitises same-origin absolute supplier API responses', () => {
    const result = runSupplierInitScenario({
      url: 'https://event-flow.co.uk/api/suppliers/sup_1',
      payload: {
        website: '/relative-website',
        socialLinks: { instagram: '/relative-social', facebook: 'https://facebook.com/safe' },
        phone: 'not a phone',
      },
    });

    expect(result.data).toMatchObject({
      website: '',
      socialLinks: { facebook: 'https://facebook.com/safe' },
      phone: '',
    });
  });

  test('leaves off-origin supplier-shaped responses alone', () => {
    const result = runSupplierInitScenario({
      url: 'https://api.example.test/api/suppliers/sup_1',
      payload: { website: '/relative-website' },
    });

    expect(result.data).toMatchObject({ website: '/relative-website' });
  });
});
