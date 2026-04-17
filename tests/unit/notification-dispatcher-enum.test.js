'use strict';

const NotificationDispatcher = require('../../public/assets/js/notification-dispatcher.js');
const { NOTIFICATION_TYPES } = require('../../models/index');

describe('NotificationDispatcher enum drift guard', () => {
  it('matches models/index.js NOTIFICATION_TYPES exactly (order + length)', () => {
    // On failure jest's diff output will show exactly which element(s) drifted;
    // keep BOTH public/assets/js/notification-dispatcher.js and
    // models/index.js in sync (same values, same order).
    expect(NotificationDispatcher.NOTIFICATION_TYPES).toEqual(NOTIFICATION_TYPES);
  });
});
