import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const systemChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ?? (process.platform === 'linux' && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: systemChromium ? { executablePath: systemChromium } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'development', testIgnore: '**/pwa.spec.ts', use: { baseURL: 'http://127.0.0.1:5173' } },
    { name: 'production-pwa', testMatch: '**/pwa.spec.ts', use: { baseURL: 'http://127.0.0.1:3173' } },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { BACKGROUND_REFRESH: 'false' },
    },
    {
      command: 'npm start',
      url: 'http://127.0.0.1:3173/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '3173',
        DATABASE_PATH: '.tmp/e2e-production.sqlite', BACKGROUND_REFRESH: 'false',
        PUBLIC_ORIGIN: 'http://127.0.0.1:3173', TRUST_PROXY_HOPS: '0',
      },
    },
  ],
});
