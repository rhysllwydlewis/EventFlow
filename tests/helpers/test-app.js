/**
 * Test Application Helper
 * Creates a minimal Express app for testing routes
 */

const express = require('express');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest-min-32-characters-long'; // pragma: allowlist secret
process.env.EMAIL_ENABLED = 'false';

/**
 * Create a minimal test Express app that mounts system routes
 * @returns {Express.Application} Express app for testing
 */
function createTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mock dependencies for system routes
  const mockDeps = {
    APP_VERSION: '18.1.0-test',
    EMAIL_ENABLED: false,
    postmark: {
      isPostmarkEnabled: () => false,
    },
    mongoDb: {
      isConnected: () => true,
      getConnectionState: () => 'connected',
      getConnectionError: () => null,
    },
    dbUnified: {
      getDatabaseStatus: () => ({
        type: 'mongodb',
        initialized: true,
        initializationState: 'completed',
      }),
      read: async key => {
        if (key === 'settings') {
          return {
            pexelsCollageSettings: {
              collectionId: 'test-collection',
            },
          };
        }
        return null;
      },
    },
    getToken: (_req, _res) => {
      return 'test-csrf-token';
    },
    authLimiter: (_req, _res, next) => next(),
    healthCheckLimiter: (_req, _res, next) => next(),
  };

  // Mount system routes with mocked dependencies
  try {
    const systemRoutes = require('../../routes/system');
    if (systemRoutes.initializeDependencies) {
      systemRoutes.initializeDependencies(mockDeps);
    }
    app.use('/api', systemRoutes);
  } catch (error) {
    console.error('Error mounting system routes:', error);
  }

  return app;
}

/**
 * Create a test app with auth routes
 * @returns {Express.Application} Express app with auth routes
 */
function createAuthTestApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Create simple mock endpoints for testing auth validation
  app.post('/api/auth/register', (req, res) => {
    const { email, password, name } = req.body;

    // Validation
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
      });
    }

    if (!email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters',
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful',
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Missing credentials',
      });
    }

    // Simulate invalid credentials
    if (email !== 'test@example.com' || password !== 'validpassword') {
      // pragma: allowlist secret
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    res.status(200).json({
      success: true,
      token: 'mock-jwt-token', // pragma: allowlist secret
    });
  });

  // Mock protected endpoint
  app.get('/api/protected', (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Protected resource accessed',
    });
  });

  return app;
}

module.exports = {
  createTestApp,
  createAuthTestApp,
};
