import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const hasLiveLlm = Boolean(process.env.OPENAI_API_KEY || process.env.ARK_API_KEY);

export default defineConfig({
  testDir: './tests',
  timeout: hasLiveLlm ? 120000 : 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
  webServer: {
    command: 'node src/server.js',
    port: 3000,
    timeout: 15000,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    // 仅当既无 OPENAI 也无 ARK 时才启用假模型；有 ARK_API_KEY 时走真实豆包流式
    env: {
      ...process.env,
      ...(hasLiveLlm ? {} : { CHAT_GUIDE_FAKE_MODEL: '1' }),
    },
  },
});
