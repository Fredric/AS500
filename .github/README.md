# GitHub Actions Workflows

## Playwright Tests

The `playwright.yml` workflow automatically runs Playwright end-to-end tests for the AS500 application.

### Triggers

The workflow runs on:
- **Push** to `main` or `master` branches
- **Pull requests** targeting `main` or `master` branches
- **Manual dispatch** via GitHub Actions UI

### What It Does

1. **Setup Environment**
   - Checks out the code
   - Sets up Node.js 20
   - Installs all dependencies (root, server, and client)
   - Installs Playwright browsers (Chromium)

2. **Start Services**
   - Starts Docker Compose services (PostgreSQL, server, client)
   - Waits for PostgreSQL to be ready
   - Waits for the client application to be available
   - Seeds the database with test data

3. **Run Tests**
   - Executes Playwright tests with `npm run test`
   - Uses CI-optimized settings (1 worker, 2 retries)

4. **Collect Results**
   - Uploads Playwright HTML report (available for 30 days)
   - Uploads test results and traces (available for 30 days)
   - Shows Docker logs if tests fail

### Configuration

The workflow is configured to:
- Run for up to 60 minutes
- Run tests sequentially on CI (workers: 1)
- Retry failed tests twice
- Capture screenshots and traces on failures

### Viewing Results

After a workflow run:
1. Go to the **Actions** tab in GitHub
2. Click on the workflow run
3. Download artifacts:
   - `playwright-report` - HTML report with screenshots and traces
   - `test-results` - Raw test results

### Local Testing

The Playwright configuration automatically handles local vs CI environments:

**Local Development:**
```bash
npm run test        # Automatically starts docker-compose
npm run test:ui     # Run tests in UI mode
npm run test:headed # Run tests with browser visible
```

**CI Environment:**
Docker Compose is started manually by the workflow, not by Playwright.

### Troubleshooting

If tests fail:
1. Check the "Show Docker logs on failure" step output
2. Download and open the `playwright-report` artifact
3. Review screenshots and traces of failed tests
4. Check the "Wait for services to be ready" step for timeout issues

### Manual Trigger

You can manually trigger the workflow:
1. Go to **Actions** tab
2. Select **Playwright Tests** workflow
3. Click **Run workflow**
4. Select branch and click **Run workflow**
