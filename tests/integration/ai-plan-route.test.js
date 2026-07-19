/**
 * Integration tests for the retired first-party AI plan route.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = require('../../server');
const dbUnified = require('../../db-unified');
const { uid } = require('../../store');

const JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-key-for-testing-only-minimum-32-characters-long';

describe('Retired AI Plan Route', () => {
  let userId;
  let authToken;

  beforeAll(async () => {
    userId = uid('usr');
    const userEmail = `ai-plan-${Date.now()}@example.com`;

    const users = await dbUnified.read('users');
    users.push({
      id: userId,
      name: 'AI Plan Test User',
      firstName: 'AI',
      lastName: 'Tester',
      email: userEmail,
      role: 'customer',
      verified: true,
      passwordHash: bcrypt.hashSync('Test123!@#', 10),
      createdAt: new Date().toISOString(),
    });
    await dbUnified.write('users', users);

    authToken = jwt.sign({ id: userId, email: userEmail, role: 'customer' }, JWT_SECRET, {
      expiresIn: '1h',
    });
  });

  afterAll(async () => {
    const users = await dbUnified.read('users');
    await dbUnified.write(
      'users',
      users.filter(user => user.id !== userId)
    );
  });

  test.each(['/api/ai/plan', '/api/v1/ai/plan', '/api/ai/suggestions']) (
    'returns an explicit retirement response for %s',
    async endpoint => {
      const response = await request(app)
        .post(endpoint)
        .set('Cookie', `token=${authToken}`)
        .send({ prompt: 'Help me plan an event' })
        .expect(410);

      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual(
        expect.objectContaining({
          code: 'AI_PLANNER_RETIRED',
          assistant: 'JadeAssist',
        })
      );
    }
  );

  test('preserves authentication on the retired endpoint', async () => {
    await request(app).post('/api/v1/ai/plan').send({}).expect(401);
  });
});
