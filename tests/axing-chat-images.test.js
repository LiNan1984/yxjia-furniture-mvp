// 阿杏对话里的家具商品卡（/api/chat/guide/stream 的 tool 事件带 products）
//
// 为什么值得单开一个文件：阿杏以前只会用文字报「植物印花弧形布艺沙发 ¥2899起 p-xxx」，
// 顾客看不到家长什么样。现在后端把工具返回的商品数组（含 image）从 SDK 的
// tool_call_output_item 里取出来，随 tool 事件发给前端，前端渲染成带图小卡。
//
// 这里一律用 page.route 伪造 SSE，不打真 LLM：
//   1) 真模型一轮 5-15s 且烧 token，而这个文件要覆盖的是**前端渲染与降级**；
//   2) 模型这轮调 list 还是 search、返几款，本来就不确定，断言会飘。
// 后端那条链路（normalizeToolProducts 真的掏出 image）由手工真实调用验证过，
// 见 git log 里 "feat: 聊天回复带家具图"。
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import http from 'http';

const PORT = 3530;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

// 用真实在库商品：图必须真能加载出来，否则 naturalWidth 断言没意义（fake id 会 404）
const TOOL_PRODUCTS = [
  {
    id: 'sofa-1', name: '新中式三人沙发', price: '¥3xxx 起',
    image: '/images/sofa-1.jpg', subtitle: '雾霾蓝亚麻+真皮 · 金色竹节',
    size: '3.4 米大尺寸', badge: '主推', category: 'sofa',
  },
  {
    id: 'sofa-2', name: '轻奢 L 形转角沙发', price: '¥5xxx 起',
    image: '/images/sofa-corner-real.png', subtitle: '杏色生态皮 + 实木框架',
    size: '3.2 米 × 1.8 米', badge: '', category: 'sofa',
  },
];

const REPLY = '给你找了两款三千往上的沙发，你看看喜欢哪个？';

function sseBody(frames) {
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
}

/** 造一条完整 SSE：工具名 → 工具输出（带商品）→ 正文 → done */
function mockStream(replyMd, products, opts = {}) {
  const frames = [{ type: 'status', provider: 'mock', streaming: true }];
  frames.push({ type: 'tool', name: opts.toolName || 'search_products' });
  if (products) frames.push({ type: 'tool', name: opts.toolName || 'search_products', products });
  frames.push({ type: 'delta', text: replyMd });
  frames.push({ type: 'done', reply: replyMd });
  return async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sseBody(frames),
    });
  };
}

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
    if (Date.now() - started > timeoutMs) throw new Error('阿杏测试服务器启动超时');
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

async function waitIdle(page) {
  await page.waitForFunction(
    () => {
      const b = document.querySelector('#composerStop');
      return b && getComputedStyle(b).display === 'none';
    },
    null,
    { timeout: 20000 },
  );
}

async function ask(page, text) {
  await page.fill('#composerInput', text);
  await page.locator('#composerSend').click();
  await waitIdle(page);
}

test.describe('阿杏 · 聊天回复带家具图', () => {
  test('tool 事件带 products 时，正文下方渲染带图商品卡', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, TOOL_PRODUCTS));
    await openHome(page);
    await ask(page, '三千左右的沙发');

    const cards = page.locator('#view-home .ax-chat-products .p-card');
    await expect(cards).toHaveCount(2);

    // 图必须真的加载出来：productCard 拿不到 image 时只铺骨架，这里要的是真图。
    // 卡片的 img 是 loading="lazy"，刚 append 完还没 fetch 完，一次性读 naturalWidth
    // 会量到 0（全量跑、机器负载高时必踩）。用 expect.poll 让它自己等。
    const imgs = page.locator('#view-home .ax-chat-products .p-card__img img');
    for (let i = 0; i < (await imgs.count()); i++) {
      await expect.poll(() => imgs.nth(i).evaluate((el) => el.naturalWidth), {
        message: `第 ${i + 1} 张商品图应加载成功`, timeout: 15000,
      }).toBeGreaterThan(0);
    }

    // 文字信息不能因为出了图就丢：名字、价格都还在
    await expect(cards.first()).toContainText('新中式三人沙发');
    await expect(cards.first()).toContainText('¥3xxx 起');

    expect(errs, errs.join(' | ')).toHaveLength(0);
  });

  test('商品卡出现在追问 chips 之前', async ({ page }) => {
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, TOOL_PRODUCTS));
    await openHome(page);
    await ask(page, '三千左右的沙发');
    await expect(page.locator('#view-home .ax-chat-products .p-card').first()).toBeVisible();

    // 卡片是这一轮的内容，chips 是下一步动作；顺序反了图会夹在正文和追问中间
    const order = await page.evaluate(() => {
      const col = document.querySelector('#view-home .ax-msg--ai:last-child .ax-msg__col');
      if (!col) return null;
      const kids = Array.from(col.children);
      return {
        products: kids.findIndex((k) => k.classList.contains('ax-chat-products')),
        followups: kids.findIndex((k) => k.classList.contains('ax-msg__followups')),
      };
    });
    expect(order).not.toBeNull();
    if (order.followups !== -1) expect(order.products).toBeLessThan(order.followups);
  });

  test('「选它」把家具送上 3D 台', async ({ page }) => {
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, TOOL_PRODUCTS));
    await openHome(page);
    await ask(page, '三千左右的沙发');

    const pick = page.locator('#view-home .ax-chat-products .p-card__ops .btn').first();
    await expect(pick).toContainText('选它');
    await pick.click();

    // 3D 页要真的挂上，不然「摆进 3D 台」这句话是空头支票
    await page.waitForFunction(() => document.querySelector('#view-3d.active'), null, { timeout: 15000 });
    await expect(page.locator('#view-3d.active')).toBeVisible();
  });

  test('老后端只发工具名（无 products）时不出卡、也不报错', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, null));
    await openHome(page);
    await ask(page, '三千左右的沙发');

    // 降级路径：正文照样在，只是没有图
    await expect(page.locator('#view-home .ax-msg--ai').last()).toContainText('三千往上');
    await expect(page.locator('#view-home .ax-chat-products')).toHaveCount(0);
    expect(errs, errs.join(' | ')).toHaveLength(0);
  });

  test('同一商品在多轮工具里重复出现只渲染一次', async ({ page }) => {
    // list + search 常返同一批，这里在同一个 tool 事件里塞重复 id，
    // 覆盖 chat-core 的 dedupeProducts
    const duped = [TOOL_PRODUCTS[0], TOOL_PRODUCTS[1], TOOL_PRODUCTS[0]];
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, duped));
    await openHome(page);
    await ask(page, '三千左右的沙发');
    await expect(page.locator('#view-home .ax-chat-products .p-card')).toHaveCount(2);
  });
});

test.describe('阿杏 · 聊天商品图', () => {
  test('图加载失败时卡片不碎（alt/骨架兜底）', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    // 让所有图片 404，看卡片还是不是一张结构完整的卡
    await page.route('**/images/**', (route) => route.fulfill({ status: 404, body: '' }));
    await page.route('**/api/chat/guide/stream', mockStream(REPLY, TOOL_PRODUCTS));
    await openHome(page);
    await ask(page, '三千左右的沙发');

    const cards = page.locator('#view-home .ax-chat-products .p-card');
    await expect(cards).toHaveCount(2);
    // 名字还在，顾客至少知道这是哪一款，而不是看到一块空白
    await expect(cards.first()).toContainText('新中式三人沙发');
    expect(errs, errs.join(' | ')).toHaveLength(0);
  });
});
