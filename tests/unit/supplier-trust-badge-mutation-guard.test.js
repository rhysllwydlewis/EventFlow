'use strict';

describe('supplier trust badge generic mutation guard', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
  });

  test.each(['public-liability-verified', 'dbs-checked', 'licence-verified'])(
    'generic award path rejects %s',
    async badgeId => {
      const { awardBadge } = require('../../utils/badgeManagement');

      await expect(awardBadge('sup_1', badgeId, 'admin_1')).rejects.toMatchObject({
        code: 'TRUST_BADGE_DEDICATED_ENDPOINT_REQUIRED',
      });
    }
  );

  test.each(['public-liability-verified', 'dbs-checked', 'licence-verified'])(
    'generic revoke path rejects %s',
    async badgeId => {
      const { revokeBadge } = require('../../utils/badgeManagement');

      await expect(revokeBadge('sup_1', badgeId, 'admin_1')).rejects.toMatchObject({
        code: 'TRUST_BADGE_DEDICATED_ENDPOINT_REQUIRED',
      });
    }
  );
});
