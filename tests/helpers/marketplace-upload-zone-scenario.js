'use strict';

const fs = require('fs');
const { JSDOM } = require('jsdom');

async function runScenario() {
  const dom = new JSDOM(
    `<!doctype html><body>
      <form id="new-listing-form">
        <input id="listing-title"><textarea id="listing-description"></textarea>
        <input id="listing-price"><input id="listing-location">
        <select id="listing-category"></select><select id="listing-condition"></select>
        <div id="image-upload-zone"><input type="file" id="listing-images"></div>
        <div id="image-preview-grid"></div><p id="listing-images-status"></p>
        <span id="char-count"></span><button type="submit">Publish</button>
      </form>
    </body>`,
    { runScripts: 'outside-only', url: 'http://localhost/supplier/marketplace-new-listing' }
  );
  dom.window.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ user: { id: 'usr_supplier', role: 'supplier' } }),
  });
  dom.window.eval(fs.readFileSync('public/assets/js/marketplace-new-listing.js', 'utf8'));
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  const zone = dom.window.document.getElementById('image-upload-zone');
  const input = dom.window.document.getElementById('listing-images');
  let inputClicks = 0;
  input.addEventListener('click', () => {
    inputClicks += 1;
  });

  zone.click();
  const afterPointer = inputClicks;
  zone.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const afterKeyboard = inputClicks;
  dom.window.close();
  process.stdout.write(JSON.stringify({ afterPointer, afterKeyboard }));
}

runScenario().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
