# AS500 End-to-End Tests

This directory contains Playwright end-to-end tests for the AS500 Terminal System.

## Prerequisites

- Docker and Docker Compose installed
- Node.js 20.x
- Playwright installed

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers:
   ```bash
   npx playwright install
   ```

## Running Tests

### Run all tests (headless)
```bash
npm test
```

### Run tests with UI mode (interactive dashboard)
```bash
npm run test:ui
```

### Run tests in headed mode (see browser)
```bash
npm run test:headed
```

### Run specific test file
```bash
npm test tests/scrollable-subfile.spec.ts
npm test tests/time-registration-crud.spec.ts
```

### Run single test by name
```bash
npm test -- --grep "should add a new time entry"
```

### Run with debug mode (step through execution)
```bash
npm test -- --debug
```

## Test Structure

### Test Files

- **`scrollable-subfile.spec.ts`** - Tests for subfile pagination (8 tests)
  - Verifies "More..." indicator
  - Tests PageUp/PageDown scrolling
  - Tests boundary conditions (first/last page)
  - Tests day switching resets pagination

- **`time-registration-crud.spec.ts`** - Minimal CRUD template (3 tests)
  - Add: F6 → Fill form → Verify entry appears
  - Edit: Option "2" → Update field → Verify change
  - Delete: Option "4" → Verify entry removed
  - **Use this as a template for testing add/edit/delete on other screens**

### Test Data Management

Tests automatically manage data:

- **Setup**: `test.beforeAll()` calls `setupTestData()` to create 15 test entries
- **Cleanup**: `test.afterAll()` calls `teardownTestData()` to remove test entries
- No manual data seeding needed - everything is automated

**Test Data Files:**
- `testSetup.ts` - Shared utilities for test data setup/teardown
- Uses PostgreSQL connection pool to manage test database state

## Notes

- Tests run with `--workers=1` by default for database consistency
- The `webServer` configuration in `playwright.config.ts` automatically starts Docker Compose
- Default test user: `KALLE` with password `password`
- Each test is isolated and independent
- Tests run in ~4-15 seconds depending on complexity

## Creating New Tests

Use the `time-registration-crud.spec.ts` as a template:

### 1. Create Test File
```typescript
import { test, expect } from '@playwright/test';
import { setupTestData, teardownTestData } from './testSetup.js';

test.describe('Feature Name', () => {
  test.beforeAll(async () => {
    await setupTestData();  // Customize if needed
  });

  test.afterAll(async () => {
    await teardownTestData();
  });

  test.beforeEach(async ({ page }) => {
    // Login and navigate to your screen
    // Copy the login/nav pattern from CRUD test
  });

  test('should do something', async ({ page }) => {
    // Your test code
  });
});
```

### 2. Key Selectors for Testing

```typescript
// Text-based queries (most reliable)
page.locator('text=YOUR_TEXT')
page.locator('text=TASK-101')

// Input fields with data attributes
page.locator('input[data-field="opt_0"]')  // Subfile option field
page.locator('input[type="text"]').nth(0)  // Form fields by index
page.locator('input[type="password"]')

// Special keys
page.keyboard.press('F6')      // Add (F6)
page.keyboard.press('Enter')   // Submit
page.keyboard.press('PageDown')// Scroll down
page.keyboard.press('PageUp')  // Scroll up
```

### 3. Common Patterns

**Login Pattern:**
```typescript
const usernameInput = page.locator('input[type="text"]').first();
await usernameInput.fill('KALLE');
await usernameInput.press('Tab');
await page.locator('input[type="password"]').fill('password');
await page.locator('input[type="password"]').press('Enter');
```

**Wait for Screen:**
```typescript
await page.locator('text=TIME REGISTRATION').waitFor({ state: 'visible', timeout: 10000 });
```

**Verify Entry Exists:**
```typescript
await expect(page.locator('text=TEST-001').first()).toBeVisible();
```

**Verify Entry Changed:**
```typescript
const before = await page.locator('text=TASK-').first().textContent();
// ... make change ...
const after = await page.locator('text=TASK-').first().textContent();
expect(after).not.toBe(before);
```

## Troubleshooting

### Tests Fail with "Connection Timeout"
- Ensure Docker Compose is running: `docker-compose ps`
- Check server is accessible: `docker-compose logs server`
- Try restarting: `docker-compose restart`

### Tests Fail with "Cannot find module 'pg'"
- Run: `npm install pg`
- Root-level package.json needs pg for test utilities

### Tests Timeout Waiting for Elements
- Increase timeout: `await page.locator('text=...').waitFor({ timeout: 15000 })`
- Add debugging: `await page.screenshot()` to see page state
- Run with `--headed` to watch test execution

### Tests Pass Individually but Fail Together
- Ensure `--workers=1` is set in npm test scripts
- Check database cleanup is running in afterAll hooks
- Verify test data isn't conflicting between tests

## Best Practices

✅ **DO:**
- Wait for actual state changes, not fixed delays
- Use `waitFor()` instead of `waitForTimeout()`
- Use text-based queries (`text=...`) when possible
- Test one feature per test
- Keep tests minimal and focused
- Use descriptive test names
- Add comments explaining complex interactions

❌ **DON'T:**
- Use hard-coded delays (e.g., `waitForTimeout(500)`)
- Assume elements exist without waiting
- Test multiple features in one test
- Create test-specific database migrations
- Leave test data in the database after tests
- Use fragile selectors (avoid row/column numbers)

## Performance

- Tests run serially (--workers=1) for database consistency
- Full suite completes in ~20 seconds
- Each test: ~2-5 seconds (including setup/teardown)
- Adjust if adding many new tests: may need to run specific suites

## CI/CD Integration

For GitHub Actions or other CI:

```yaml
- name: Install dependencies
  run: npm install && npx playwright install

- name: Start Docker services
  run: docker-compose up -d

- name: Run tests
  run: npm test
```
