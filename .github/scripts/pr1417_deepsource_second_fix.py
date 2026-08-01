from pathlib import Path


strict_path = Path('services/partnerCashoutStrictStore.js')
strict = strict_path.read_text()
marker = "'use strict';\n\n"
assert marker in strict, 'strict store marker missing'
if marker + '(() => {\n' not in strict:
    strict = strict.replace(marker, marker + '(() => {\n', 1)
if not strict.rstrip().endswith('})();'):
    strict = strict.rstrip() + '\n\n})();\n'
for name in (
    'findOne',
    'find',
    'read',
    'insertOne',
    'updateOne',
    'deleteOne',
    'findWithOptions',
    'count',
):
    strict = strict.replace(f'async function {name}(', f'function {name}(', 1)
strict_path.write_text(strict)

service_path = Path('services/partnerCashoutOperationsService.js')
service = service_path.read_text()
service = service.replace(
    '  async function ensureAuthoritativeStorage() {\n    return strictStore.ensureAuthoritative();\n  }',
    '  function ensureAuthoritativeStorage() {\n    return strictStore.ensureAuthoritative();\n  }',
    1,
)

start = service.index('  async function reconcileRequest(')
end = service.index('\n\n  async function recordOpsEvent', start)
replacement = r"""  function invalidReconciliationResult() {
    return {
      ok: false,
      critical: true,
      issues: [issue('CASHOUT_REQUEST_IDENTITY_INVALID', 'Cashout request identity is invalid.')],
    };
  }

  function expectedPointsFor(cashoutRequest) {
    return Number(cashoutRequest.denominationGbp) * Number(cashoutRequest.pointsPerGbpSnapshot);
  }

  function collectLedgerState(transactions, cashoutRequest) {
    const holds = transactions.filter(
      transaction =>
        transaction.type === partnerService.CREDIT_TYPES.CASHOUT_HOLD &&
        transaction.externalRef === cashoutRequest.id
    );
    const hold = cashoutRequest.holdTxnId
      ? holds.find(transaction => transaction.id === cashoutRequest.holdTxnId)
      : holds[0];
    const releases = hold
      ? transactions.filter(
          transaction =>
            transaction.type === partnerService.CREDIT_TYPES.CASHOUT_RELEASE &&
            transaction.externalRef === hold.id
        )
      : [];
    const redeems = transactions.filter(
      transaction =>
        transaction.type === partnerService.CREDIT_TYPES.REDEEM &&
        transaction.externalRef === cashoutRequest.id
    );
    const adjustmentType = partnerService.CREDIT_TYPES.ADJUSTMENT || 'ADJUSTMENT';
    const redeemReversals = redeems.flatMap(redeem =>
      transactions.filter(
        transaction =>
          transaction.type === adjustmentType &&
          transaction.subtype === 'CASHOUT_REDEEM_REVERSAL' &&
          transaction.externalRef === redeem.id
      )
    );
    return { holds, hold, releases, redeems, redeemReversals };
  }

  function appendSnapshotIssue(issues, cashoutRequest, expectedPoints) {
    if (
      Number.isFinite(expectedPoints) &&
      expectedPoints > 0 &&
      Number(cashoutRequest.pointsHeld) === expectedPoints
    ) {
      return;
    }
    issues.push(
      issue(
        'CASHOUT_POINTS_SNAPSHOT_MISMATCH',
        'Cashout held points do not match the denomination snapshot.',
        'error',
        {
          expectedPoints: Number.isFinite(expectedPoints) ? expectedPoints : null,
          pointsHeld: cashoutRequest.pointsHeld,
        }
      )
    );
  }

  function appendHoldIssues(issues, cashoutRequest, holds, hold) {
    if (holds.length !== 1 || !hold) {
      issues.push(
        issue(
          'CASHOUT_HOLD_INTEGRITY_FAILED',
          'Cashout must have exactly one matching hold transaction.',
          'error',
          {
            holdCount: holds.length,
            storedHoldTxnId: cashoutRequest.holdTxnId || null,
          }
        )
      );
      return;
    }
    if (
      Number.isFinite(Number(cashoutRequest.pointsHeld)) &&
      Number(hold.amount) !== -Math.abs(Number(cashoutRequest.pointsHeld))
    ) {
      issues.push(
        issue('CASHOUT_HOLD_AMOUNT_MISMATCH', 'Cashout hold amount does not match held points.')
      );
    }
  }

  function appendLedgerShapeIssues(issues, cashoutRequest, releases, redeems) {
    if (redeems.length > 1) {
      issues.push(
        issue(
          'CASHOUT_REDEEM_DUPLICATED',
          'Cashout has more than one permanent redemption debit.',
          'error',
          { redeemCount: redeems.length }
        )
      );
    }
    if (releases.length > 1) {
      issues.push(
        issue(
          'CASHOUT_RELEASE_DUPLICATED',
          'Cashout hold has been released more than once.',
          'error',
          { releaseCount: releases.length }
        )
      );
    }
    if (
      redeems.length === 1 &&
      Number(redeems[0].amount) !== -Math.abs(Number(cashoutRequest.pointsHeld))
    ) {
      issues.push(
        issue(
          'CASHOUT_REDEEM_AMOUNT_MISMATCH',
          'Cashout redemption amount does not match held points.'
        )
      );
    }
    if (
      releases.length === 1 &&
      Number(releases[0].amount) !== Math.abs(Number(cashoutRequest.pointsHeld))
    ) {
      issues.push(
        issue(
          'CASHOUT_RELEASE_AMOUNT_MISMATCH',
          'Cashout hold release amount does not match held points.'
        )
      );
    }
    if (
      cashoutRequest.finalRedeemTxnId &&
      redeems.length === 1 &&
      redeems[0].id !== cashoutRequest.finalRedeemTxnId
    ) {
      issues.push(
        issue(
          'CASHOUT_REDEEM_ID_MISMATCH',
          'Stored final redemption ID does not match the cashout ledger debit.'
        )
      );
    }
  }

  function appendActiveStatusIssues(
    issues,
    cashoutRequest,
    targetStatus,
    releases,
    redeems,
    redeemReversals
  ) {
    const active = ['submitted', 'approved', 'processing'].includes(cashoutRequest.status);
    if (!active) return false;
    const deliveryRecovery = cashoutRequest.status === 'processing' && targetStatus === 'delivered';
    if (deliveryRecovery) {
      if (releases.length > 0 && redeems.length === 0) {
        issues.push(
          issue(
            'CASHOUT_RELEASE_WITHOUT_REDEEM',
            'Cashout hold was released before a matching permanent redemption existed.'
          )
        );
      }
      if (redeemReversals.length > 0) {
        issues.push(
          issue(
            'CASHOUT_DELIVERY_REDEEM_REVERSED',
            'A cashout being delivered contains a prior redemption reversal and requires manual repair.'
          )
        );
      }
      return true;
    }
    if (releases.length > 0) {
      issues.push(
        issue('CASHOUT_HOLD_ALREADY_RELEASED', 'An active cashout has already released its hold.')
      );
    }
    if (redeems.length > 0) {
      issues.push(
        issue('CASHOUT_REDEEM_PREMATURE', 'An undelivered cashout already has a redemption debit.')
      );
    }
    return false;
  }

  function appendDeliveredStatusIssues(issues, cashoutRequest, releases, redeems, redeemReversals) {
    if (cashoutRequest.status !== 'delivered') return;
    if (redeems.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_REDEEM_INVALID',
          'Delivered cashout must have exactly one redemption debit.',
          'error',
          { redeemCount: redeems.length }
        )
      );
    }
    if (releases.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_RELEASE_INVALID',
          'Delivered cashout must have exactly one hold release.',
          'error',
          { releaseCount: releases.length }
        )
      );
    }
    if (redeemReversals.length > 0) {
      issues.push(
        issue(
          'CASHOUT_DELIVERED_REDEEM_REVERSED',
          'Delivered cashout contains a redemption reversal and is financially inconsistent.'
        )
      );
    }
  }

  function appendRejectedStatusIssues(issues, cashoutRequest, hold, releases, redeems, reversals) {
    if (cashoutRequest.status !== 'rejected' || !hold) return;
    if (releases.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_REJECTED_RELEASE_INVALID',
          'Rejected cashout must release its hold exactly once.',
          'error',
          { releaseCount: releases.length }
        )
      );
    }
    if (redeems.length !== 1) return;
    if (reversals.length !== 1) {
      issues.push(
        issue(
          'CASHOUT_REJECTED_REDEEM_REVERSAL_INVALID',
          'Rejected cashout with an interrupted redemption must contain exactly one matching reversal.',
          'error',
          { reversalCount: reversals.length }
        )
      );
      return;
    }
    if (Number(reversals[0].amount) !== Math.abs(Number(redeems[0].amount))) {
      issues.push(
        issue(
          'CASHOUT_REJECTED_REDEEM_REVERSAL_AMOUNT_MISMATCH',
          'Rejected cashout redemption reversal does not restore the original debit amount.'
        )
      );
    }
  }

  function recoveryStateFor(deliveryRecovery, releases, redeems) {
    if (!deliveryRecovery || redeems.length !== 1) return 'none';
    if (releases.length === 0) return 'redeem_persisted';
    if (releases.length === 1) return 'redeem_and_release_persisted';
    return 'none';
  }

  async function reconcileRequest(cashoutRequest, options = {}) {
    await ensureAuthoritativeStorage();
    if (!cashoutRequest?.id || !cashoutRequest.partnerId) return invalidReconciliationResult();

    const targetStatus = options?.targetStatus || null;
    const issues = [];
    const transactions =
      (await strictStore.find('partner_credit_transactions', {
        partnerId: cashoutRequest.partnerId,
      })) || [];
    const expectedPoints = expectedPointsFor(cashoutRequest);
    const ledger = collectLedgerState(transactions, cashoutRequest);

    appendSnapshotIssue(issues, cashoutRequest, expectedPoints);
    appendHoldIssues(issues, cashoutRequest, ledger.holds, ledger.hold);
    appendLedgerShapeIssues(issues, cashoutRequest, ledger.releases, ledger.redeems);
    const deliveryRecovery = appendActiveStatusIssues(
      issues,
      cashoutRequest,
      targetStatus,
      ledger.releases,
      ledger.redeems,
      ledger.redeemReversals
    );
    appendDeliveredStatusIssues(
      issues,
      cashoutRequest,
      ledger.releases,
      ledger.redeems,
      ledger.redeemReversals
    );
    appendRejectedStatusIssues(
      issues,
      cashoutRequest,
      ledger.hold,
      ledger.releases,
      ledger.redeems,
      ledger.redeemReversals
    );

    return {
      ok: issues.length === 0,
      critical: issues.some(item => item.severity === 'error'),
      issues,
      targetStatus,
      recoveryState: recoveryStateFor(deliveryRecovery, ledger.releases, ledger.redeems),
      metrics: {
        holdCount: ledger.holds.length,
        releaseCount: ledger.releases.length,
        redeemCount: ledger.redeems.length,
        redeemReversalCount: ledger.redeemReversals.length,
        expectedPoints: Number.isFinite(expectedPoints) ? expectedPoints : null,
      },
      reconciledAt: new Date().toISOString(),
    };
  }"""
service = service[:start] + replacement + service[end:]
service_path.write_text(service)
