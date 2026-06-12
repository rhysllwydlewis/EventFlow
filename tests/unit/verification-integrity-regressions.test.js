'use strict';

function loadServiceWith({ users = [], logs = [] }) {
  jest.resetModules();
  jest.doMock('../../db-unified', () => ({
    read: jest.fn(async collection => {
      if (collection === 'users') {
        return users;
      }
      if (collection === 'email_logs') {
        return logs;
      }
      return [];
    }),
  }));
  jest.doMock('../../services/emailLog.service', () => ({ COLLECTION: 'email_logs' }));
  return require('../../services/verificationProvenance.service');
}

describe('verification integrity regressions', () => {
  afterEach(() => {
    jest.dontMock('../../db-unified');
    jest.dontMock('../../services/emailLog.service');
    jest.resetModules();
  });

  test('flags stored non-google authProvider when Google linkage exists', async () => {
    const service = loadServiceWith({
      users: [
        {
          id: 'usr_google_linked_local',
          email: 'linked@example.com',
          createdAt: new Date().toISOString(),
          verified: true,
          authProvider: 'local',
          googleSub: 'google-sub',
        },
      ],
    });

    const result = await service.getVerificationIntegrity({ lookbackDays: 30 });
    expect(result.issues.map(issue => issue.issue)).toContain(
      'google_link_with_non_google_provider'
    );
  });

  test('flags verified email/password users with no verification email log', async () => {
    const service = loadServiceWith({
      users: [
        {
          id: 'usr_email_no_log',
          email: 'local@example.com',
          createdAt: new Date().toISOString(),
          verified: true,
          signupMethod: 'email_password',
          authProvider: 'local',
          verificationMethod: 'eventflow_email',
          verifiedAt: new Date().toISOString(),
        },
      ],
      logs: [],
    });

    const result = await service.getVerificationIntegrity({ lookbackDays: 30 });
    expect(result.summary.emailPasswordUsersMissingVerificationEmailLogs).toBe(1);
    expect(result.issues.map(issue => issue.issue)).toContain(
      'email_password_user_missing_verification_email_log'
    );
  });

  test('summary counts only verification logs inside lookback window', async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const service = loadServiceWith({
      users: [],
      logs: [
        {
          id: 'email_log_old',
          to: 'old@example.com',
          subject: 'Confirm your EventFlow account',
          template: 'verification',
          status: 'sent',
          provider: 'postmark',
          createdAt: oldDate,
        },
      ],
    });

    const result = await service.getVerificationIntegrity({ lookbackDays: 30 });
    expect(result.summary.verificationEmailLogs).toBe(0);
    expect(result.summary.lastVerificationEmailAttemptAt).toBeNull();
  });
});
