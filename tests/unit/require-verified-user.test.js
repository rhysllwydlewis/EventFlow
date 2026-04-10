/**
 * Unit tests for requireVerifiedUser middleware
 */

'use strict';

const mockFindOne = jest.fn();

jest.mock('../../db-unified', () => ({
  findOne: mockFindOne,
}));

// Must import AFTER mocking db-unified
const { requireVerifiedUser } = require('../../middleware/auth');

describe('requireVerifiedUser middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = {
      user: { id: 'user-1', email: 'test@example.com', role: 'supplier' },
      path: '/test',
      method: 'POST',
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
    mockFindOne.mockReset();
  });

  it('should call next() for a verified user', async () => {
    mockFindOne.mockResolvedValue({ id: 'user-1', verified: true });

    await requireVerifiedUser(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should return 403 with EMAIL_NOT_VERIFIED code for an unverified user', async () => {
    mockFindOne.mockResolvedValue({ id: 'user-1', verified: false });

    await requireVerifiedUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'EMAIL_NOT_VERIFIED',
        error: 'Email not verified',
      })
    );
  });

  it('should return 403 when verified field is missing (falsy)', async () => {
    mockFindOne.mockResolvedValue({ id: 'user-1' });

    await requireVerifiedUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('should return 401 if req.user is not set', async () => {
    req.user = undefined;

    await requireVerifiedUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 401 if user not found in database', async () => {
    mockFindOne.mockResolvedValue(null);

    await requireVerifiedUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 503 on database error', async () => {
    mockFindOne.mockRejectedValue(new Error('DB connection failed'));

    await requireVerifiedUser(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
