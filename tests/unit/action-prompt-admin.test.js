/**
 * Unit tests for admin action-prompt endpoints and related functionality.
 *
 * Covers:
 *  - GET  /api/admin/suppliers/:id/action-prompts/diagnostics
 *  - POST /api/admin/suppliers/:id/action-prompts/reset-cadence
 *  - POST /api/admin/suppliers/:id/action-prompts/set-enabled
 *  - POST /api/admin/email-automation/action-prompts/preview
 *  - Run history persistence in actionPromptScheduler
 *  - /api/me/action-prompt-checklist endpoint presence in suppliers.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── File-existence guards ──────────────────────────────────────────────────

describe('Action Prompt Admin — Route files exist', () => {
  it('supplier-admin.js exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../routes/supplier-admin.js'))).toBe(true);
  });

  it('suppliers.js exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../routes/suppliers.js'))).toBe(true);
  });

  it('actionPromptScheduler.js exists', () => {
    expect(fs.existsSync(path.join(__dirname, '../../services/actionPromptScheduler.js'))).toBe(
      true
    );
  });
});

// ── supplier-admin.js — action-prompt endpoints ────────────────────────────

describe('Action Prompt Admin — supplier-admin.js endpoint declarations', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../routes/supplier-admin.js'), 'utf8');
  });

  it('has GET diagnostics endpoint', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/diagnostics'");
    expect(src).toContain('router.get(');
  });

  it('has POST reset-cadence endpoint', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/reset-cadence'");
    expect(src).toContain('router.post(');
  });

  it('has POST set-enabled endpoint', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/set-enabled'");
  });

  it('diagnostics endpoint uses authRequired + roleRequired admin', () => {
    const diagSection = src.slice(
      src.indexOf("'/suppliers/:id/action-prompts/diagnostics'"),
      src.indexOf("'/suppliers/:id/action-prompts/reset-cadence'")
    );
    expect(diagSection).toContain('applyAuthRequired');
    expect(diagSection).toContain("applyRoleRequired('admin')");
  });

  it('reset-cadence endpoint uses CSRF protection', () => {
    const resetSection = src.slice(
      src.indexOf("'/suppliers/:id/action-prompts/reset-cadence'"),
      src.indexOf("'/suppliers/:id/action-prompts/set-enabled'")
    );
    expect(resetSection).toContain('applyCsrfProtection');
  });

  it('set-enabled endpoint validates enabled is boolean', () => {
    const setEnabledSection = src.slice(
      src.indexOf("'/suppliers/:id/action-prompts/set-enabled'"),
      src.lastIndexOf('module.exports')
    );
    expect(setEnabledSection).toContain("typeof enabled !== 'boolean'");
  });

  it('diagnostics builds debugSummary', () => {
    expect(src).toContain('debugSummary');
  });

  it('diagnostics returns warnings array', () => {
    expect(src).toContain('warnings');
    expect(src).toContain('UNSUBSCRIBE_SECRET');
  });

  it('reset-cadence uses auditLog', () => {
    const resetSection = src.slice(
      src.indexOf("'/suppliers/:id/action-prompts/reset-cadence'"),
      src.indexOf("'/suppliers/:id/action-prompts/set-enabled'")
    );
    expect(resetSection).toContain('auditLog');
    expect(resetSection).toContain('ACTION_PROMPT_CADENCE_RESET');
  });

  it('set-enabled uses auditLog', () => {
    const setEnabledSection = src.slice(
      src.indexOf("'/suppliers/:id/action-prompts/set-enabled'"),
      src.lastIndexOf('module.exports')
    );
    expect(setEnabledSection).toContain('auditLog');
  });
});

// ── admin.js — pass-throughs + preview endpoints ──────────────────────────

describe('Action Prompt Admin — admin.js endpoint declarations', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../routes/admin.js'), 'utf8');
  });

  it('has pass-through for GET diagnostics', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/diagnostics'");
    expect(src).toContain("next('router')");
  });

  it('has pass-through for POST reset-cadence', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/reset-cadence'");
  });

  it('has pass-through for POST set-enabled', () => {
    expect(src).toContain("'/suppliers/:id/action-prompts/set-enabled'");
  });

  it('has POST preview endpoint', () => {
    expect(src).toContain("'/email-automation/action-prompts/preview'");
  });

  it('has POST send-preview-to-admin endpoint', () => {
    expect(src).toContain("'/email-automation/action-prompts/send-preview-to-admin'");
  });

  it('preview endpoint requires confirm=true for send-to-admin', () => {
    const sendSection = src.slice(
      src.indexOf("'/email-automation/action-prompts/send-preview-to-admin'"),
      src.indexOf("'/settings/maintenance'")
    );
    expect(sendSection).toContain('confirm !== true');
  });

  it('send-preview-to-admin uses CSRF protection', () => {
    const sendSection = src.slice(
      src.indexOf("'/email-automation/action-prompts/send-preview-to-admin'"),
      src.indexOf("'/settings/maintenance'")
    );
    expect(sendSection).toContain('csrfProtection');
  });

  it('send-preview-to-admin sends to admin email, not supplier', () => {
    const sendSection = src.slice(
      src.indexOf("'/email-automation/action-prompts/send-preview-to-admin'"),
      src.indexOf("'/settings/maintenance'")
    );
    expect(sendSection).toContain('adminEmail');
    expect(sendSection).toContain('to: adminEmail');
  });

  it('GET email-automation returns runHistory', () => {
    const getSection = src.slice(
      src.indexOf("router.get('/settings/email-automation'"),
      src.indexOf("router.put('/settings/email-automation'")
    );
    expect(getSection).toContain('runHistory');
  });
});

// ── actionPromptScheduler.js — run history persistence ───────────────────

describe('Action Prompt Admin — scheduler run history persistence', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../services/actionPromptScheduler.js'), 'utf8');
  });

  it('persists runHistory array to settings', () => {
    expect(src).toContain('runHistory');
    expect(src).toContain('RUN_HISTORY_MAX');
  });

  it('caps history at RUN_HISTORY_MAX entries', () => {
    expect(src).toContain('.slice(');
    expect(src).toContain('RUN_HISTORY_MAX');
  });

  it('stores historyEntry with required fields', () => {
    expect(src).toContain('finishedAt: summary.finishedAt');
    expect(src).toContain('scanned: summary.scanned');
    expect(src).toContain('sent: summary.sent');
    expect(src).toContain('errors: summary.errors');
  });

  it('only persists for non-dry runs', () => {
    // The block that persists is guarded by !dryRun
    const persistBlock = src.slice(src.indexOf('Persist lastRun'), src.indexOf('return summary;'));
    expect(persistBlock).toContain('if (!dryRun)');
  });
});

// ── suppliers.js — checklist endpoint ────────────────────────────────────

describe('Action Prompt Admin — suppliers.js checklist endpoint', () => {
  let src;
  beforeAll(() => {
    src = fs.readFileSync(path.join(__dirname, '../../routes/suppliers.js'), 'utf8');
  });

  it('has GET /me/action-prompt-checklist endpoint', () => {
    expect(src).toContain("'/me/action-prompt-checklist'");
  });

  it('endpoint requires auth and supplier role', () => {
    const section = src.slice(
      src.indexOf("'/me/action-prompt-checklist'"),
      src.lastIndexOf('module.exports')
    );
    expect(section).toContain('applyAuthRequired');
    expect(section).toContain("applyRoleRequired('supplier')");
  });

  it('endpoint uses computeFullReport', () => {
    const section = src.slice(
      src.indexOf("'/me/action-prompt-checklist'"),
      src.lastIndexOf('module.exports')
    );
    expect(section).toContain('computeFullReport');
  });
});

// ── Diagnostics logic unit tests ───────────────────────────────────────────

describe('Action Prompt Admin — diagnostics logic', () => {
  const {
    computeFullReport,
    evaluateCadence,
    REQUIRED_PROFILE_FIELDS,
  } = require('../../services/actionPromptService');

  const baseSettings = {
    emailAutomation: {
      actionPrompts: {
        enabled: true,
        promptTypes: { missingPackages: true, incompleteProfile: true, missingPhotos: true },
      },
    },
  };

  function makeSupplier(overrides = {}) {
    return {
      id: 'sup_1',
      ownerUserId: 'user_1',
      name: 'Test Supplier',
      description_short: 'A description',
      location: 'London',
      photosGallery: ['photo1.jpg'],
      ...overrides,
    };
  }

  function makeUser(overrides = {}) {
    return {
      id: 'user_1',
      email: 'supplier@test.com',
      role: 'supplier',
      verified: true,
      emailPrefs: { actionPrompts: { enabled: true } },
      ...overrides,
    };
  }

  it('computeFullReport returns outstanding missingPackages when no packages', () => {
    const report = computeFullReport(makeSupplier(), [], baseSettings, makeUser());
    expect(report.outstanding.some(a => a.key === 'missingPackages')).toBe(true);
  });

  it('computeFullReport returns green status when packages exist and profile complete', () => {
    const pkgs = [{ id: 'p1', supplierId: 'sup_1' }];
    const report = computeFullReport(makeSupplier(), pkgs, baseSettings, makeUser());
    expect(report.ragStatus).toBe('green');
    expect(report.outstanding).toHaveLength(0);
  });

  it('evaluateCadence returns wouldSendNow=false on first encounter', () => {
    const result = evaluateCadence(undefined, new Date());
    expect(result.shouldSend).toBe(false);
  });

  it('evaluateCadence returns wouldSendNow=true when nextSendAt is past', () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const state = {
      cadence: 'daily',
      sendCountDaily: 1,
      sendCountWeekly: 0,
      sendCountMonthly: 0,
      lastSentAt: pastDate,
      nextSendAt: pastDate,
      firstOutstandingAt: pastDate,
    };
    const result = evaluateCadence(state, new Date());
    expect(result.shouldSend).toBe(true);
  });

  it('REQUIRED_PROFILE_FIELDS is an array', () => {
    expect(Array.isArray(REQUIRED_PROFILE_FIELDS)).toBe(true);
    expect(REQUIRED_PROFILE_FIELDS.length).toBeGreaterThan(0);
  });
});

// ── UI files ──────────────────────────────────────────────────────────────

describe('Action Prompt Admin — UI files updated', () => {
  it('admin-supplier-detail.html has action-prompts tab', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '../../public/admin-supplier-detail.html'),
      'utf8'
    );
    expect(html).toContain('data-tab="action-prompts"');
    expect(html).toContain('id="action-prompts"');
    expect(html).toContain('apDiagnosticsPanel');
    expect(html).toContain('apResetCadenceBtn');
    expect(html).toContain('apEnableBtn');
    expect(html).toContain('apDisableBtn');
  });

  it('admin-supplier-detail-init.js has loadApDiagnostics function', () => {
    const js = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-supplier-detail-init.js'),
      'utf8'
    );
    expect(js).toContain('loadApDiagnostics');
    expect(js).toContain('action-prompts/diagnostics');
    expect(js).toContain('apCopyDebugBtn');
  });

  it('admin-settings.html has email preview section', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/admin-settings.html'), 'utf8');
    expect(html).toContain('emailPreviewBtn');
    expect(html).toContain('emailPreviewIframe');
    expect(html).toContain('emailPreviewSendToAdminBtn');
  });

  it('admin-settings.html has run history section', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../public/admin-settings.html'), 'utf8');
    expect(html).toContain('emailAutoRunHistoryContainer');
    expect(html).toContain('Run History');
  });

  it('admin-settings-init.js has renderRunHistory function', () => {
    const js = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-settings-init.js'),
      'utf8'
    );
    expect(js).toContain('renderRunHistory');
    expect(js).toContain('emailAutoRunHistoryContainer');
  });

  it('admin-settings-init.js dispatches emailAutoSettingsLoaded event', () => {
    const js = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/admin-settings-init.js'),
      'utf8'
    );
    expect(js).toContain('emailAutoSettingsLoaded');
    expect(js).toContain('dispatchEvent');
  });

  it('dashboard-supplier.html has Next Steps card', () => {
    const html = fs.readFileSync(
      path.join(__dirname, '../../public/dashboard-supplier.html'),
      'utf8'
    );
    expect(html).toContain('next-steps-card');
    expect(html).toContain('next-steps-list');
    expect(html).toContain('Next Steps');
  });

  it('dashboard-supplier-module.js has loadNextSteps function', () => {
    const js = fs.readFileSync(
      path.join(__dirname, '../../public/assets/js/pages/dashboard-supplier-module.js'),
      'utf8'
    );
    expect(js).toContain('loadNextSteps');
    expect(js).toContain('/api/me/action-prompt-checklist');
    expect(js).toContain('renderNextSteps');
  });
});
