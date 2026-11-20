'use strict';

/**
 * Package images saved before #1884/#1887 can still hold a base64 image or, worse, a
 * `javascript:` URL or HTML. Carousel escaping protects rendering and new writes are
 * validated, but nothing cleaned up what was already stored. The repair tool could only
 * be pointed at one supplier or a hand-typed list of ids, so there was no way to find them.
 */

const {
  findUnsafePackageImageValues,
  repairPackageImages,
  summariseRepairReport,
} = require('../../utils/packageImageRepair');

const PNG_DATA_URI = 'data:image/png;base64,QUJDRA==';

describe('findUnsafePackageImageValues', () => {
  it('finds a javascript: URL and an HTML payload, with where they are', () => {
    const found = findUnsafePackageImageValues({
      id: 'p1',
      image: 'javascript:alert(1)',
      gallery: [{ url: '/api/photos/ok' }, { url: '"><img src=x onerror=alert(1)>' }],
    });
    expect(found).toEqual(
      expect.arrayContaining([
        { source: 'pkg.image', reason: 'javascript-url' },
        { source: 'pkg.gallery[1].url', reason: 'html-payload' },
      ])
    );
  });

  it('reports the path and reason only, never the value', () => {
    const found = findUnsafePackageImageValues({ id: 'p1', image: 'javascript:alert(1)' });
    expect(JSON.stringify(found)).not.toContain('alert(1)');
    for (const entry of found) {
      expect(Object.keys(entry).sort()).toEqual(['reason', 'source']);
    }
  });

  it('reports nothing for clean, empty, placeholder and data-URI images', () => {
    expect(findUnsafePackageImageValues({ id: 'a', image: '/api/photos/ok' })).toEqual([]);
    expect(findUnsafePackageImageValues({ id: 'b' })).toEqual([]);
    expect(findUnsafePackageImageValues({ id: 'c', image: '' })).toEqual([]);
    // A data URI is repairable, not unsafe: it is converted, not flagged.
    expect(findUnsafePackageImageValues({ id: 'd', image: PNG_DATA_URI })).toEqual([]);
  });
});

describe('repairPackageImages report', () => {
  const packages = [
    { id: 'clean', image: '/api/photos/ok' },
    { id: 'data', image: PNG_DATA_URI },
    { id: 'unsafe', image: 'javascript:alert(1)' },
    { id: 'empty' },
  ];

  it('counts unsafe packages without changing or writing them', async () => {
    const dbUnified = { updateOne: jest.fn() };
    const report = await repairPackageImages(packages, { dryRun: true, dbUnified });
    expect(report.scanned).toBe(4);
    expect(report.changed).toBe(0);
    expect(report.unsafePackages).toBe(1);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
    expect(report.results.find(r => r.id === 'unsafe').unsafe).toEqual([
      { source: 'pkg.image', reason: 'javascript-url' },
    ]);
  });

  it('does not clear an unsafe value even when applying', async () => {
    const dbUnified = { updateOne: jest.fn().mockResolvedValue(true) };
    const photoUpload = {
      processAndSaveImage: jest.fn().mockResolvedValue({ optimized: '/api/photos/new' }),
    };
    const report = await repairPackageImages([packages[2]], {
      dryRun: false,
      dbUnified,
      photoUpload,
    });
    expect(report.changed).toBe(0);
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
    expect(report.unsafePackages).toBe(1);
  });

  describe('summariseRepairReport', () => {
    it('is small: counts plus one short line per package needing attention', async () => {
      const report = await repairPackageImages(packages, { dryRun: true });
      const summary = summariseRepairReport(report);
      expect(summary).toMatchObject({
        dryRun: true,
        scanned: 4,
        changed: 0,
        wouldConvertDataUri: 1,
        alreadyHasUsableImage: 1,
        unsafePackages: 1,
      });
      expect(summary.needsAttention.map(item => item.id).sort()).toEqual(['data', 'unsafe']);
      // The whole point: the base64 image must not be in the summary.
      expect(JSON.stringify(summary)).not.toContain('QUJDRA==');
      expect(JSON.stringify(summary)).not.toContain('alert(1)');
    });
  });
});

describe('scripts/repair-package-images.js', () => {
  const script = require('../../scripts/repair-package-images');

  describe('arguments', () => {
    it('parses each way of choosing packages and the flags', () => {
      expect(script.parseArgs(['--all', '--apply', '--verbose', '--limit=7'])).toMatchObject({
        all: true,
        apply: true,
        verbose: true,
        limit: 7,
      });
      expect(script.parseArgs(['--supplierId=s1']).supplierId).toBe('s1');
      expect(script.parseArgs(['--packageIds=a, b ,,c']).packageIds).toEqual(['a', 'b', 'c']);
      expect(script.parseArgs([]).limit).toBe(Infinity);
      expect(script.parseArgs(['--limit=abc']).limit).toBe(Infinity);
    });

    it('requires exactly one way of choosing packages', () => {
      expect(() => script.validateArgs(script.parseArgs([]))).toThrow(/--all/);
      expect(() => script.validateArgs(script.parseArgs(['--all', '--supplierId=s1']))).toThrow(
        /only one/
      );
      expect(() =>
        script.validateArgs(script.parseArgs(['--packageIds=a', '--supplierId=s1']))
      ).toThrow(/only one/);
      for (const argv of [['--all'], ['--supplierId=s1'], ['--packageIds=a']]) {
        expect(() => script.validateArgs(script.parseArgs(argv))).not.toThrow();
      }
    });

    it('marks usage mistakes so they print a message instead of a stack trace', () => {
      try {
        script.validateArgs(script.parseArgs([]));
      } catch (error) {
        expect(error.usage).toBe(true);
      }
    });
  });

  describe('selectPackages', () => {
    const all = [
      { id: 'a', supplierId: 's1' },
      { id: 'b', supplierId: 's2' },
      { id: 'c', supplierId: 's1' },
    ];
    const db = () => ({
      find: jest.fn(async (_collection, filter) =>
        all.filter(pkg => !filter.supplierId || pkg.supplierId === filter.supplierId)
      ),
      findOne: jest.fn(async (_collection, { id }) => all.find(pkg => pkg.id === id) || null),
    });

    it('--all reads every package', async () => {
      const result = await script.selectPackages(script.parseArgs(['--all']), db());
      expect(result.map(pkg => pkg.id)).toEqual(['a', 'b', 'c']);
    });

    it('--supplierId reads only that supplier’s packages', async () => {
      const result = await script.selectPackages(script.parseArgs(['--supplierId=s1']), db());
      expect(result.map(pkg => pkg.id)).toEqual(['a', 'c']);
    });

    it('--packageIds skips ids that do not exist', async () => {
      const result = await script.selectPackages(script.parseArgs(['--packageIds=a,zzz,b']), db());
      expect(result.map(pkg => pkg.id)).toEqual(['a', 'b']);
    });

    it('--limit stops after n packages', async () => {
      const result = await script.selectPackages(script.parseArgs(['--all', '--limit=2']), db());
      expect(result).toHaveLength(2);
    });
  });
});

describe('scripts/repair-package-images.js main()', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../../db-unified');
  });

  function loadWith(databaseType) {
    jest.resetModules();
    const dbUnified = {
      find: jest.fn(async () => [{ id: 'p1', supplierId: 's1', image: PNG_DATA_URI }]),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      getDatabaseType: jest.fn(() => databaseType),
    };
    jest.doMock('../../db-unified', () => dbUnified);
    jest.doMock('../../config/database', () => ({ initializeDatabase: jest.fn(async () => {}) }));
    jest.doMock('../../photo-upload', () => ({ processAndSaveImage: jest.fn() }));
    jest.doMock('../../routes/suppliers', () => ({ invalidatePackageCaches: jest.fn() }));
    return { dbUnified, script: require('../../scripts/repair-package-images') };
  }

  it('refuses --apply against local storage, so a dev machine is never "repaired"', async () => {
    const { script, dbUnified } = loadWith('local');
    await expect(script.main(['--all', '--apply'])).rejects.toThrow(/Refusing to --apply/);
    expect(dbUnified.find).not.toHaveBeenCalled();
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });

  it('dry-runs --all on any backend and prints the short summary, not the base64 image', async () => {
    const { script, dbUnified } = loadWith('local');
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await script.main(['--all']);
    const printed = log.mock.calls.map(call => call.join(' ')).join('\n');
    log.mockRestore();
    expect(JSON.parse(printed)).toMatchObject({ dryRun: true, scanned: 1, wouldConvertDataUri: 1 });
    expect(printed).not.toContain('QUJDRA==');
    expect(dbUnified.updateOne).not.toHaveBeenCalled();
  });
});
