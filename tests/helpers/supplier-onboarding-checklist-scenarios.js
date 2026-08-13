#!/usr/bin/env node
/**
 * Behavioural scenarios for the supplier dashboard's "Onboarding" checklist
 * (renderSupplierChecklist in public/assets/js/app.js), driven through a
 * real DOM.
 *
 * jsdom cannot be loaded inside Jest's transform in this repository, so the
 * script is driven in a plain Node process — the same approach
 * tests/helpers/card-collapse-scenarios.js takes — and each scenario's
 * outcome is printed as JSON for the Jest suite to assert on.
 *
 * app.js is a large top-level script, not a module, so the two functions
 * under test are extracted from the file by source-slicing (matching brace
 * depth) rather than requiring the whole file, which runs unrelated
 * top-level code on load.
 *
 * Run directly to debug: `node tests/helpers/supplier-onboarding-checklist-scenarios.js`
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'public/assets/js/app.js'), 'utf8');

function extractFunction(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find function ${name} in app.js`);
  }
  const braceOpen = src.indexOf('{', start);
  let depth = 0;
  let i = braceOpen;
  for (; i < src.length; i++) {
    if (src[i] === '{') {
      depth++;
    } else if (src[i] === '}') {
      depth--;
      if (depth === 0) {
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(`Could not find the end of function ${name} in app.js`);
  }
  return src.slice(start, i + 1);
}

const escapeHtmlSrc = extractFunction(source, 'escapeHtml');
const renderSrc = extractFunction(source, 'renderSupplierChecklist');

function render(supplierCount, packageCount, supplierApproved) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://event-flow.co.uk/dashboard-supplier.html',
  });
  // Bare function declarations run through window.eval() don't automatically
  // become window properties (indirect eval scoping) — expose them explicitly,
  // the same way card-collapse.js does for the functions its own tests call.
  dom.window.eval(
    `${escapeHtmlSrc}\n${renderSrc}\nwindow.renderSupplierChecklist = renderSupplierChecklist;`
  );
  const wrapper = dom.window.document.createElement('div');
  dom.window.renderSupplierChecklist(wrapper, supplierCount, packageCount, supplierApproved);
  return wrapper.innerHTML;
}

function stepState(html, stepText) {
  // Match within a single <li>...</li> — a lazy [\s\S]*? between the class
  // and the step text has no boundary of its own, so it can walk straight
  // past a "</li>" into the next item and misattribute that item's class.
  const item = html.split('</li>').find(chunk => chunk.includes(stepText));
  if (!item) {
    return null;
  }
  const match = item.match(/health-checklist-item ([a-z]+)"/);
  return match ? match[1] : null;
}

async function scenarioNoEmoji() {
  const html = render(1, 1, true);
  return {
    containsCheckEmoji: html.includes('✅'),
    containsBoxEmoji: html.includes('⬜'),
    containsChecklistItemClass: html.includes('health-checklist-item'),
    containsChecklistIconClass: html.includes('health-checklist-icon'),
  };
}

async function scenarioApprovalStates() {
  return {
    approvedTrue: stepState(render(1, 1, true), 'Get approved by admin'),
    approvedFalse: stepState(render(1, 1, false), 'Get approved by admin'),
  };
}

async function scenarioIndependentSteps() {
  const html = render(0, 0, true);
  return {
    profile: stepState(html, 'Create a supplier profile'),
    package: stepState(html, 'Add at least one package'),
  };
}

async function scenarioAllComplete() {
  const html = render(1, 2, true);
  return {
    profile: stepState(html, 'Create a supplier profile'),
    approved: stepState(html, 'Get approved by admin'),
    package: stepState(html, 'Add at least one package'),
  };
}

async function runAll() {
  const results = {};
  const scenarios = {
    noEmoji: scenarioNoEmoji,
    approvalStates: scenarioApprovalStates,
    independentSteps: scenarioIndependentSteps,
    allComplete: scenarioAllComplete,
  };

  for (const [name, fn] of Object.entries(scenarios)) {
    try {
      results[name] = { ok: true, value: await fn() };
    } catch (error) {
      results[name] = { ok: false, error: error.message, stack: error.stack };
    }
  }

  process.stdout.write(JSON.stringify(results));
}

runAll().catch(error => {
  process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
  process.exit(1);
});
