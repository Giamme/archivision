import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // the specs share one seeded database
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run start',
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
