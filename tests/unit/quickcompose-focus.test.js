const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../public/messenger/js/QuickComposeV4.js'),
  'utf8'
);

describe('QuickComposeV4 dialog focus handling', () => {
  it('remembers the opener and restores focus on close', () => {
    expect(src).toMatch(/_opener = document\.activeElement/);
    expect(src).toMatch(/_opener\.focus\(\)/);
  });

  it('traps Tab inside the panel', () => {
    expect(src).toMatch(/e\.key === 'Tab'/);
    expect(src).toMatch(/last\.focus\(\)/);
    expect(src).toMatch(/first\.focus\(\)/);
  });
});
