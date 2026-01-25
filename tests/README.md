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

### Run tests with UI mode (interactive)
```bash
npm run test:ui
```

### Run tests in headed mode (see browser)
```bash
npm run test:headed
```

### Run specific test file
```bash
npx playwright test tests/scrollable-subfile.spec.ts
```

## Test Structure

- `scrollable-subfile.spec.ts` - Tests for the scrollable subfile functionality in the TIME_REG screen

## Notes

- Tests assume Docker Compose services are running
- The `webServer` configuration in `playwright.config.ts` will automatically start Docker Compose if it's not already running
- Tests use the test user `FREDRIC` with password `fredric`
- Database should be seeded with test data (15+ time entries) for scrolling tests to work properly

## Seeding Test Data

Before running the scrollable subfile tests, ensure the database has sufficient test data:

```bash
docker compose exec server node /app/add-test-entries.ts
```

This will add 15 time entries for the current day, which is enough to test pagination (10 entries per page).
