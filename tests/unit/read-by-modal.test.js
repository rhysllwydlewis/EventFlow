'use strict';

const fs = require('fs');
const path = require('path');

describe('ReadByModal route-change behavior (static)', () => {
  it('registers popstate/hashchange listeners and closes on route change', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../public/messenger/js/ReadByModal.js'),
      'utf8'
    );
    expect(src).toContain("window.addEventListener('popstate', this._onRouteChange)");
    expect(src).toContain("window.addEventListener('hashchange', this._onRouteChange)");
    expect(src).toContain('this.close();');
  });
});
