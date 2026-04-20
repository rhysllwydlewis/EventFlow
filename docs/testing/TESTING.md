# Testing Guide

This guide explains how to run tests and linting for the EventFlow project.

## Prerequisites

- Node.js 20.x or higher
- npm (comes with Node.js)

## Installation

```bash
npm ci
```

## Linting

### Run ESLint

Check code quality and catch common errors:

```bash
npm run lint
```

### Auto-fix ESLint issues

Automatically fix issues where possible:

```bash
npm run lint:fix
```

### Check code formatting

Verify code formatting with Prettier:

```bash
npm run format:check
```

### Auto-format code

Format all code with Prettier:

```bash
npm run format
```

## Testing

### Run all tests

Run the complete Jest test suite with coverage:

```bash
npm test
```

> Note: Playwright visual specs under `tests/visual/` are intentionally excluded from Jest and run via Playwright (`npm run test:visual`).

### Run tests in watch mode

Useful during development:

```bash
npm run test:watch
```

### Run specific test types

Run only unit tests:

```bash
npm run test:unit
```

Run only integration tests:

```bash
npm run test:integration
```

## End-to-End Testing

### Run Playwright E2E tests

Run all E2E tests:

```bash
npm run test:e2e
```

Run E2E tests with UI:

```bash
npm run test:e2e:ui
```

**Note:** E2E tests require the server to be running. The Playwright configuration automatically starts the server before running tests.

## CI/CD Pipeline

The project uses GitHub Actions for continuous integration. The following checks run automatically:

1. **Lint** - ESLint and Prettier formatting checks
2. **Test** - Jest unit and integration tests
3. **Security** - npm audit for dependency vulnerabilities
4. **Build** - Server startup verification
5. **E2E** - Playwright end-to-end tests (separate workflow)

### Local CI verification

To verify your changes will pass CI, run:

```bash
npm run lint && npm run format:check && npm test
```

## Test Coverage

Test coverage is collected automatically when running `npm test`. Reports are available in:

- `coverage/` directory (HTML, LCOV, and text formats)
- Coverage summary is displayed in the terminal

Current coverage thresholds are set to realistic levels based on the codebase:

- Statements: 3%
- Branches: 3%
- Functions: 2%
- Lines: 3%

## Pre-commit Hooks

The project uses Husky and lint-staged to automatically run linting and formatting on staged files before commit:

- ESLint runs on all `.js` files
- Prettier runs on `.js`, `.json`, and `.md` files

To skip pre-commit hooks (not recommended):

```bash
git commit --no-verify
```

## Troubleshooting

### Tests failing locally but passing in CI (or vice versa)

- Ensure you're using Node.js 20.x
- Run `npm ci` to ensure dependencies match CI environment
- Check that environment variables are set correctly

### ESLint warnings vs errors

- **Errors** will fail the CI pipeline
- **Warnings** are informational and won't fail CI
- Current codebase has only warnings, no errors

### Playwright tests not running

- Ensure browsers are installed: `npx playwright install --with-deps`
- Check that the server starts successfully
- Review `playwright.config.js` for configuration

## Best Practices

1. **Always run tests before committing**
2. **Use `npm run lint:fix` to automatically fix style issues**
3. **Add tests for new features**
4. **Keep test coverage reasonable** (don't aim for 100% unnecessarily)
5. **Run E2E tests for UI changes**

## CI Badge Status

Check the [GitHub Actions tab](https://github.com/rhysllwydlewis/eventflow/actions) for current CI status and detailed logs.
