const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('dashboard-supplier-category postcode accessibility behavior', () => {
  const scriptPath = path.join(
    process.cwd(),
    'public/assets/js/pages/dashboard-supplier-category.js'
  );
  const scriptContent = fs.readFileSync(scriptPath, 'utf8');

  function createDom() {
    const dom = new JSDOM(
      `
        <!doctype html>
        <html>
          <body>
            <select id="sup-category">
              <option value="">Choose</option>
              <option value="Venues">Venues</option>
              <option value="Photography">Photography</option>
            </select>
            <div id="venue-postcode-row" class="form-row-hidden" style="display:none">
              <input id="sup-venue-postcode" aria-required="false" />
              <p id="venue-postcode-error" class="form-error-text"></p>
            </div>
          </body>
        </html>
      `,
      { runScripts: 'outside-only' }
    );

    vm.runInContext(scriptContent, dom.getInternalVMContext());
    return dom;
  }

  it('shows venue postcode field and marks it required when category is Venues', () => {
    const dom = createDom();
    const category = dom.window.document.getElementById('sup-category');
    const row = dom.window.document.getElementById('venue-postcode-row');
    const input = dom.window.document.getElementById('sup-venue-postcode');

    category.value = 'Venues';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(row.classList.contains('form-row-hidden')).toBe(false);
    expect(row.style.display).toBe('');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('sets aria-invalid and returns false for invalid venue postcode', () => {
    const dom = createDom();
    const category = dom.window.document.getElementById('sup-category');
    const input = dom.window.document.getElementById('sup-venue-postcode');
    const error = dom.window.document.getElementById('venue-postcode-error');

    category.value = 'Venues';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.value = 'invalid';

    const result = dom.window.validateVenuePostcode();
    expect(result).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(error.classList.contains('visible')).toBe(true);
    expect(error.textContent).toContain('valid UK postcode');
  });

  it('clears venue postcode errors and aria-invalid when category changes away from Venues', () => {
    const dom = createDom();
    const category = dom.window.document.getElementById('sup-category');
    const input = dom.window.document.getElementById('sup-venue-postcode');
    const error = dom.window.document.getElementById('venue-postcode-error');

    category.value = 'Venues';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    input.value = 'invalid';
    dom.window.validateVenuePostcode();

    category.value = 'Photography';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(error.classList.contains('visible')).toBe(false);
    expect(error.textContent).toBe('');
  });
});
