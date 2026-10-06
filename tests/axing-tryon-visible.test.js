// 试摆页「看得见、说得清」验收
//
// 守着三件事，都是顾客在 real life 里踩出来的：
//   1) 客厅图 + 家具图 + 结果图三张要同时在场。原来家具图在这一页从头到尾没露面，
//      只有一行文字「家具：聚木财MT50真皮软包床」——顾客无从判断 AI 收到的第二张图
//      是不是自己以为的那一款。
//   2) 结果话术必须由后端 resultInfo 说话。原来 `if (aiError) 诚实 else 说「摆好了」`，
//      而兜底出了图时 aiError 是 null，于是 Pollinations 重画的示意图也被说成
//      「摆好了！这是 X 在你家的样子」。实测那张图和顾客的房间对不上
//      （16×16 平均像素差 ~88、输入 1448×1086 输出 768×768），等于拿假效果推 ¥3000 的单。
//   3) 主按钮不能被 SVG 图标撑爆（原实测 184px 高，390×844 上吃掉 1/4 屏）。
//
// 端口 3550（避开 3510-3517 既有动线与 3530 聊天图）。
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import http from 'http';

const PORT = 3550;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

let serverProc = null;

function get(pathname) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${pathname}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

async function waitServerReady(timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  serverProc = spawn('node', ['src/server.js'], {
    // 放开匿名额度：这个文件的每个用例都要真跑一次生成（三张图 / 诚实横幅 /
    // 生成记录各一轮）。默认 3 次/天 会让他们互相抢——前几个用例打满后，
    // 后面的请求全落 429，永远等不到结果横幅。线上不设这个变量，仍是 3。
    env: { ...process.env, PORT: String(PORT), ANON_TRYON_LIMIT: '50' },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => { if (serverProc) serverProc.kill(); });

/** 进试摆页并选好房间 + 家具，返回选中的商品 */
async function openTryonWithInputs(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  await page.evaluate(() => window.AXING.go('view-tryon'));
  await page.waitForSelector('#view-tryon.active .ax-ty-inputs', { timeout: 15000 });
  const picked = await page.evaluate(async () => {
    const ps = await window.AXING.api.products();
    const list = (ps.products || ps).filter(p => (p.status || '在售') !== '下架');
    const p = list.find(x => x.image) || list[0];
    window.AXING.pickProduct(p);
    window.AXING.setState({ roomUrl: '/images/default-room.jpg', roomName: '示例房间' });
    return { id: p.id, name: p.name, image: p.image };
  });
  // 等两张缩略图真的把 src 换上（同步建壳、异步赋值）
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll('.ax-ty-input img')).filter(i => i.getAttribute('src')).length === 2,
    null, { timeout: 10000 },
  );
  return picked;
}

/** 点生成并等结果横幅。demo 环境上游多半不通，横幅照样会出现（兜底档）。 */
async function runGenerate(page) {
  await page.locator('#view-tryon .btn--apricot').first().click();
  await page.waitForFunction(() => !!document.querySelector('.ax-ty-result'), null, { timeout: 120000 });
}

// 1×1 透明 PNG：只要是个能加载的图，测的是横幅怎么说话，不是图内容
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/**
 * 拦掉试摆接口，直接回一个指定 demoType 的结果。
 *
 * 为什么值得 mock：真实上游现在只剩 Pollinations 一条能出图（twofishai 账号池空、
 * 阶跃 overloaded），跑一次 5-10 秒，而且落到哪个档看运气——four 档语调
 * 只能碰上一两种。这里四种 resultInfo 都能确定性地造出来，比真打更快也更全。
 * 真正要验证「后端真的会把 twofishai 失败原因提到 error 栏」的那条用例仍然走真链路。
 */
async function mockTryonResult(page, { demoType, tone, label, note, product }) {
  await page.route('**/api/tryon/ai-anon', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      success: true,
      data: {
        ok: true,
        product: product || { id: 'sofa-1', name: '新中式三人沙发' },
        compositionUrl: '/uploads/compositions/mock.jpg',
        compositionBase64: TINY_PNG,
        aiError: tone === 'good' ? null : 'twofishai:edits: TwoFish API 503: No available compatible accounts',
        demoType,
        resultInfo: { tone, label, note },
        anonymous: true,
        preset: null,
        remaining: 2,
      },
    }),
  }));
}

test.describe('试摆 · 三张图都在场', () => {
  test('客厅图和家具图同时可见，且都真的加载出来', async ({ page }) => {
    await openTryonWithInputs(page);
    const shots = page.locator('#view-tryon .ax-ty-input img');
    await expect(shots).toHaveCount(2);

    // 家具图原来压根不在这一页出现，顾客没法核对自己选的是哪一款
    await expect(shots.nth(0)).toHaveAttribute('alt', '你的客厅');
    await expect(shots.nth(1)).toHaveAttribute('alt', '选的家具');
    await expect(shots.nth(1)).toHaveAttribute('src', /\/images\//);

    // 不能是破图框：naturalWidth > 0 才算加载成功。用 poll 等它 fetch 完。
    for (let i = 0; i < 2; i++) {
      await expect.poll(() => shots.nth(i).evaluate(el => el.naturalWidth), {
        message: `第 ${i + 1} 张输入图应加载成功`, timeout: 15000,
      }).toBeGreaterThan(0);
    }

    // 没被 [hidden] 或别的元素盖住（本仓库反复踩过 display:flex 盖掉 [hidden] 的坑）
    const covered = await page.evaluate(() => Array.from(document.querySelectorAll('.ax-ty-input img')).map((img) => {
      const r = img.getBoundingClientRect();
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !(img === mid || img.contains(mid) || mid.contains(img));
    }));
    expect(covered.filter(Boolean), '有输入图被挡住').toHaveLength(0);
  });

  test('没选家具 / 没拍房间时，缺的那张摆占位而不是破图框', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'));
    await page.evaluate(() => window.AXING.go('view-tryon'));
    await page.waitForSelector('#view-tryon.active .ax-ty-inputs', { timeout: 15000 });
    const empties = page.locator('#view-tryon .ax-ty-input--empty');
    await expect(empties).toHaveCount(2);
    // 占位要说清缺的是什么，不能是个空框
    const caps = page.locator('#view-tryon .ax-ty-input figcaption');
    await expect(caps.nth(0)).toHaveText('还没有客厅照');
    await expect(caps.nth(1)).toHaveText('还没选家具');
  });
});

test.describe('试摆 · 结果怎么说才诚实', () => {
  // 四档各跑一遍：真合成 / 示意图 / 兜底 / 没出图。
  // 原来只有一条真实链路，落到哪个档看运气，另外三档等于没测。
  const CASES = [
    {
      demoType: 'ai-composition', tone: 'good', label: '真合成',
      note: '这是拿你上传的客厅照和选中的家具一起生成的，可以直接对照原房间看效果。',
      maySayReal: true,
    },
    {
      demoType: 'pollinations', tone: 'info', label: '示意图，不是你家实景',
      note: '主合成服务这次没接通，这张图是 AI 照着家具描述重新画的示意效果。',
      maySayReal: false,
    },
    {
      demoType: 'side-by-side', tone: 'warn', label: '左右对比预览，不是合成图',
      note: 'AI 这次没接通，左边是你的客厅原图、右边是家具预览，两张并没有合到一起。',
      maySayReal: false,
    },
    {
      demoType: null, tone: 'bad', label: '没出图',
      note: 'AI 没能完成这次合成，可以再试一次或到店看实物。',
      maySayReal: false,
    },
  ];

  for (const c of CASES) {
    test(`tone=${c.tone}（${c.label}）：横幅按 resultInfo 说话，不一律说「摆好了」`, async ({ page }) => {
      await openTryonWithInputs(page);
      await mockTryonResult(page, c);
      await runGenerate(page);

      const box = page.locator('.ax-ty-result');
      await expect(box).toBeVisible();
      await expect(box).toHaveAttribute('data-tone', c.tone);
      await expect(box.locator('.ax-ty-result__label')).toHaveText(c.label);

      // 阿杏那句话由 axingSay() 渲染，气泡类名是 .ax-bubble（不是聊天气泡的 .ax-msg）
      const headline = await page.evaluate(() => {
        const say = document.querySelector('.ax-ty-result .ax-bubble');
        return say ? say.textContent : '';
      });
      if (c.maySayReal) {
        expect(headline, '真合成才配说「在你家的样子」').toContain('在你家的样子');
      } else {
        expect(headline, `tone=${c.tone} 被说成了真合成`).not.toContain('在你家的样子');
        await expect(box.locator('.ax-ty-result__note')).toHaveText(c.note);
      }
    });
  }

  test('真合成只给「换个氛围再试」，不在错误时机推销', async ({ page }) => {
    await openTryonWithInputs(page);
    await mockTryonResult(page, {
      demoType: 'ai-composition', tone: 'good', label: '真合成',
      note: '这是拿你上传的客厅照和选中的家具一起生成的。',
    });
    await runGenerate(page);
    await expect(page.locator('.ax-ty-result button', { hasText: '换个氛围再试' })).toBeVisible();
    // 已经出图了还弹电话/预约，等于在顾客正高兴时 push 他
    await expect(page.locator('.ax-ty-result button', { hasText: '13359140982' })).toHaveCount(0);
    await expect(page.locator('.ax-ty-result button', { hasText: '预约到店看实物' })).toHaveCount(0);
  });

  test('示意图/兜底给出「再试一次 + 打店里电话 + 预约到店」三条出路', async ({ page }) => {
    await openTryonWithInputs(page);
    await mockTryonResult(page, {
      demoType: 'pollinations', tone: 'info', label: '示意图，不是你家实景',
      note: '主合成服务这次没接通。',
    });
    await runGenerate(page);
    await expect(page.locator('.ax-ty-result button', { hasText: '13359140982' }).first()).toBeVisible();
    await expect(page.locator('.ax-ty-result button', { hasText: '预约到店看实物' })).toBeVisible();
    await expect(page.locator('.ax-ty-result button', { hasText: '再试一次' })).toBeVisible();
  });

  test('主按钮「立即生成」高度正常，没被 SVG 图标撑爆', async ({ page }) => {
    await openTryonWithInputs(page);
    const h = await page.locator('#view-tryon .btn--apricot').first().evaluate(el => el.getBoundingClientRect().height);
    // icon() 出来的 <svg class="ico"> 没有 width/height；CSS 不约束时它会按 SVG 默认尺寸
    // 把按钮撑到 184px（实测），390×844 上一屏直接被吃掉 1/4。
    expect(h, '主按钮被图标撑爆了').toBeLessThanOrEqual(80);
    // 同时得够得着：老人最小可点区域 44px
    expect(h).toBeGreaterThanOrEqual(44);
  });
});

test.describe('试摆 · 生成记录', () => {
  test('匿名试摆也能按 anonId 查到自己的记录，含状态与失败原因', async ({ page }) => {
    await openTryonWithInputs(page);
    await runGenerate(page);

    const rec = await page.evaluate(async () => {
      const m = await import('/axing/js/api.js');
      const anonId = m.getAnonId();
      const r = await fetch(`/api/generations/recent?anonId=${encodeURIComponent(anonId)}`);
      return await r.json();
    });
    expect(rec.success, JSON.stringify(rec)).toBe(true);
    expect(rec.data.count, '刚生成的这条要落下来').toBeGreaterThan(0);
    const g = rec.data.generations[0];
    expect(['success', 'illustration', 'fallback', 'failed']).toContain(g.status);
    expect(g.demoType, 'demoType 要落盘，才知道走的哪条链路').toBeTruthy();
    expect(g.resultInfo && g.resultInfo.label, '要有一句话结论').toBeTruthy();
    expect(g.resultInfo && g.resultInfo.tone).toBeTruthy();
    expect(Array.isArray(g.trace), '全链路 trace 要留着').toBe(true);
    expect(g.trace.length).toBeGreaterThan(0);

    // 非真合成必须带原因（trace 第一条失败记录的 body 被提到 error 栏）
    if (g.status !== 'success') {
      expect(g.error, `status=${g.status} 必须写清为什么`).toBeTruthy();
      expect(g.resultInfo.note.length).toBeGreaterThan(0);
    }
  });

  test('anonId 格式不对时接口拒绝，不当注入面', async () => {
    for (const bad of ['', 'x', 'ax-anon-short', `ax-anon-${'z'.repeat(40)}`, 'ax-anon-../../etc/passwd']) {
      const r = await get(`/api/generations/recent?anonId=${encodeURIComponent(bad)}`);
      expect(r.status, `anonId=${bad} 应被拒绝`).toBe(400);
    }
  });

  test('拿不到的 anonId 返回空列表而不是 500', async () => {
    const r = await get('/api/generations/recent?anonId=ax-anon-000000000000');
    expect(r.status).toBe(200);
    expect(r.body.data.count).toBe(0);
  });
});

test.describe('试摆 · 主站生成记录页', () => {
  test('未登录也能看到本机匿名记录，不再一刀切要求登录', async ({ page }) => {
    // 先在阿杏里造一条匿名记录
    await openTryonWithInputs(page);
    await runGenerate(page);

    await page.goto(`${BASE_URL}/my-generations`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.querySelector('#content .empty'), { timeout: 10000 }).catch(() => {});
    const content = await page.locator('#content').textContent();
    // 关键断言：不能再出现「请先登录后查看你的生成记录」
    expect(content, '未登录的顾客被登录墙挡住，看不到自己刚试的结果').not.toContain('请先登录后查看你的生成记录');
    expect(content).toContain('生成链路');
  });
});
