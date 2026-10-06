// ============================================================================
// tryonEnabled 总开关 · 回归测试（docs/handoff-20261005-阿杏AI助手.md §8.6 🟠2.10）
// ============================================================================
// 不变式：AI 整体不可用（如 twofish key 失效）时，店主在后台关掉「AI 试摆」总闸，
// 阿杏试摆页应**直接切「到店引导」**（打电话 + 预约到店），而不是逐次给降级预览/报错。
// 开着时保持正常试摆页（有「立即生成」）。
//
// 端口：3534（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100/3412/3420/3425/3430/3460/3510-3517/3531/3532/3533 的既有测试）
// 单独跑：./node_modules/.bin/playwright test tests/axing-tryon-enabled.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';

const PORT = 3534;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };
const PHONE = '13359140982';

let serverProc;

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('tryonEnabled 测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  serverProc = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
});

function mockFlags(page, tryonEnabled) {
  return page.route('**/api/feature-flags', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { tryonEnabled, tryonRequirePhone: true } }),
    }));
}

async function openTryon(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  await page.evaluate(() => window.AXING.go('view-tryon'));
  await page.waitForFunction(() => document.querySelector('#view-tryon.active'), null, { timeout: 10000 });
}

test('后端默认：GET /api/feature-flags 暴露 tryonEnabled 且默认开启', async () => {
  const r = await fetch(`${BASE_URL}/api/feature-flags`);
  expect(r.ok).toBeTruthy();
  const body = await r.json();
  const flags = body.data || body;
  expect(typeof flags.tryonEnabled).toBe('boolean');
  expect(flags.tryonEnabled).toBe(true); // 默认开着，不因缺 key 误伤试摆
});

test('tryonEnabled=false → 试摆页切「到店引导」（电话 + 预约到店），不出立即生成', async ({ page }) => {
  await mockFlags(page, false);
  await openTryon(page);
  await expect(page.locator(`#view-tryon a[href="tel:${PHONE}"]`).first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#view-tryon').getByText('阿杏陪你到店看')).toBeVisible();
  await expect(page.locator('#view-tryon button:has-text("预约到店")').first()).toBeVisible();
  await expect(page.locator('#view-tryon button:has-text("立即生成")')).toHaveCount(0);
});

test('tryonEnabled=true → 正常试摆页，有立即生成、无到店引导', async ({ page }) => {
  await mockFlags(page, true);
  await openTryon(page);
  await expect(page.locator('#view-tryon button:has-text("立即生成")').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#view-tryon').getByText('阿杏陪你到店看')).toHaveCount(0);
});
