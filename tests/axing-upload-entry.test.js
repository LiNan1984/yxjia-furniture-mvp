// ============================================================================
// 上传入口一致性 · 回归测试（docs/阿杏交互规范.md §1-2）
// ============================================================================
// 不变式：**任何「上传客厅照」入口都得开底部浮窗，不能把顾客抛到全屏 #view-upload。**
//
// 规范 §1-2 的结论原话：「#view-upload 不作为独立全屏 view 存在。上传能力收进底部
// 浮窗；view-upload 路由仅作 hash 直入/测试兜底。」
//
//    实测踩过的坑（v2.1.0）：首页四大功能磁贴「拍照试摆」写的是无条件
//    goView('view-upload')，而其他地方上传入口全是
//    `(ctx.openUpload ? ctx.openUpload() : ctx.go('view-upload'))`。
//    结果顾客点首页那个磁贴 → hash 变成 #view-upload、落进一个全屏上传页，
//    而同页上面的「上传客厅照卡」点下去是底部浮窗——同一个首页两种行为。
//
// ⚠️ 这里枚举「当前页面上存在的入口」，不写死清单：四宫格磁贴正在被重构/删除，
//    入口少了本条就少测几项，不会假红；哪天又被加回来且路线写错，立刻现形。
//
// 端口：3532（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100/3412/3420/3425/3430/3460/3510-3517/3531 的既有测试）
// 单独跑：./node_modules/.bin/playwright test tests/axing-upload-entry.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';

const PORT = 3532;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

let serverProc;

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('上传入口测试服务器启动超时');
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

async function openHome(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  await page.waitForSelector('#view-home .ax-ucard__title', { timeout: 15000 });
}

/** 当前快照：哪个 view 在场、浮窗开没开、hash 是什么 */
function snapshot(page) {
  return page.evaluate(() => ({
    active: (document.querySelector('.view.active') || {}).id,
    sheetOpen: !!document.getElementById('sheetRoot')?.classList.contains('is-open'),
    hash: location.hash,
    hasOpenUpload: typeof window.AXING?.openUpload === 'function',
  }));
}

/** 断言「落进了底部浮窗，而不是全屏上传页」。
 *  ⚠️ 不断言在场 view 一定是 view-home：从试摆页/商品页点上传入口时，本来就该停在
 *  原页面（浮窗是覆盖层）。真正的不变式是「开了浮窗 + 没落到 view-upload」。 */
function expectSheet(st, label) {
  expect(st.hasOpenUpload, `${label}：app 壳没注入 ctx.openUpload，浮窗链路是断的`).toBe(true);
  expect(st.sheetOpen, `${label}：浮窗没开`).toBe(true);
  expect(st.active, `${label}：被抛到了全屏 ${st.active}，规范 §1-2 要求收进浮窗`).not.toBe('view-upload');
  expect(st.hash, `${label}：地址栏被改成 ${st.hash || '(空)'}，顾客会以为换了页面`).not.toContain('view-upload');
}

/** 点一下，等浮窗过渡播完再量（is-open 是「先加 class 再播 0.15s」） */
async function clickAndSettle(page, label, click) {
  await click();
  await page.waitForFunction(
    () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
    null,
    { timeout: 8000 },
  ).catch(() => {});
  await page.waitForTimeout(400);
  expectSheet(await snapshot(page), label);
}

test.describe('D · 上传入口一致性（§1-2：一律走底部浮窗）', () => {
  test('D1 首页「上传客厅照卡」 → 底部浮窗', async ({ page }) => {
    await openHome(page);
    await clickAndSettle(page, '首页上传卡', async () => {
      // 可点元素的分层演进过几轮，认「带 .ax-ucard 的容器里第一个 role=button」，
      // 没有就点容器本身（onclick 挂在容器上的版本）。
      const target = await page.evaluateHandle(() =>
        document.querySelector('#view-home .ax-ucard [role=button]') || document.querySelector('#view-home .ax-ucard'));
      await target.asElement().click();
    });
  });

  test('D2 Composer 相册键 → 底部浮窗', async ({ page }) => {
    await openHome(page);
    await clickAndSettle(page, 'Composer 相册键', () => page.click('#composerImage'));
  });

  test('D3 首页四大功能里带「试摆」的磁贴 → 底部浮窗（不是全屏 view-upload）', async ({ page }) => {
    await openHome(page);
    // 枚举当前页面上真实存在的磁贴，不写死数量
    const tiles = await page.$$eval('#view-home .ax-quick__tile', (els) =>
      els.map((e, i) => ({ i, text: (e.innerText || '').replace(/\s+/g, ' ').trim() })));
    const tryon = tiles.filter((t) => /试摆/.test(t.text));
    test.skip(tryon.length === 0, '当前首页没有带「试摆」的功能磁贴（四宫格已被重构掉），本条跳过');
    expect(tryon.length, '不应该有多个「试摆」磁贴').toBe(1);

    await clickAndSettle(page, '「拍照试摆」磁贴', async () => {
      await page.locator('#view-home .ax-quick__tile', { hasText: '试摆' }).first().click();
    });
  });

  test('D4 试摆页「去拍客厅照」→ 底部浮窗', async ({ page }) => {
    await openHome(page);
    // 试摆页没选家具时，阿杏那段话里就有「去拍客厅照」
    await page.evaluate(() => window.AXING.go('view-tryon'));
    await page.waitForFunction(() => document.getElementById('view-tryon')?.classList.contains('active'), null, { timeout: 10000 });
    const btn = page.locator('#view-tryon button', { hasText: /去拍客厅照|去拍照|换一张/ }).first();
    test.skip(!(await btn.count()), '试摆页当前没有上传入口按钮');
    await clickAndSettle(page, '试摆页上传入口', () => btn.click());
  });
});
