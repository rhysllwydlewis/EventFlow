describe('notification query hardening helpers', () => {
  const routes = require('../../routes/notifications');

  it('clamps limit within safe bounds', () => {
    const { clampInteger, MAX_NOTIFICATION_LIMIT } = routes._private;

    expect(clampInteger('250', 50, 1, MAX_NOTIFICATION_LIMIT)).toBe(100);
    expect(clampInteger('-10', 50, 1, MAX_NOTIFICATION_LIMIT)).toBe(1);
    expect(clampInteger('abc', 50, 1, MAX_NOTIFICATION_LIMIT)).toBe(50);
  });

  it('clamps skip within safe bounds', () => {
    const { clampInteger, MAX_NOTIFICATION_SKIP } = routes._private;

    expect(clampInteger('999999', 0, 0, MAX_NOTIFICATION_SKIP)).toBe(10000);
    expect(clampInteger('-5', 0, 0, MAX_NOTIFICATION_SKIP)).toBe(0);
  });

  it('normalises optional enum filters', () => {
    const { normaliseOptionalEnum } = routes._private;

    expect(normaliseOptionalEnum('message', ['message', 'system'])).toBe('message');
    expect(normaliseOptionalEnum('invalid', ['message', 'system'])).toBeNull();
    expect(normaliseOptionalEnum('', ['message', 'system'])).toBeNull();
  });
});
