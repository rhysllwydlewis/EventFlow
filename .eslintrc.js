module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended', 'prettier'],
  plugins: ['node', 'security'],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
  },
  rules: {
    // Code quality
    'no-console': 'off', // Allow console for server logging
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-var': 'error',
    'prefer-const': 'warn',
    'prefer-arrow-callback': 'warn',
    'prefer-template': 'warn',

    // Security
    'security/detect-object-injection': 'off', // Too many false positives
    'security/detect-non-literal-fs-filename': 'off', // Too restrictive for our use case

    // Node.js specific
    'node/no-unpublished-require': [
      'error',
      {
        allowModules: ['supertest'],
      },
    ],
    'node/no-missing-require': 'error',
    'node/no-extraneous-require': 'error',

    // Best practices
    eqeqeq: ['error', 'always'],
    curly: ['warn', 'all'], // Changed to warning for gradual adoption
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-param-reassign': 'warn',
  },
  overrides: [
    {
      files: ['tests/**/*.js', '**/*.test.js', '**/*.spec.js'],
      env: {
        jest: true,
      },
      rules: {
        'node/no-unpublished-require': 'off',
      },
    },
    {
      files: ['public/**/*.js', 'utils/analytics.js', 'utils/url-state.js'],
      env: {
        browser: true,
        node: false,
      },
      globals: {
        module: 'readonly',
      },
      rules: {
        'node/no-missing-require': 'off',
        'node/no-extraneous-require': 'off',
        'node/no-unpublished-require': 'off',
        'no-undef': 'off', // Allow module to be undefined in browser
        'no-prototype-builtins': 'off', // Allow hasOwnProperty
        // Local rule: every call site must go through NotificationDispatcher.
        // Registered via `--rulesdir eslint-rules` in the lint script.
        'no-direct-notifications': 'error',
      },
    },
    {
      files: ['utils/behaviourAnalytics.js'],
      rules: {
        // The privacy sanitiser intentionally matches ASCII control characters
        // so they can be removed before analytics values are stored.
        'no-control-regex': 'off',
      },
    },
  ],
};
