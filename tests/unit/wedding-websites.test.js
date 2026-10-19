'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authRequired: (req, _res, next) => {
    req.user = { id: 'u1' };
    next();
  },
  requireVerifiedUser: (_req, _res, next) => next(),
}));
jest.mock('../../middleware/csrf', () => ({ csrfProtection: (_req, _res, next) => next() }));
jest.mock('../../middleware/rateLimits', () => ({ writeLimiter: (_req, _res, next) => next() }));

const plans = [
  {
    id: 'p1',
    userId: 'u1',
    name: 'Wedding Plan',
    weddingWebsite: { slug: 'amy-ben-2026', status: 'draft', rsvpEnabled: true },
  },
  {
    id: 'p2',
    userId: 'u1',
    name: 'Other',
    tables: [{ id: 't1', name: 'Table 1', capacity: 10, guestIds: [] }],
    guestList: [{ id: 'g1', name: 'Jane', rsvpStatus: 'attending' }],
    weddingWebsite: {
      slug: 'published-site',
      status: 'published',
      coupleNames: 'A&B',
      rsvpEnabled: true,
    },
  },
  { id: 'p4', userId: 'u1', name: 'Seating fixture', tables: [], guestList: [] },
];

jest.mock('../../db-unified', () => ({
  read: jest.fn(async col => (col === 'plans' ? plans : [])),
  find: jest.fn(async (col, filter) => {
    const arr = col === 'plans' ? plans : [];
    return arr.filter(item =>
      Object.keys(filter).every(k => {
        const keys = k.split('.');
        let val = item;
        for (const key of keys) {
          val = val?.[key];
        }
        return val === filter[k];
      })
    );
  }),
  findOne: jest.fn(async (col, filter) => {
    const arr = col === 'plans' ? plans : [];
    return (
      arr.find(item =>
        Object.keys(filter).every(k => {
          // Support dotted-path keys like 'weddingWebsite.slug'
          const keys = k.split('.');
          let val = item;
          for (const key of keys) {
            val = val?.[key];
          }
          return val === filter[k];
        })
      ) || null
    );
  }),
  insertOne: jest.fn(async (_c, doc) => {
    plans.push(doc);
    return doc;
  }),
  updateOne: jest.fn(async (_c, q, u) => {
    const p = plans.find(x => x.id === q.id);
    if (p && u.$set) {
      Object.assign(p, u.$set);
    }
    return true;
  }),
}));
jest.mock('../../store', () => ({ uid: p => `${p}_${Math.random().toString(36).slice(2, 8)}` }));

const router = require('../../routes/wedding-websites');

describe('wedding websites routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/me/plans', router);
  app.use('/api', router);

  test('blocks draft public access', async () => {
    const res = await request(app).get('/api/public/wedding-websites/amy-ben-2026');
    expect(res.status).toBe(404);
  });

  test('returns published public website safe shape', async () => {
    const res = await request(app).get('/api/public/wedding-websites/published-site');
    expect(res.status).toBe(200);
    expect(res.body.website.userId).toBeUndefined();
  });

  test('rejects RSVP honeypot and disabled/deadline', async () => {
    let res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true, website: 'spam' });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpEnabled = false;
    res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpEnabled = true;
    plans[1].weddingWebsite.rsvpDeadline = '2000-01-01';
    res = await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: true });
    expect(res.status).toBe(400);
    plans[1].weddingWebsite.rsvpDeadline = null;
  });

  test('updates duplicate RSVP by name/email', async () => {
    const before = plans[1].guestList.length;
    await request(app)
      .post('/api/public/wedding-websites/published-site/rsvp')
      .send({ guestName: 'Jane', attending: false, email: 'jane@example.com' });
    expect(plans[1].guestList.length).toBe(before);
    expect(plans[1].guestList[0].rsvpStatus).toBe('declined');
  });

  test('rejects reserved slug on patch', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ slug: 'admin' });
    expect(res.status).toBe(400);
  });

  test('rejects non-unique slug on patch', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ slug: 'published-site' });
    expect(res.status).toBe(409);
  });

  test('accepts an uploaded data-url cover image on patch', async () => {
    const coverImageUrl = `data:image/png;base64,${'a'.repeat(6000)}`;
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ coverImageUrl });

    expect(res.status).toBe(200);
    expect(res.body.website.coverImageUrl).toBe(coverImageUrl);
    expect(plans[0].weddingWebsite.coverImageUrl).toBe(coverImageUrl);
  });

  test('strips malformed uploaded cover image data urls', async () => {
    const res = await request(app)
      .patch('/api/me/plans/p1/wedding-website')
      .send({ coverImageUrl: "data:image/png;base64,abc');background:url(javascript:alert(1))" });

    expect(res.status).toBe(200);
    expect(res.body.website.coverImageUrl).toBe('');
    expect(plans[0].weddingWebsite.coverImageUrl).toBe('');
  });

  test('blocks publish when readiness checks are incomplete', async () => {
    const res = await request(app).post('/api/me/plans/p1/wedding-website/publish').send({});
    expect(res.status).toBe(400);
    expect(res.body.checklist.ready).toBe(false);
    expect(res.body.checklist.missing).toEqual(
      expect.arrayContaining(['coupleNames', 'eventDate', 'venue'])
    );
  });

  test('assign and unassign guest', async () => {
    plans[1].guestList[0].rsvpStatus = 'attending';
    let res = await request(app)
      .post('/api/me/plans/p2/tables/t1/assign-guest')
      .send({ guestId: 'g1' });
    expect(res.status).toBe(200);
    expect(plans[1].tables[0].guestIds).toContain('g1');
    res = await request(app).post('/api/me/plans/p2/tables/unassign-guest').send({ guestId: 'g1' });
    expect(res.status).toBe(200);
    expect(plans[1].tables[0].guestIds).not.toContain('g1');
  });

  test('creates standalone wedding workspace when user has no wedding plan', async () => {
    const res = await request(app).post('/api/me/plans/wedding-workspace').send({});
    expect([200, 201]).toContain(res.status);
    expect(res.body.plan).toBeTruthy();
    expect(res.body.plan.isWebsiteWorkspace).toBe(true);
    expect(res.body.plan.source).toBe('wedding_website_quick_start');
  });

  test('deleting a table unseats guests assigned to that table via guestList', async () => {
    plans[1].tables = [
      { id: 't1', name: 'Table 1', capacity: 10, guestIds: ['g1', 'g2'] },
      { id: 't2', name: 'Table 2', capacity: 10, guestIds: ['g3'] },
    ];
    plans[1].guestList = [
      { id: 'g1', name: 'Jane', rsvpStatus: 'attending', tableId: 't1', tableName: 'Table 1' },
      { id: 'g2', name: 'Joe', rsvpStatus: 'attending', table: 'Table 1' },
      { id: 'g3', name: 'June', rsvpStatus: 'attending', tableId: 't2', tableName: 'Table 2' },
    ];

    const res = await request(app).delete('/api/me/plans/p2/tables/t1');
    expect(res.status).toBe(200);
    expect(plans[1].tables).toHaveLength(1);
    expect(plans[1].tables[0].id).toBe('t2');
    expect(plans[1].guestList[0].tableId).toBeNull();
    expect(plans[1].guestList[0].tableName).toBeNull();
    expect(plans[1].guestList[0].table).toBeNull();
    expect(plans[1].guestList[1].tableId).toBeNull();
    expect(plans[1].guestList[1].tableName).toBeNull();
    expect(plans[1].guestList[1].table).toBeNull();
    expect(plans[1].guestList[2].tableId).toBe('t2');
    expect(plans[1].guestList[2].tableName).toBe('Table 2');
  });

  test('renaming a table updates the table name stored on its guests', async () => {
    plans[2].tables = [{ id: 'rt1', name: 'Old name', capacity: 10, guestIds: ['r1', 'r2'] }];
    plans[2].guestList = [
      { id: 'r1', name: 'Rae', rsvpStatus: 'attending', tableId: 'rt1', tableName: 'Old name' },
      { id: 'r2', name: 'Rob', rsvpStatus: 'attending', tableName: 'Old name' },
      { id: 'r3', name: 'Rex', rsvpStatus: 'attending', tableId: 'other', tableName: 'Elsewhere' },
    ];

    const res = await request(app)
      .patch('/api/me/plans/p4/tables/rt1')
      .send({ name: 'Family table' });
    expect(res.status).toBe(200);
    expect(plans[2].tables[0].name).toBe('Family table');
    expect(plans[2].guestList[0].tableName).toBe('Family table');
    expect(plans[2].guestList[1].tableName).toBe('Family table');
    expect(plans[2].guestList[2].tableName).toBe('Elsewhere');
  });

  test('seat-guests seats a whole batch in one write and reports what it skipped', async () => {
    const { updateOne } = require('../../db-unified');
    plans[2].tables = [
      { id: 'bt1', name: 'Bulk 1', capacity: 10, guestIds: [] },
      { id: 'bt2', name: 'Bulk 2', capacity: 10, guestIds: [] },
    ];
    plans[2].guestList = [
      { id: 'b1', name: 'Bea', rsvpStatus: 'attending' },
      { id: 'b2', name: 'Bo', rsvpStatus: 'attending' },
      { id: 'b3', name: 'Bit', rsvpStatus: 'declined' },
    ];
    updateOne.mockClear();

    const res = await request(app)
      .post('/api/me/plans/p4/tables/seat-guests')
      .send({
        assignments: [
          { guestId: 'b1', tableId: 'bt1' },
          { guestId: 'b2', tableId: 'bt2' },
          { guestId: 'b3', tableId: 'bt1' },
          { guestId: 'missing', tableId: 'bt1' },
          { guestId: 'b1', tableId: 'nope' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ seated: 2, skipped: 3 });
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(plans[2].tables[0].guestIds).toEqual(['b1']);
    expect(plans[2].tables[1].guestIds).toEqual(['b2']);
    expect(plans[2].guestList[0]).toMatchObject({ tableId: 'bt1', tableName: 'Bulk 1' });
    expect(plans[2].guestList[2].tableId).toBeUndefined();
  });

  test('seat-guests moves an already seated guest instead of seating them twice', async () => {
    const res = await request(app)
      .post('/api/me/plans/p4/tables/seat-guests')
      .send({ assignments: [{ guestId: 'b1', tableId: 'bt2' }] });
    expect(res.status).toBe(200);
    expect(plans[2].tables[0].guestIds).toEqual([]);
    expect(plans[2].tables[1].guestIds).toEqual(['b2', 'b1']);
  });

  test('seat-guests rejects an empty or oversized batch', async () => {
    let res = await request(app).post('/api/me/plans/p4/tables/seat-guests').send({});
    expect(res.status).toBe(400);
    res = await request(app)
      .post('/api/me/plans/p4/tables/seat-guests')
      .send({ assignments: Array(501).fill({ guestId: 'b1', tableId: 'bt1' }) });
    expect(res.status).toBe(400);
  });

  test('clear-seating unseats every guest and empties every table in one write', async () => {
    const { updateOne } = require('../../db-unified');
    updateOne.mockClear();
    const res = await request(app).post('/api/me/plans/p4/tables/clear-seating').send({});
    expect(res.status).toBe(200);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(plans[2].tables.every(t => t.guestIds.length === 0)).toBe(true);
    expect(plans[2].guestList.every(g => !g.tableId && !g.tableName)).toBe(true);
  });

  test('renaming a table updates the list that is read when a plan has both guest fields', async () => {
    plans[2].tables = [{ id: 'dt1', name: 'Before', capacity: 10, guestIds: ['d1'] }];
    plans[2].guestList = [
      { id: 'd1', name: 'Dee', rsvpStatus: 'attending', tableId: 'dt1', tableName: 'Before' },
    ];
    plans[2].guests = [{ id: 'old', name: 'Legacy copy', rsvpStatus: 'attending' }];

    const res = await request(app).patch('/api/me/plans/p4/tables/dt1').send({ name: 'After' });
    expect(res.status).toBe(200);
    expect(plans[2].guestList[0].tableName).toBe('After');
    expect(plans[2].guests).toEqual([{ id: 'old', name: 'Legacy copy', rsvpStatus: 'attending' }]);
    delete plans[2].guests;
  });

  test('regenerate-slug with preview suggests a link without changing the live one', async () => {
    const before = plans[1].weddingWebsite.slug;
    const res = await request(app)
      .post('/api/me/plans/p2/wedding-website/regenerate-slug')
      .send({ preview: true });
    expect(res.status).toBe(200);
    expect(typeof res.body.slug).toBe('string');
    expect(res.body.slug.length).toBeGreaterThan(0);
    expect(res.body.website).toBeUndefined();
    expect(plans[1].weddingWebsite.slug).toBe(before);
  });

  test('seating summary reflects guests unseated after table deletion', async () => {
    const res = await request(app).get('/api/me/plans/p2/seating-summary');
    expect(res.status).toBe(200);
    expect(res.body.summary.seated).toBe(1);
    expect(res.body.summary.unseated).toBe(2);
  });

  test('deleting a table updates legacy guests array compatibility', async () => {
    plans[1].guests = [
      {
        id: 'lg1',
        name: 'Legacy One',
        rsvpStatus: 'attending',
        tableId: 'lt1',
        tableName: 'Legacy T1',
      },
      { id: 'lg2', name: 'Legacy Two', rsvpStatus: 'attending', table: 'Legacy T1' },
      {
        id: 'lg3',
        name: 'Legacy Three',
        rsvpStatus: 'attending',
        tableId: 'lt2',
        tableName: 'Legacy T2',
      },
    ];
    delete plans[1].guestList;
    plans[1].tables = [
      { id: 'lt1', name: 'Legacy T1', capacity: 10, guestIds: ['lg1', 'lg2'] },
      { id: 'lt2', name: 'Legacy T2', capacity: 10, guestIds: ['lg3'] },
    ];

    const res = await request(app).delete('/api/me/plans/p2/tables/lt1');
    expect(res.status).toBe(200);
    expect(plans[1].guests[0].tableId).toBeNull();
    expect(plans[1].guests[1].table).toBeNull();
    expect(plans[1].guests[2].tableId).toBe('lt2');
    expect(plans[1].guestList).toBeUndefined();
  });
});
