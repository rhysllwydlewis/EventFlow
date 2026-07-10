'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

function runNodeSmoke(source) {
  return execFileSync(process.execPath, ['-e', source], {
    cwd: path.join(__dirname, '../..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('Planning wizard hardening', () => {
  it('keeps resume state, category choices, validation and auth recovery consistent', () => {
    runNodeSmoke(String.raw`
      const assert = require('assert');
      const fs = require('fs');
      const { JSDOM } = require('jsdom');

      (async () => {
        const dom = new JSDOM(
          '<!doctype html><body><div id="wizard-container"></div><aside id="plan-summary"></aside><div id="mobile-plan-summary"></div></body>',
          { url: 'https://event-flow.co.uk/start', runScripts: 'outside-only' }
        );
        const { window } = dom;
        const { document } = window;
        const assertJson = (actual, expected) =>
          assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
        let state = {
          currentStep: 2,
          eventType: 'Wedding',
          priorities: ['venue'],
          selectedPackages: { venues: 'venue-a', catering: 'catering-a' },
          alreadyHave: { venues: true, photography: true },
        };

        function saveState(next) {
          state = { ...next };
          return true;
        }

        window.WizardState = {
          getState: () => ({ ...state }),
          saveState,
          saveStep: (stepIndex, data) =>
            saveState({ ...state, ...(data || {}), currentStep: stepIndex }),
          selectPackage: (categoryKey, packageId) =>
            saveState({
              ...state,
              selectedPackages: { ...(state.selectedPackages || {}), [categoryKey]: packageId },
            }),
          deselectPackage: categoryKey => {
            const selectedPackages = { ...(state.selectedPackages || {}) };
            delete selectedPackages[categoryKey];
            return saveState({ ...state, selectedPackages });
          },
          clearState: () => {
            state = {};
            window.localStorage.removeItem('eventflow_plan_builder_v1');
            return true;
          },
        };
        window.fetch = async () => ({ status: 401 });

        window.eval(fs.readFileSync('public/assets/js/pages/start-init.js', 'utf8'));
        document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));
        window.StartWizardHardening.install();

        assertJson(state.selectedPackages, { venues: 'venue-a' });
        assertJson(state.alreadyHave, {});

        state.alreadyHave = { venues: true };
        window.WizardState.selectPackage('venues', 'venue-b');
        assert.strictEqual(state.selectedPackages.venues, 'venue-b');
        assert.strictEqual(state.alreadyHave.venues, undefined);

        state.selectedPackages = { venues: 'venue-b' };
        state.alreadyHave = { catering: true };
        window.WizardState.saveStep(0, { eventType: 'Corporate' });
        assertJson(state.selectedPackages, {});
        assertJson(state.alreadyHave, {});

        window.localStorage.setItem('eventflow_start', '{}');
        window.localStorage.setItem('eventflow_wizard_pending', '{}');
        window.localStorage.setItem('eventflow_wizard_timestamp', '1');
        window.WizardState.clearState();
        assert.strictEqual(window.localStorage.getItem('eventflow_start'), null);
        assert.strictEqual(window.localStorage.getItem('eventflow_wizard_pending'), null);
        assert.strictEqual(window.localStorage.getItem('eventflow_wizard_timestamp'), null);

        state = {
          currentStep: 1,
          eventType: 'Wedding',
          priorities: [],
          selectedPackages: {},
          alreadyHave: {},
        };
        document.getElementById('wizard-container').innerHTML =
          '<span class="wizard-step-indicator">Step 5 of 9</span>';
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(state.currentStep, 4);

        document.getElementById('wizard-container').innerHTML =
          '<div class="form-row"><input id="wz-name"><span class="helper-text">Name hint</span></div>' +
          '<div class="form-row"><input id="wz-location"><span class="helper-text">Location hint</span></div>' +
          '<div class="form-row"><input id="wz-guests" type="number" value="10.5"><span class="helper-text">Guest hint</span></div>' +
          '<button class="wizard-next">Continue</button>';
        await new Promise(resolve => setTimeout(resolve, 0));
        let continued = 0;
        document.querySelector('.wizard-next').addEventListener('click', () => {
          continued += 1;
        });
        document.querySelector('.wizard-next').dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true })
        );
        assert.strictEqual(continued, 0);
        assert.strictEqual(document.getElementById('wz-guests').getAttribute('aria-invalid'), 'true');

        const guests = document.getElementById('wz-guests');
        guests.value = '10';
        guests.dispatchEvent(new window.Event('input', { bubbles: true }));
        document.querySelector('.wizard-next').dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true })
        );
        assert.strictEqual(continued, 1);
        assert.strictEqual(guests.getAttribute('aria-invalid'), null);

        state = {
          currentStep: 4,
          eventType: 'Wedding',
          priorities: ['venue'],
          selectedPackages: { venues: 'venue-b' },
          alreadyHave: {},
        };
        document.getElementById('wizard-container').innerHTML =
          '<div class="wizard-package-card selected" data-category="venues" data-package-id="venue-a" aria-selected="true"><div class="wz-pkg-body"><div class="wizard-package-selected">old</div></div></div>' +
          '<div class="wizard-package-card" data-category="venues" data-package-id="venue-b" aria-selected="false"><div class="wz-pkg-body"></div></div>';
        document.querySelector('[data-package-id="venue-b"]').dispatchEvent(
          new window.MouseEvent('click', { bubbles: true })
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.strictEqual(document.querySelectorAll('.wizard-package-selected').length, 1);
        assert.strictEqual(
          document.querySelector('[data-package-id="venue-b"]').getAttribute('aria-selected'),
          'true'
        );
        assert.strictEqual(
          document.querySelector('[data-package-id="venue-a"]').getAttribute('aria-selected'),
          'false'
        );

        state = {
          currentStep: 2,
          eventType: 'Wedding',
          priorities: ['venue'],
          selectedPackages: { venues: 'venue-b', catering: 'catering-a' },
          alreadyHave: { photography: true },
        };
        document.getElementById('wizard-container').innerHTML =
          '<button class="wz-chip" data-priority-key="venue"></button>' +
          '<button class="wizard-next">Continue</button>';
        document.querySelector('.wizard-next').dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true })
        );
        assertJson(state.selectedPackages, { venues: 'venue-b' });
        assertJson(state.alreadyHave, {});

        await window.fetch('/api/v1/me/plans', {
          method: 'POST',
          body: JSON.stringify({ eventType: 'Wedding' }),
        });
        assertJson(JSON.parse(window.localStorage.getItem('eventflow_wizard_pending')), {
          eventType: 'Wedding',
        });
        assert(Number(window.localStorage.getItem('eventflow_wizard_timestamp')) > 0);

        window.StartWizardHardening.destroy();
        dom.window.close();
      })().catch(error => {
        console.error(error);
        process.exitCode = 1;
      });
    `);
  });
});
