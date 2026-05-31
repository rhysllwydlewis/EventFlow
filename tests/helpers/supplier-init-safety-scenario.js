'use strict';

const fs = require('fs');
const { JSDOM } = require('jsdom');

function decodeScenario(encodedPayload) {
  return JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
}

function makeJsonResponse(payload) {
  return {
    clone: () => makeJsonResponse(payload),
    json: async () => payload,
  };
}

async function runScenario() {
  const scenario = decodeScenario(process.argv[2]);
  const requestedUrls = [];
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    url: 'https://event-flow.co.uk/supplier.html?id=sup_1&preview=true',
  });

  dom.window.Request = global.Request;
  dom.window.fetch = async input => {
    requestedUrls.push(typeof input === 'string' ? input : input.url);
    return makeJsonResponse(scenario.payload);
  };

  const supplierInitSrc = fs.readFileSync('public/assets/js/pages/supplier-init.js', 'utf8');
  dom.window.eval(supplierInitSrc);

  const response = await dom.window.fetch(scenario.url);
  const data = await response.json();

  process.stdout.write(JSON.stringify({ data, requestedUrls }));
}

runScenario().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
