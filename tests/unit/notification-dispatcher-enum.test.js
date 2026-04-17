'use strict';

const NotificationDispatcher = require('../../public/assets/js/notification-dispatcher.js');
const { NOTIFICATION_TYPES } = require('../../models/index');

describe('NotificationDispatcher enum drift guard', () => {
  it('matches models/index.js NOTIFICATION_TYPES exactly (order + length)', () => {
    const browserTypes = NotificationDispatcher.NOTIFICATION_TYPES;
    const serverTypes = NOTIFICATION_TYPES;
    if (JSON.stringify(browserTypes) !== JSON.stringify(serverTypes)) {
      throw new Error(
        'Notification type enum drift detected. Update BOTH public/assets/js/notification-dispatcher.js and models/index.js so NOTIFICATION_TYPES stay identical and in the same order.'
      );
    }
    expect(browserTypes).toEqual(serverTypes);
  });
});
