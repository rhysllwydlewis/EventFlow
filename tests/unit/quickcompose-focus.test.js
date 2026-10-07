const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
  path.join(__dirname, '../../public/messenger/js/QuickComposeV4.js'),
  'utf8'
);

describe('QuickComposeV4 dialog focus handling', () => {
  it('remembers the opener and restores focus on close', () => {
    expect(src).toMatch(/const opener = document\.activeElement/);
    expect(src).toMatch(/_opener\.focus\(\)/);
  });

  it('traps Tab inside the panel', () => {
    expect(src).toMatch(/e\.key === 'Tab'/);
    expect(src).toMatch(/last\.focus\(\)/);
    expect(src).toMatch(/first\.focus\(\)/);
  });
});

describe('QuickComposeV4 dialog focus races', () => {
  it('stops Escape from reaching global shortcuts', () => {
    expect(src).toMatch(/e\.stopPropagation\(\)/);
  });

  it('only autofocuses while still open', () => {
    expect(src).toMatch(/if \(ta && _isOpen\)/);
  });

  it('captures the opener per request, assigned once the dialog opens', () => {
    expect(src).toMatch(/const opener = document\.activeElement/);
    expect(src).toMatch(/_opener = opener;/);
  });
});
