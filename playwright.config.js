import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
  webServer: {
    command: 'node src/server.js',
    port: 3000,
    timeout: 10000,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});