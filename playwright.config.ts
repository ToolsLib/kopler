import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:1420', channel: 'msedge', viewport: { width: 460, height: 640 }, trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --port 1420', url: 'http://127.0.0.1:1420', reuseExistingServer: !process.env.CI },
});
