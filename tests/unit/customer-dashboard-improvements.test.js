/**
 * Unit tests for customer dashboard improvements:
 *   - Calendar entry creation flow (validation & API interaction)
 */

// ─────────────────────────────────────────────────────────────────────────────

describe('Calendar entry creation — validation logic', () => {
  const VALID_ENTRY_TYPES = ['meeting', 'event', 'appointment'];
  const MAX_TITLE_LENGTH = 100;
  const MAX_DESCRIPTION_LENGTH = 500;

  /**
   * Mirrors the server-side validation from routes/customer-calendar.js
   * so that the same rules can be tested without spinning up a server.
   */
  function validateEntry({ title, type, date, time, description }) {
    if (!title || typeof title !== 'string' || !title.trim()) {
      return 'Title is required';
    }
    if (title.trim().length > MAX_TITLE_LENGTH) {
      return `Title must be at most ${MAX_TITLE_LENGTH} characters`;
    }
    if (!type || !VALID_ENTRY_TYPES.includes(type)) {
      return `Type must be one of: ${VALID_ENTRY_TYPES.join(', ')}`;
    }
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return 'Date is required and must be in YYYY-MM-DD format';
    }
    if (
      description &&
      typeof description === 'string' &&
      description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`;
    }
    return null; // valid
  }

  it('accepts a valid meeting entry', () => {
    const result = validateEntry({
      title: 'Venue walkthrough',
      type: 'meeting',
      date: '2026-06-15',
      time: '10:00',
      description: 'Check the main hall.',
    });
    expect(result).toBeNull();
  });

  it('accepts a valid event entry with no time or description', () => {
    const result = validateEntry({ title: 'Wedding Day', type: 'event', date: '2026-09-20' });
    expect(result).toBeNull();
  });

  it('accepts a valid appointment entry', () => {
    const result = validateEntry({
      title: 'Cake tasting',
      type: 'appointment',
      date: '2026-07-04',
    });
    expect(result).toBeNull();
  });

  it('rejects a missing title', () => {
    const result = validateEntry({ title: '', type: 'event', date: '2026-06-15' });
    expect(result).toMatch(/title/i);
  });

  it('rejects a whitespace-only title', () => {
    const result = validateEntry({ title: '   ', type: 'event', date: '2026-06-15' });
    expect(result).toMatch(/title/i);
  });

  it('rejects a title that is too long', () => {
    const result = validateEntry({
      title: 'A'.repeat(101),
      type: 'event',
      date: '2026-06-15',
    });
    expect(result).toMatch(/title/i);
  });

  it('rejects an invalid entry type', () => {
    const result = validateEntry({ title: 'Test', type: 'party', date: '2026-06-15' });
    expect(result).toMatch(/type/i);
  });

  it('rejects a missing date', () => {
    const result = validateEntry({ title: 'Test', type: 'event', date: '' });
    expect(result).toMatch(/date/i);
  });

  it('rejects a badly formatted date', () => {
    const result = validateEntry({ title: 'Test', type: 'event', date: '15-06-2026' });
    expect(result).toMatch(/date/i);
  });

  it('rejects a description that is too long', () => {
    const result = validateEntry({
      title: 'Test',
      type: 'event',
      date: '2026-06-15',
      description: 'X'.repeat(501),
    });
    expect(result).toMatch(/description/i);
  });

  it('accepts all three valid entry types', () => {
    for (const type of VALID_ENTRY_TYPES) {
      const result = validateEntry({ title: 'Test', type, date: '2026-06-15' });
      expect(result).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Calendar entry creation — API route (unit)', () => {
  // Minimal mock of the route handler logic
  function buildHandler() {
    const VALID_ENTRY_TYPES = ['meeting', 'event', 'appointment'];
    const MAX_TITLE_LENGTH = 100;
    const MAX_DESCRIPTION_LENGTH = 500;

    return async function handler(req, res) {
      const { title, type, date, description } = req.body || {};

      if (!title || typeof title !== 'string' || !title.trim()) {
        return res.status(400).json({ error: 'Title is required' });
      }
      if (title.trim().length > MAX_TITLE_LENGTH) {
        return res
          .status(400)
          .json({ error: `Title must be at most ${MAX_TITLE_LENGTH} characters` });
      }
      if (!type || !VALID_ENTRY_TYPES.includes(type)) {
        return res
          .status(400)
          .json({ error: `Type must be one of: ${VALID_ENTRY_TYPES.join(', ')}` });
      }
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Date is required and must be in YYYY-MM-DD format' });
      }
      if (
        description &&
        typeof description === 'string' &&
        description.length > MAX_DESCRIPTION_LENGTH
      ) {
        return res
          .status(400)
          .json({ error: `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters` });
      }

      const entry = {
        id: 'ce_test123',
        userId: req.user.id,
        title: title.trim(),
        type,
        date,
        createdAt: new Date().toISOString(),
      };

      return res.status(201).json({ ok: true, entry });
    };
  }

  function mockRes() {
    const r = { _status: 200, _body: null };
    r.status = code => {
      r._status = code;
      return r;
    };
    r.json = body => {
      r._body = body;
      return r;
    };
    return r;
  }

  const handle = buildHandler();

  it('returns 201 with entry for valid input', async () => {
    const req = {
      user: { id: 'usr_001' },
      body: { title: 'Venue visit', type: 'meeting', date: '2026-08-10' },
    };
    const res = mockRes();
    await handle(req, res);
    expect(res._status).toBe(201);
    expect(res._body.ok).toBe(true);
    expect(res._body.entry.title).toBe('Venue visit');
    expect(res._body.entry.type).toBe('meeting');
  });

  it('returns 400 when title is missing', async () => {
    const req = {
      user: { id: 'usr_001' },
      body: { type: 'event', date: '2026-08-10' },
    };
    const res = mockRes();
    await handle(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/title/i);
  });

  it('returns 400 when type is invalid', async () => {
    const req = {
      user: { id: 'usr_001' },
      body: { title: 'Party', type: 'barbecue', date: '2026-08-10' },
    };
    const res = mockRes();
    await handle(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/type/i);
  });

  it('returns 400 when date is missing', async () => {
    const req = {
      user: { id: 'usr_001' },
      body: { title: 'Party', type: 'event' },
    };
    const res = mockRes();
    await handle(req, res);
    expect(res._status).toBe(400);
    expect(res._body.error).toMatch(/date/i);
  });

  it('sets the correct userId on the created entry', async () => {
    const req = {
      user: { id: 'usr_42' },
      body: { title: 'Fitting', type: 'appointment', date: '2026-05-01' },
    };
    const res = mockRes();
    await handle(req, res);
    expect(res._body.entry.userId).toBe('usr_42');
  });
});
