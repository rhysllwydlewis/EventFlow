'use strict';

/**
 * Runs public/assets/js/utils/admin-tabs.js in jsdom and prints what happened as JSON. Run in a
 * child process, like the other jsdom scenarios here, because jsdom's dependencies are ES modules
 * that Jest cannot load.
 *
 * usage: node admin-tabs-scenario.js <base64 json {url, actions, ghost}>
 *   actions: [{ click: 1 }, { key: 'ArrowRight', on: 0 }]
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(
  path.join(__dirname, '../../public/assets/js/utils/admin-tabs.js'),
  'utf8'
);

const scenario = JSON.parse(Buffer.from(process.argv[2] || 'e30=', 'base64').toString('utf8'));
const dom = new JSDOM(
  `<div>
     <button id="b-one"></button><button id="b-two"></button><button id="b-three"></button>
     <section id="p-one"></section><section id="p-two" style="display:none"></section>
     <section id="p-three" hidden></section>
   </div>`,
  { url: scenario.url || 'http://localhost/admin-tickets', runScripts: 'outside-only' }
);
dom.window.eval(source);

const { document } = dom.window;
const names = ['one', 'two', 'three'];
const calls = [];
const tabs = names.map(name => ({
  name,
  button: document.getElementById(`b-${name}`),
  panel: document.getElementById(`p-${name}`),
  onShow: first => calls.push([name, first]),
}));
if (scenario.ghost) {
  tabs.push({ name: 'ghost', button: null, panel: null });
}

const results = {};
try {
  dom.window.AdminTabs.mount({ tabs, activeClass: 'is-on', initial: 'one' });
  results.error = null;
} catch (error) {
  results.error = String(error);
}

const snapshot = () => ({
  visible: names.filter(name => {
    const panel = document.getElementById(`p-${name}`);
    return !panel.hidden && panel.style.display !== 'none';
  }),
  active: names.filter(name => document.getElementById(`b-${name}`).classList.contains('is-on')),
  selected: names.map(name => document.getElementById(`b-${name}`).getAttribute('aria-selected')),
  search: dom.window.location.search,
});

results.afterMount = snapshot();
results.steps = (scenario.actions || []).map(action => {
  if (typeof action.click === 'number') {
    tabs[action.click].button.click();
  } else if (action.key) {
    tabs[action.on].button.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: action.key, bubbles: true })
    );
  }
  return snapshot();
});
results.calls = calls;
results.pure = {
  fromQuery: dom.window.AdminTabs.nameFromAddress('?tab=external', '', ['tickets', 'external']),
  fromHash: dom.window.AdminTabs.nameFromAddress('', '#contacts', ['tickets', 'contacts']),
  notATab: dom.window.AdminTabs.nameFromAddress('?tab=nope', '#nope', ['tickets']),
  queryWins: dom.window.AdminTabs.nameFromAddress('?tab=external', '#contacts', [
    'tickets',
    'contacts',
    'external',
  ]),
  keepsOthers: dom.window.AdminTabs.addressFor('http://x/admin-tickets?id=7#top', 'external'),
  replacesTab: dom.window.AdminTabs.addressFor('http://x/admin-tickets?tab=a', 'b'),
};
process.stdout.write(JSON.stringify(results));
