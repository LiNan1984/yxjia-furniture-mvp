// ============================================================================
// 商品卡片图容器高度统一性 · 回归测试
// ============================================================================
// 覆盖什么：
//   C1  商品页 #view-products 的 .p-card__img 容器高度全部一致
//   C2  对话里工具返回的商品卡（.ax-chat-products .p-card）容器高度全部一致
//
// 为什么值得守：.p-card__img 定了 aspect-ratio（商品页 1/1、对话层 chat.css 覆写成
// 16/10），<img> 原来是文档流里的 width:100%;height:100%;object-fit:cover。竖图的
// 内在宽高比会压过 aspect-ratio，把盒子本身撑高——实测 sofa-tihua.jpg（768×1152）
// 让对话卡片容器从 156px 涨到 374px、商品页两列网格从 141px 涨到 212px。
// object-fit:cover 只能裁切，救不了盒子尺寸。修法是把 img 改成 position:absolute
// （axing.css），让它退出父级内容高度计算。
//
// ⚠️ 这条修复「看起来是死 CSS」：父级本来就是 position:relative，img 也已经有
//   width/height:100%，删掉 position:absolute 视觉上毫无变化（横图完全正常），
//   只有竖图才炸。所以两个用例都断言「fixture 里真的有竖图」，不是空跑。
//
// ⚠️ 商品图带 loading:"lazy"，不滚进视口浏览器不发请求。断言 img 原始尺寸前必须
//   scrollIntoView。
//
// 端口：3531（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100/3412/3420/3425/3430/3460/3510-3517 的既有测试）
// 单独跑：./node_modules/.bin/playwright test tests/axing-product-card-ratio.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';

const PORT = 3531;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

/** 竖图：768×1152，正是当年把卡片顶到 374px 的那张 */
const PORTRAIT_IMG = '/images/sofa-tihua.jpg';
/** 横图：1978×970，正常形态 */
const LANDSCAPE_IMG = '/images/sofa-1.jpg';

const MOCK_PRODUCTS = [
  { id: 'sofa-1', name: '新中式三人沙发', price: '¥3xxx 起', image: LANDSCAPE_IMG, subtitle: '雾霾蓝亚麻', size: '3.4 米' },
  { id: 'sofa-3', name: '米白提花三人沙发', price: '¥4xxx 起', image: PORTRAIT_IMG, subtitle: '雪尼尔', size: '2.4 米' },
  { id: 'p-1', name: '植物印花弧形布艺沙发', price: '¥2899起', image: '/images/sofa-corner-real.png', subtitle: '粗纺布艺' },
];

let serverProc;

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('卡片高度回归测试服务器启动超时');
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

/** 把商品数组包成 /api/chat/guide/stream 的 SSE 报文（tool 事件的 products 字段） */
function sseWithProducts(products) {
  const frames = [
    { type: 'status', provider: 'mock', model: 'mock', streaming: true },
    { type: 'tool', name: 'search_products', products },
    { type: 'delta', text: '为你找到这几款：' },
    { type: 'done', reply: '为你找到这几款，看中了点「选它」。' },
  ];
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
}

async function openHome(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  await page.waitForSelector('#view-home .ax-ucard__title', { timeout: 15000 });
}

/** 量一批卡片的图容器高度，并把图滚进视口（懒加载） */
async function measureCards(page, selector) {
  await page.evaluate((sel) => {
    document.querySelectorAll(sel).forEach((c) => c.scrollIntoView({ block: 'center', behavior: 'instant' }));
  }, selector);
  // 懒加载触发 + 自然尺寸落定
  await page.waitForFunction((sel) => {
    const imgs = [...document.querySelectorAll(`${sel} img`)];
    return imgs.length > 0 && imgs.every((i) => i.complete);
  }, selector, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);

  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].map((c) => {
      const w = c.querySelector('.p-card__img');
      const im = c.querySelector('.p-card__img img');
      const r = w.getBoundingClientRect();
      return {
        name: (c.querySelector('.p-card__name') || {}).textContent?.trim() || '',
        wrapH: Math.round(r.height),
        wrapW: Math.round(r.width),
        naturalW: im ? im.naturalWidth : 0,
        naturalH: im ? im.naturalHeight : 0,
        loaded: im ? (im.complete && im.naturalWidth > 0) : false,
      };
    });
  }, selector);
}

/** 断言这批卡片里「真的有竖图」——否则高度一致可能是没样本的空跑 */
function expectHasPortrait(cards) {
  const portrait = cards.filter((c) => c.naturalH > c.naturalW);
  expect(portrait.map((c) => c.name), 'fixture 里至少要有一张竖图，否则本条是空跑').not.toHaveLength(0);
  return portrait;
}

test.describe('C · 商品卡片图容器高度（竖图不再把卡片顶歪）', () => {
  test('C1 商品页 .p-card__img 容器高度全部一致，竖图不撑高', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
    // 点底部「商品」Tab 进屋（改 location.hash 不触发这个路由器）
    await (await page.$$('.tab'))[1].click();
    await page.waitForSelector('#view-products .p-card__img img', { timeout: 15000 });

    const cards = await measureCards(page, '#view-products .p-card');
    expect(cards.length).toBeGreaterThan(1);

    const portrait = expectHasPortrait(cards);
    // 竖图那几张必须和横图一样高
    for (const c of portrait) {
      expect(c.wrapH, `「${c.name}」是竖图（${c.naturalW}×${c.naturalH}），容器被撑成了 ${c.wrapH}px`).toBe(cards[0].wrapH);
    }
    const heights = [...new Set(cards.map((c) => c.wrapH))];
    expect(heights, `容器高度不统一：${JSON.stringify(cards.map((c) => [c.name, c.wrapH]))}`).toEqual([cards[0].wrapH]);
    expect(cards.every((c) => c.loaded), '有图片没加载出来').toBe(true);
  });

  test('C2 对话里的商品卡容器高度全部一致，竖图不撑高', async ({ page }) => {
    await page.route('**/api/chat/guide/stream', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: sseWithProducts(MOCK_PRODUCTS),
      }));

    await openHome(page);
    await page.fill('#composerInput', '三千左右的沙发，推荐几款');
    await page.click('#composerSend');
    await page.waitForSelector('#view-home .ax-chat-products .p-card', { timeout: 15000 });

    const cards = await measureCards(page, '#view-home .ax-chat-products .p-card');
    expect(cards.length).toBe(MOCK_PRODUCTS.length);

    const portrait = expectHasPortrait(cards);
    for (const c of portrait) {
      expect(c.wrapH, `「${c.name}」是竖图（${c.naturalW}×${c.naturalH}），容器被撑成了 ${c.wrapH}px`).toBe(cards[0].wrapH);
    }
    const heights = [...new Set(cards.map((c) => c.wrapH))];
    expect(heights, `容器高度不统一：${JSON.stringify(cards.map((c) => [c.name, c.wrapH]))}`).toEqual([cards[0].wrapH]);
    expect(cards.every((c) => c.loaded), '有图片没加载出来').toBe(true);

    // 卡片要排在追问 chips 之前（chat-core 里定的顺序：正文 → 卡片 → 追问）。
    // 用 compareDocumentPosition 比先后，不靠 className 拼字符串——追问 chip 有没有
    // 出现取决于模型这轮给不给，把它写进断言会让用例随模型波动而假红。
    // ⚠️ 必须限定在**同一条消息**里比：时间线开头那句阿杏问候自带一批追问 chips，
    // 用 #view-home .ax-msg__followups 全局取会取到它，顺序当然是反的。
    const orderOk = await page.evaluate(() => {
      const wrap = document.querySelector('#view-home .ax-chat-products');
      if (!wrap) return { ok: false, why: '没有卡片容器' };
      const col = wrap.closest('.ax-msg__col') || wrap.parentElement;
      const fu = col.querySelector('.ax-msg__followups');
      if (!fu) return { ok: true, why: '本轮这条消息没有追问 chip，跳过顺序断言' };
      const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
      return { ok: Boolean(wrap.compareDocumentPosition(fu) & FOLLOWING), why: '追问 chip 排在卡片后面' };
    });
    expect(orderOk.ok, orderOk.why).toBe(true);
  });
});
