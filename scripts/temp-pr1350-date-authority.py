from pathlib import Path


def replace(path, old, new, count=1):
    target = Path(path)
    text = target.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(
            f"{path}: expected {count} match(es), found {actual}: {old[:120]!r}"
        )
    target.write_text(text.replace(old, new, count))


replace(
    "routes/admin.js",
    "      const result = await dateService.performMonthlyCheck({ trigger: 'manual' });",
    "      const result = await dateService.performMonthlyCheck({\n"
    "        trigger: 'manual',\n"
    "        userId: req.user.id || req.user.email,\n"
    "      });",
)

replace(
    "services/dateManagementService.js",
    "   * @returns {Promise<Object>} Check result\n"
    "   */\n"
    "  async performMonthlyCheck() {",
    "   * @param {Object} [options] - Execution context\n"
    "   * @param {'scheduler'|'manual'} [options.trigger='scheduler'] - Execution source\n"
    "   * @param {string} [options.userId='system'] - Actor for manual audit attribution\n"
    "   * @returns {Promise<Object>} Check result\n"
    "   */\n"
    "  async performMonthlyCheck({ trigger = 'scheduler', userId = 'system' } = {}) {",
)
replace(
    "services/dateManagementService.js",
    "      // Update dates\n"
    "      const updateResult = await this.updateLegalDates({\n"
    "        lastUpdated: changeCheck.gitDate,\n"
    "        effectiveDate: changeCheck.gitDate,\n"
    "        manual: false,\n"
    "        userId: 'system',\n"
    "      });",
    "      // Update dates\n"
    "      const manual = trigger === 'manual';\n"
    "      const updateResult = await this.updateLegalDates({\n"
    "        lastUpdated: changeCheck.gitDate,\n"
    "        effectiveDate: changeCheck.gitDate,\n"
    "        manual,\n"
    "        userId: manual ? userId : 'system',\n"
    "      });",
)
replace(
    "services/dateManagementService.js",
    "        await this.notifyAdmins({\n"
    "          type: 'AUTO_UPDATE',",
    "        await this.notifyAdmins({\n"
    "          type: manual ? 'MANUAL_UPDATE' : 'AUTO_UPDATE',",
)

replace(
    "services/backgroundJobTelemetry.service.js",
    "  const schedulerHistory = ordered.filter(\n"
    "    run => run.trigger !== 'manual' && run.trigger !== 'dry-run'\n"
    "  );\n"
    "  const latest = ordered[0] || null;",
    "  const hasSharedTelemetry = ordered.some(run => run.source === COLLECTION);\n"
    "  const authoritativeHistory = hasSharedTelemetry\n"
    "    ? ordered.filter(run => run.source === COLLECTION)\n"
    "    : ordered;\n"
    "  const schedulerHistory = authoritativeHistory.filter(\n"
    "    run => run.trigger !== 'manual' && run.trigger !== 'dry-run'\n"
    "  );\n"
    "  const latest = authoritativeHistory[0] || null;",
)

replace(
    "tests/unit/background-job-trigger-attribution.test.js",
    "        if (collection === COLLECTION) {\n"
    "          return [\n"
    "            {\n"
    "              id: 'manual-date-run',\n"
    "              jobKey: JOB_KEYS.DATE_MANAGEMENT,\n"
    "              status: 'success',\n"
    "              trigger: 'manual',\n"
    "              startedAt: '2026-07-17T11:59:00.000Z',\n"
    "              finishedAt: '2026-07-17T11:59:01.000Z',\n"
    "            },\n"
    "          ];\n"
    "        }\n"
    "        return [];",
    "        if (collection === COLLECTION) {\n"
    "          return [\n"
    "            {\n"
    "              id: 'manual-date-run',\n"
    "              jobKey: JOB_KEYS.DATE_MANAGEMENT,\n"
    "              status: 'success',\n"
    "              trigger: 'manual',\n"
    "              startedAt: '2026-07-17T11:59:00.000Z',\n"
    "              finishedAt: '2026-07-17T11:59:01.000Z',\n"
    "            },\n"
    "          ];\n"
    "        }\n"
    "        if (collection === 'audit_logs') {\n"
    "          return [\n"
    "            {\n"
    "              action: 'AUTO_DATE_UPDATE',\n"
    "              timestamp: '2026-07-17T11:59:30.000Z',\n"
    "            },\n"
    "          ];\n"
    "        }\n"
    "        return [];",
)
replace(
    "tests/unit/background-job-trigger-attribution.test.js",
    "    expect(job.history[0].trigger).toBe('manual');",
    "    expect(job.history).toEqual(\n"
    "      expect.arrayContaining([expect.objectContaining({ trigger: 'manual' })])\n"
    "    );",
)
replace(
    "tests/unit/background-job-trigger-attribution.test.js",
    "    const scheduler = fs.readFileSync(path.join(root, 'services/actionPromptScheduler.js'), 'utf8');",
    "    const scheduler = fs.readFileSync(path.join(root, 'services/actionPromptScheduler.js'), 'utf8');\n"
    "    const dateService = fs.readFileSync(path.join(root, 'services/dateManagementService.js'), 'utf8');",
)
replace(
    "tests/unit/background-job-trigger-attribution.test.js",
    "    expect(admin).toContain(\"performMonthlyCheck({ trigger: 'manual' })\");",
    "    expect(admin).toContain(\"trigger: 'manual'\");\n"
    "    expect(admin).toContain('userId: req.user.id || req.user.email');",
)
replace(
    "tests/unit/background-job-trigger-attribution.test.js",
    "    expect(scheduler).toContain('getSupplierActionItems({ telemetryTrigger: trigger })');",
    "    expect(scheduler).toContain('getSupplierActionItems({ telemetryTrigger: trigger })');\n"
    "    expect(dateService).toContain(\"const manual = trigger === 'manual'\");\n"
    "    expect(dateService).toContain(\"type: manual ? 'MANUAL_UPDATE' : 'AUTO_UPDATE'\");",
)
