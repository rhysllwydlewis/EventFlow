from pathlib import Path

def replace_once(path, old, new):
    file_path = Path(path)
    text = file_path.read_text()
    if old not in text:
        raise SystemExit(f"Expected source block not found in {path}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1))

replace_once(
    ".github/workflows/admin-analytics-decision-validation.yml",
    """      - 'public/assets/js/pages/admin-analytics-init.js'
      - 'public/assets/js/pages/admin-analytics-decision.js'""",
    """      - 'public/assets/js/pages/admin-analytics-init.js'
      - 'public/assets/js/pages/admin-analytics-decision.js'
      - 'public/assets/js/behaviour-analytics.js'""",
)
replace_once(
    ".github/workflows/admin-analytics-decision-validation.yml",
    """          node --check public/assets/js/pages/admin-analytics-init.js
          node --check public/assets/js/pages/admin-analytics-decision.js""",
    """          node --check public/assets/js/pages/admin-analytics-init.js
          node --check public/assets/js/pages/admin-analytics-decision.js
          node --check public/assets/js/behaviour-analytics.js""",
)
replace_once(
    ".github/workflows/admin-analytics-decision-validation.yml",
    """          public/assets/js/pages/admin-analytics-init.js
          public/assets/js/pages/admin-analytics-decision.js
          tests/unit/behaviour-analytics-decision.test.js""",
    """          public/assets/js/pages/admin-analytics-init.js
          public/assets/js/pages/admin-analytics-decision.js
          public/assets/js/behaviour-analytics.js
          tests/unit/behaviour-analytics-decision.test.js""",
)
replace_once(
    ".github/workflows/admin-analytics-decision-validation.yml",
    """          public/assets/js/pages/admin-analytics-init.js
          public/assets/js/pages/admin-analytics-decision.js
          public/assets/css/admin-analytics-decision.css""",
    """          public/assets/js/pages/admin-analytics-init.js
          public/assets/js/pages/admin-analytics-decision.js
          public/assets/js/behaviour-analytics.js
          public/assets/css/admin-analytics-decision.css""",
)

replace_once(
    "tests/unit/behaviour-analytics-decision.test.js",
    """  test('uses completed lead sessions rather than starts to produce bounded marketplace rates', () => {""",
    """  test('deduplicates homepage sessions across grouped live aliases', () => {
    const homepageEvents = [
      {
        event: 'page_view',
        sessionIdHash: 'homepage-session',
        pagePath: '/',
        pageType: 'home',
        timestamp: '2026-07-14T10:00:00.000Z',
        properties: {},
      },
      {
        event: 'page_engagement',
        sessionIdHash: 'homepage-session',
        pagePath: '/',
        pageType: 'home',
        timestamp: '2026-07-14T10:00:10.000Z',
        properties: { activeSeconds: 12 },
      },
      {
        event: 'page_view',
        sessionIdHash: 'homepage-session',
        pagePath: '/index.html',
        pageType: 'home',
        timestamp: '2026-07-14T10:00:20.000Z',
        properties: {},
      },
    ];

    const live = buildHomepagePerformance({}, homepageEvents).find(row => row.key === 'live');
    expect(live).toEqual(
      expect.objectContaining({
        views: 2,
        sessions: 1,
        avgActiveSeconds: 12,
        engagedRate: 100,
      })
    );
    expect(live.paths).toEqual(expect.arrayContaining(['/', '/index.html']));
  });

  test('uses completed lead sessions rather than starts to produce bounded marketplace rates', () => {""",
)
replace_once(
    "tests/unit/behaviour-analytics-decision.test.js",
    """    const initScript = fs.readFileSync(
      path.join(root, 'public/assets/js/pages/admin-analytics-init.js'),
      'utf8'
    );
    expect(decisionScript).toContain('offsetDays=${encodeURIComponent(days)}');
    expect(decisionScript).toContain('retentionDays >= days * 2');
    expect(initScript).toContain('Stripe Revenue (Latest Charges)');
    expect(initScript).toContain('latest 100 charges');""",
    """    const initScript = fs.readFileSync(
      path.join(root, 'public/assets/js/pages/admin-analytics-init.js'),
      'utf8'
    );
    const collectorScript = fs.readFileSync(
      path.join(root, 'public/assets/js/behaviour-analytics.js'),
      'utf8'
    );
    const routeSource = fs.readFileSync(
      path.join(root, 'routes/behaviour-analytics.js'),
      'utf8'
    );
    expect(decisionScript).toContain('offsetDays=${encodeURIComponent(days)}');
    expect(decisionScript).toContain('retentionDays < days * 2');
    expect(decisionScript).toContain('earliestEventAt');
    expect(decisionScript).toContain('/supplier?id=${encodeURIComponent(id)}');
    expect(decisionScript).toContain('/^\\s*[=+\\-@]/');
    expect(collectorScript).toContain('function currentEntityContext()');
    expect(collectorScript).toContain("supplierId: linkContext.supplierId");
    expect(collectorScript).toContain("packageId: linkContext.packageId");
    expect(routeSource).toContain('earliestEventAt');
    expect(initScript).toContain('Stripe Revenue (Latest Charges)');
    expect(initScript).toContain('latest 100 charges');""",
)

replace_once(
    "docs/analytics/admin-analytics-decision-dashboard.md",
    """A previous-period comparison is shown only when the configured retention period contains the full current and preceding windows. For example, comparing the latest 90 days with the preceding 90 days requires at least 180 days of retained analytics. Current-period figures remain available when the comparison window is incomplete.""",
    """A previous-period comparison is shown only when both the configured retention period and the earliest stored event demonstrate that the full current and preceding windows are available. For example, comparing the latest 90 days with the preceding 90 days requires at least 180 days of retention and stored history reaching the beginning of the preceding window. Current-period figures remain available when the comparison window is incomplete.""",
)
replace_once(
    "docs/analytics/admin-analytics-decision-dashboard.md",
    """Rows are omitted rather than inferred when an event did not contain an entity ID.""",
    """Public supplier and package pages now attach only their known public entity identifier to the existing sanitised view event. Result clicks, saves and enquiry starts also carry the nearest known public entity identifier. Query strings themselves remain excluded. Rows are omitted rather than inferred when an event did not contain an entity ID.""",
)
replace_once(
    "docs/analytics/admin-analytics-decision-dashboard.md",
    """The selected current period can be exported as CSV. The export includes headline totals, conversion types, homepage-path performance and available supplier/package signals.""",
    """The selected current period can be exported as CSV. The export includes headline totals, conversion types, homepage-path performance and available supplier/package signals. Cells beginning with spreadsheet formula characters are prefixed safely before download to prevent formula execution when an administrator opens the file.""",
)
