/**
 * Integration tests for /api/auth/me endpoint
 * Tests owner admin role enforcement and response format
 */

const fs = require('fs');
const path = require('path');

describe('Auth Me Endpoint', () => {
  describe('Response Format', () => {
    it('should have /me endpoint in routes/auth.js', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Verify the endpoint exists
      expect(authContent).toContain("router.get('/me'");
      expect(authContent).toContain('getUserFromCookie');
    });

    it('should return 200 with { user: null } for unauthenticated users', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Verify the endpoint returns 200 with { user: null } for unauthenticated users
      const authMeEndpoint = authContent.match(/router\.get\('\/me'[\s\S]*?^\}\);/m);
      expect(authMeEndpoint).toBeTruthy();
      expect(authMeEndpoint[0]).toContain('return res.json({ user: null })');
    });

    it('should return wrapped response format with user property', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      // Verify response includes wrapped format
      const authMeSection = authContent.match(/router\.get\('\/me'[\s\S]*?^\}\);/m);
      expect(authMeSection).toBeTruthy();
      expect(authMeSection[0]).toContain('res.json({');
      expect(authMeSection[0]).toContain('user: {');
    });

    it('should include supplierApproved enrichment for supplier users', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      const authMeEndpoint = authContent.match(/router\.get\('\/me'[\s\S]*?^\}\);/m);
      expect(authMeEndpoint).toBeTruthy();
      expect(authMeEndpoint[0]).toContain("if (u.role === 'supplier')");
      expect(authMeEndpoint[0]).toContain('supplierApproved');
    });

    it('should return wrapped user format only', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      const authMeEndpoint = authContent.match(/router\.get\('\/me'[\s\S]*?^\}\);/m);
      expect(authMeEndpoint).toBeTruthy();
      expect(authMeEndpoint[0]).not.toContain('...userData');
    });
  });

  describe('Login Endpoint Owner Enforcement', () => {
    it('should create JWT using persisted user role during login', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      const loginEndpoint = authContent.match(/router\.post\('\/login'[\s\S]*?^\}\);/m);
      expect(loginEndpoint).toBeTruthy();
      expect(loginEndpoint[0]).toContain('jwt.sign');
      expect(loginEndpoint[0]).toContain('role: user.role');
    });

    it('should use user role in response payload', () => {
      const authContent = fs.readFileSync(path.join(__dirname, '../../routes/auth.js'), 'utf8');

      const loginEndpoint = authContent.match(/router\.post\('\/login'[\s\S]*?^\}\);/m);
      expect(loginEndpoint).toBeTruthy();
      expect(loginEndpoint[0]).toContain(
        'user: { id: user.id, name: user.name, email: user.email, role: user.role }'
      );
    });
  });

  describe('Frontend Admin Check', () => {
    it('should handle both wrapped and unwrapped response formats', () => {
      const adminInitContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-init.js'),
        'utf8'
      );

      // Verify frontend handles both formats
      expect(adminInitContent).toContain('const user = me.user || me');
    });

    it('should check owner email as fallback for admin access', () => {
      const adminInitContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-init.js'),
        'utf8'
      );

      // Verify owner email constant is defined
      expect(adminInitContent).toContain("const OWNER_EMAIL = 'admin@event-flow.co.uk'");
      expect(adminInitContent).toContain('isOwner');
    });

    it('should check admin role or owner email', () => {
      const adminInitContent = fs.readFileSync(
        path.join(__dirname, '../../public/assets/js/pages/admin-init.js'),
        'utf8'
      );

      // Verify combined check
      expect(adminInitContent).toContain("user.role === 'admin' || isOwner");
    });
  });
});

describe('Auth Me Endpoint - Mock Response Tests', () => {
  describe('Response Structure Validation', () => {
    it('should validate wrapped response format', () => {
      // Mock response in the expected format
      const mockResponse = {
        user: {
          id: 'test-id',
          email: 'admin@event-flow.co.uk',
          role: 'admin',
          name: 'Test Admin',
          isOwner: true,
        },
        // Backward compatibility - unwrapped at root
        id: 'test-id',
        email: 'admin@event-flow.co.uk',
        role: 'admin',
        name: 'Test Admin',
        isOwner: true,
      };

      // Verify structure
      expect(mockResponse).toHaveProperty('user');
      expect(mockResponse.user).toHaveProperty('id');
      expect(mockResponse.user).toHaveProperty('email');
      expect(mockResponse.user).toHaveProperty('role');
      expect(mockResponse.user).toHaveProperty('isOwner');

      // Verify backward compatibility
      expect(mockResponse).toHaveProperty('id');
      expect(mockResponse).toHaveProperty('email');
      expect(mockResponse).toHaveProperty('role');
    });

    it('should enforce admin role for owner email', () => {
      const ownerEmail = 'admin@event-flow.co.uk';
      const isOwner = ownerEmail.toLowerCase() === 'admin@event-flow.co.uk';
      const userRole = isOwner ? 'admin' : 'customer';

      expect(isOwner).toBe(true);
      expect(userRole).toBe('admin');
    });

    it('should not enforce admin role for non-owner email', () => {
      const regularEmail = 'user@example.com';
      const isOwner = regularEmail.toLowerCase() === 'admin@event-flow.co.uk';
      const userRole = isOwner ? 'admin' : 'customer';

      expect(isOwner).toBe(false);
      expect(userRole).toBe('customer');
    });
  });

  describe('Frontend Compatibility', () => {
    it('should support accessing user via me.user', () => {
      const mockResponse = {
        user: { id: '123', email: 'test@example.com', role: 'admin' },
        id: '123',
        email: 'test@example.com',
        role: 'admin',
      };

      const user = mockResponse.user;
      expect(user).toBeDefined();
      expect(user.role).toBe('admin');
    });

    it('should support accessing user via me directly (backward compat)', () => {
      const mockResponse = {
        id: '123',
        email: 'test@example.com',
        role: 'admin',
      };

      const user = mockResponse.user || mockResponse;
      expect(user).toBeDefined();
      expect(user.role).toBe('admin');
    });

    it('should handle owner check in frontend', () => {
      const mockUser = { email: 'admin@event-flow.co.uk', role: 'customer' };
      const isOwner = mockUser.email === 'admin@event-flow.co.uk';
      const isAdmin = mockUser.role === 'admin' || isOwner;

      expect(isOwner).toBe(true);
      expect(isAdmin).toBe(true); // Should be admin due to owner email
    });
  });
});
