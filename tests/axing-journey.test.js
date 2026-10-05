// ============================================================================
// 真实顾客旅程 E2E（docs/阿杏交互规范.md §5 / 视觉基准 docs/最新首页图.png）
// ============================================================================
// 不是接口 smoke，是**按真人路径走完整链路**：
//   J1 张阿姨 问价 → 追问 → 商品 → 选它 → 浮窗 → 示例房间 → 试摆出图
//   J2 小李   问地址 → 预约到店 → 我的
//   J3 王叔   语音页打字 → 材质详情 → 3D → 方案
//   J4 赵姐   chip → 有问有答 → 换一换 →（猜您还想问）
//   J5       跨页发消息，自己那条必须看得见（P2 回归）
//   J6       右上角电话 / 时间戳 / 卡片头像（R6/R7/R5 回归）
//
// 端口 3460：独立 spawn，不复用 playwright.config.js 的 3000，
// 也不碰 3100/3412/3420/3425/3430/3431/3432/3433/3434/3400/3450。
// 走**真 LLM**（.env 里的 ARK/STEP key 由被 spawn 的 server.js 自己读，
// 这里不设 CHAT_GUIDE_FAKE_MODEL），所以 timeout 给得比接口测试宽。
//
// 写这个文件时踩过并已避开的坑（改选择器前先看这里，别把这些当产品 bug）：
//   1. #view-material 有 10 个 button.chip：前 5 个是「情况」，后 5 个才是材质名，
//      材质名在 .chip-scroll 里。点前 5 个只改建议文案，不出材质详情。
//   2. view-booking 的到店日期是 input[type=date]#ax-bk-date，不是 chip。
//   3. view-voice 的「阿杏正在想」也是 .bubble.ai。等回复要用「不存在
//      .bubble.ai.typing」，数 .bubble.ai 数量会死等（greeting+typing=2，
//      typing 消失后还是 2）。
//   4. #view-home .ax-msg--streaming 是流式临时气泡。等回答结束用「不存在」它，
//      别数 .ax-msg--ai。
//   5. paintMarkdown 是 async，Append 后有一小会儿空内容，等 --streaming 消失再取。
//   6. view-me 未登录会打 /api/auth/me 拿到 401——已知缺陷，不当失败，只在报告记账。
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';

const PORT = 3460;                       // ⚠️ 被占用时改 3461，别去抢别人的端口
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };
const STORE_PHONE = '13800138000';       // 预约/方案用的测试手机号

// 已知数据债：示例房间图缺失导致的 404，不算回归
const KNOWN_404 = [/default-room.*\.(jpg|png)/i];

let serverProc = null;
let pageErrors = [];
let badResponses = [];

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE_URL}${pathname}`, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
  });
}

async function waitServerReady(timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`旅程测试服务器启动超时（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  // ⚠️ 不能传 NODE_ENV=test：server.js 的 listen() 被 `if (process.env.NODE_ENV !== 'test')` 包着
  serverProc = spawn('node', ['src/server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
});

// 每条旅程都从「新顾客」开始：清掉 localStorage，免得上一条旅程选过的商品/房间串味
async function newCustomer(page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 15000 });
  // 等首页真正渲染出上传卡（第一 CTA），后面的旅程都以它为起点
  await page.waitForSelector('#view-home .ax-ucard', { timeout: 20000 });
}

/** 等阿杏把这段话说完。
 *  必须同时等两个占位都消失：
 *   - .ax-msg--streaming（流式临时气泡）
 *   - .ax-msg--typing（「阿杏正在想」抖点）
 *  只等 --streaming 会漏：LLM 一个 delta 都没给（空回复/报错走兜底）时
 *  openStreamBubble() 从未被调用，--streaming 本来就不在，但 typing 还在，
 *  这时采样会把 typing 那一行也算成「缺时间戳的气泡」。 */
async function waitAiDone(page, timeout = 150000) {
  await page.waitForFunction(
    () => !document.querySelector('#view-home .ax-msg--streaming')
       && !document.querySelector('#view-home .ax-msg--typing'),
    null, { timeout },
  );
  // paintMarkdown 是 async，再等一帧让 .md-* 节点落到 DOM 里
  await page.waitForTimeout(400);
}

/** 语音页专用：等「阿杏正在想」消失（.bubble.ai.typing 也是 .bubble.ai，别数数量） */
async function waitVoiceReply(page, timeout = 150000) {
  await page.waitForFunction(
    () => !document.querySelector('#view-voice .bubble.ai.typing'),
    null, { timeout },
  );
  await page.waitForTimeout(300);
}

async function goView(page, id) {
  await page.evaluate((v) => window.AXING.go(v), id);
  await page.waitForTimeout(900);
}

async function tabTo(page, label) {
  await page.locator('.tabbar .tab', { hasText: label }).click();
  await page.waitForTimeout(1200);
}

/** 这条旅程走完时的健康检查：不许有脚本异常；已知数据债的 404 放过 */
function expectJourneyClean() {
  const crashes = pageErrors.filter((e) => !/Failed to load resource/.test(e));
  expect(crashes, `旅程中出现脚本异常：${JSON.stringify(crashes.slice(0, 5))}`).toEqual([]);
  const real404 = badResponses.filter((r) => !KNOWN_404.some((re) => re.test(r)));
  expect(real404, `旅程中出现非数据债 404：${JSON.stringify(real404.slice(0, 5))}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  badResponses = [];
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 150)); });
  page.on('response', (r) => {
    // /api/auth/me 未登录 401 是已知缺陷（另有人在修），不当失败
    if (r.status() >= 400 && !/\/api\/auth\/me$/.test(new URL(r.url()).pathname)) {
      badResponses.push(`${r.status()} ${r.url().slice(-55)}`);
    }
  });
});

// ============================================================================
// J1 张阿姨：问价 → 追问 → 商品 → 选它 → 浮窗 → 示例房间 → 试摆
// ============================================================================
test.describe('J1 · 张阿姨（问价→挑家具→试摆）', () => {
  test('J1 走完整链路：问价得结构化回复、试摆出图或诚实报错', async ({ page }) => {
    test.slow();
    test.setTimeout(300000);
    await newCustomer(page);

    // ---- 1. 首页直接问价 ----
    await page.fill('#composerInput', '三千左右的布艺沙发有吗');
    await page.click('#composerSend');
    await waitAiDone(page);

    // 真 LLM 不保证每次都吐表格——同一句问价，有时是标题+表格，有时就是一段话。
    // 所以这里只钉**确定性的回归点**：回复非空、且不许把 Markdown 骨架裸着漏出来。
    // 「有 Markdown 语法就必须渲染成 .md-* 结构」由 J7 用 mock 的 SSE 确定性地验。
    const r1 = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('#view-home .ax-msg--ai .ax-msg__bubble')];
      const last = bubbles[bubbles.length - 1];
      return {
        n: bubbles.length,
        md: last.querySelectorAll('[class^="md-"]').length,
        kinds: [...last.querySelectorAll('[class^="md-"]')].map((e) => e.className).slice(0, 5),
        text: last.textContent,
        rawHash: last.textContent.includes('##'),
        rawPipe: /\|\s*---/.test(last.textContent) || last.textContent.includes('| 商品 |'),
      };
    });
    expect(r1.n, '问价后阿杏应该回答，不应还是只有问候那一句').toBeGreaterThan(1);
    expect(r1.text.trim().length, '回复不能是空的').toBeGreaterThan(0);
    expect(r1.rawHash, '回复里不该漏出裸的 ## 标题符').toBe(false);
    expect(r1.rawPipe, '回复里不该漏出裸的表格骨架').toBe(false);
    // 模型这轮吐了结构化内容的话，就必须真的渲染出来了
    if (r1.kinds.length > 0) {
      expect(r1.md, `渲染出了 ${r1.kinds.join(',')} 但节点数为 0`).toBeGreaterThan(0);
    }

    // ---- 2. 追问：上下文必须接上 ----
    await page.fill('#composerInput', '便宜点的呢');
    await page.click('#composerSend');
    await waitAiDone(page);
    const afterFollow = await page.evaluate(() => document.querySelectorAll('#view-home .ax-msg').length);
    expect(afterFollow, '追问后消息数应继续增长，不能问了没答').toBeGreaterThanOrEqual(5);

    // ---- 3. 商品页 ----
    await tabTo(page, '商品');
    await page.waitForSelector('#view-products.active .p-card', { timeout: 20000 });
    const cards = await page.evaluate(() => {
      const list = [...document.querySelectorAll('#view-products .p-card')];
      return {
        total: list.length,
        // §2-4：阿杏代言的卡片左边必须带头像
        withAvatar: list.filter((c) => {
          const wrap = c.closest('.ax-card-ava');
          return wrap && wrap.querySelector('img');
        }).length,
      };
    });
    expect(cards.total, '商品页应有在售家具').toBeGreaterThan(0);
    expect(cards.withAvatar, `每张商品卡都该带头像（${cards.withAvatar}/${cards.total}）`).toBe(cards.total);

    // ---- 4. 选它 ----
    await page.locator('#view-products button', { hasText: '选它' }).first().click();
    await page.waitForTimeout(900);
    const picked = await page.evaluate(() => window.AXING.state.productId);
    expect(picked, '点「选它」后应记住选了哪件家具').toBeTruthy();

    // ---- 5. 拍客厅照 → 底部浮窗 ----
    await page.locator('#view-products button', { hasText: '拍客厅照试摆' }).first().click();
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '点「拍客厅照试摆」应打开上传底部浮窗',
    ).toBe(true);

    // ---- 6. 用示例房间 ----
    const sampleChip = page.locator('#sheetPanel .chip-scroll button.chip');
    expect(await sampleChip.count(), '浮窗里应有示例房间可点').toBeGreaterThan(0);
    await sampleChip.first().click();
    await page.waitForTimeout(2500);
    expect(
      await page.evaluate(() => window.AXING.state.roomUrl),
      '选示例房间后应记下房间图',
    ).toBeTruthy();

    // ---- 7. 直接去试摆：必须先收浮窗，否则蒙版盖住整个试摆页 ----
    await page.locator('#sheetPanel button', { hasText: '直接去试摆' }).first().click();
    await page.waitForTimeout(1500);
    const nav = await page.evaluate(() => ({
      active: document.querySelector('.view.active')?.id,
      sheetOpen: document.getElementById('sheetRoot')?.classList.contains('is-open'),
    }));
    expect(nav.active, '应跳到 AI 试摆页').toBe('view-tryon');
    expect(nav.sheetOpen, '浮窗应已收起，别让蒙版盖住试摆页').toBe(false);

    // 「立即生成」必须真的可点（蒙版没收干净时 elementFromPoint 命中的是蒙版里的元素）。
    // 注意：试摆页内容较长，立即生成在 390×844 上本来就在折叠线下面，
    // elementFromPoint 用的是视口坐标，所以必须先 scrollIntoView 再测。
    const genHit = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('#view-tryon button')].find((b) => b.textContent.includes('立即生成'));
      if (!btn) return { found: false, hitSelf: false, top: -1 };
      btn.scrollIntoView({ block: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { found: true, hitSelf: Boolean(top && (top === btn || btn.contains(top))), top: Math.round(r.top) };
    });
    expect(genHit.found, '试摆页应有「立即生成」按钮').toBe(true);
    expect(genHit.hitSelf, '「立即生成」应能被打到（浮窗蒙版还盖着就会点到蒙版里的元素）').toBe(true);

    // ---- 8. 立即生成：出图，或诚实地告诉顾客为什么没出图 ----
    await page.locator('#view-tryon button', { hasText: '立即生成' }).first().click();
    await page.waitForFunction(
      () => {
        const img = document.querySelector('#view-tryon .stage img');
        if (img && img.getAttribute('src')) return true;
        return /没出图|没成功|用完了|次数/.test(document.body.textContent);
      },
      null, { timeout: 240000 },
    );
    await page.waitForTimeout(2500);
    const gen = await page.evaluate(() => ({
      hasImage: Boolean(document.querySelector('#view-tryon .stage img')?.getAttribute('src')),
      honest: /没出图|没成功|用完了|次数/.test(document.body.textContent),
    }));
    expect(
      gen.hasImage || gen.honest,
      '试摆要么出图，要么诚实说出原因（key 失效/次数用完），不能既没图也不说话',
    ).toBe(true);

    expectJourneyClean();
  });
});

// ============================================================================
// J2 小李：问地址 → 预约到店 → 我的
// ============================================================================
test.describe('J2 · 小李（问地址→预约到店）', () => {
  test('J2 问到店地址并提交预约', async ({ page }) => {
    test.setTimeout(240000);   // 真 LLM 单轮可能拖过 90s，别因为等回答而假失败
    await newCustomer(page);

    await page.fill('#composerInput', '你们店在哪');
    await page.click('#composerSend');
    await waitAiDone(page);
    expect(
      await page.evaluate(() => document.body.textContent.includes('柞水')),
      '问到店地址，回复里应出现「柞水」',
    ).toBe(true);

    await goView(page, 'view-booking');
    expect(await page.evaluate(() => document.querySelector('.view.active')?.id)).toBe('view-booking');

    // 日期是 input[type=date]#ax-bk-date，不是 chip
    await page.fill('#ax-bk-name', '小李');
    await page.fill('#ax-bk-phone', STORE_PHONE);
    await page.fill('#ax-bk-date', '2026-10-20');

    // 时段才是 chip
    const slot = page.locator('#view-booking button.chip', { hasText: /上午|下午|晚上/ }).first();
    expect(await slot.count(), '预约页应有到店时段可选').toBeGreaterThan(0);
    await slot.click();
    await page.waitForTimeout(600);

    await page.locator('#ax-bk-submit').click();
    await page.waitForFunction(
      () => /预约已收到|约好之后|到店报手机号/.test(document.body.textContent),
      null, { timeout: 30000 },
    );
    expect(
      await page.evaluate(() => /预约已收到|约好之后|到店报手机号/.test(document.body.textContent)),
      '提交后应看到预约成功的回执',
    ).toBe(true);

    await tabTo(page, '我的');
    expect(
      await page.evaluate(() => /登录|我的预约|到店预约/.test(document.body.textContent)),
      '「我的」页应有登录或预约入口',
    ).toBe(true);

    expectJourneyClean();
  });
});

// ============================================================================
// J3 王叔：语音页打字 → 材质详情 → 3D → 方案
// ============================================================================
test.describe('J3 · 王叔（语音→材质→3D→方案）', () => {
  test('J3 语音页能聊、材质有详情、3D 有兜底', async ({ page }) => {
    test.setTimeout(240000);
    await newCustomer(page);

    await goView(page, 'view-voice');
    expect(await page.locator('#view-voice .mic-btn').count(), '语音页应有话筒').toBeGreaterThan(0);

    await page.fill('#view-voice input[type=text]', '科技布和真皮哪个好');
    await page.locator('#view-voice button', { hasText: '发送' }).click();
    await waitVoiceReply(page);

    // 语音页的回复也要走 Markdown 渲染器（上一轮改造的回归点）
    const voice = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('#view-voice .bubble.ai')]
        .filter((b) => !b.classList.contains('typing'));
      const last = bubbles[bubbles.length - 1];
      return {
        n: bubbles.length,
        md: last.querySelectorAll('[class^="md-"]').length,
        rawHash: last.textContent.includes('##'),
      };
    });
    expect(voice.n, '语音页应给回复，不能只有问候').toBeGreaterThan(1);
    expect(voice.md, '语音页的 Markdown 回复也该渲染成结构化节点').toBeGreaterThan(0);
    expect(voice.rawHash, '语音页回复里不该漏出裸 ##').toBe(false);

    // 材质：材质名在 .chip-scroll 里（前 5 个「情况」chip 在别处）
    await goView(page, 'view-material');
    const matChip = page.locator('#view-material .chip-scroll button.chip');
    expect(await matChip.count(), '材质页应有材质名可点').toBeGreaterThan(0);
    await matChip.first().click();
    await page.waitForTimeout(1000);
    const mat = await page.evaluate(() => ({
      specRows: document.querySelectorAll('#view-material .spec-row').length,
      emptyVisible: [...document.querySelectorAll('#view-material .empty')]
        .filter((e) => e.offsetParent !== null).length,
    }));
    expect(mat.specRows, '点材质名应出「适合谁/怎么保养」详情').toBeGreaterThan(0);
    expect(mat.emptyVisible, '出了详情就不该还留着「点上面的名字」空态').toBe(0);

    await tabTo(page, '3D');
    await page.waitForTimeout(4000);
    const d3 = await page.evaluate(() => ({
      canvas: Boolean(document.querySelector('#view-3d canvas')),
      hint: document.querySelector('#view-3d .stage__hint')?.textContent || '',
    }));
    expect(
      d3.canvas || /看不了|先看看照片/.test(d3.hint),
      '3D 要么出 canvas，要么给「这台设备看不了」的兜底文案',
    ).toBe(true);

    await tabTo(page, '方案');
    expect(
      await page.evaluate(() => /保存当前方案|手机号/.test(document.body.textContent)),
      '方案页应有保存入口或手机号输入',
    ).toBe(true);

    expectJourneyClean();
  });
});

// ============================================================================
// J4 赵姐：chip → 有问有答 → 换一换 → 猜您还想问
// ============================================================================
test.describe('J4 · 赵姐（chip→追问）', () => {
  test('J4 点「你可以这样问」chip 有问有答，换一换真的换', async ({ page }) => {
    test.setTimeout(240000);
    await newCustomer(page);

    const askChip = page.locator('#view-home .ax-ask__chips .chip').first();
    const asked = (await askChip.textContent()).trim();
    await askChip.click();
    await waitAiDone(page);

    const msgs = await page.evaluate(() => ({
      total: document.querySelectorAll('#view-home .ax-msg').length,
      user: [...document.querySelectorAll('#view-home .ax-msg--user .ax-msg__bubble')].map((b) => b.textContent.trim()),
      ai: document.querySelectorAll('#view-home .ax-msg--ai').length,
    }));
    expect(msgs.user, `点了「${asked}」这句 chip，用户气泡应立即上屏`).toContain(asked);
    expect(msgs.ai, '点了 chip 阿杏必须回话，不能只画个用户气泡就断').toBeGreaterThan(1);

    const before = await page.locator('#view-home .ax-ask__chips .chip').allInnerTexts();
    await page.locator('.ax-ask__more').first().click();
    await page.waitForTimeout(500);
    const after = await page.locator('#view-home .ax-ask__chips .chip').allInnerTexts();
    expect(after.length, '换一换后 chips 数量不应少').toBeGreaterThanOrEqual(3);
    expect(after.join(), `「换一换」应换一批建议（还是 ${before.join()}）`).not.toBe(before.join());

    expectJourneyClean();
  });

  // spec §1-7 样式二「猜您还想问」。chat-core.js 现有 pickFollowups() +
  // appendAi(text, {followups})，这里做常驻回归闸：哪天生坏了立刻红。
  test.describe('F1 · 猜您还想问（spec §1-7 样式二）', () => {
    test('F1a AI 回复气泡下方应有追问 chip', async ({ page }) => {
      test.setTimeout(240000);
      await newCustomer(page);
      await page.locator('#view-home .ax-ask__chips .chip').first().click();
      await waitAiDone(page);

      const follow = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#view-home .ax-msg--ai')];
        const last = rows[rows.length - 1];
        return [...last.querySelectorAll('.ax-msg__col .chip')].map((c) => c.textContent.trim());
      });
      expect(follow.length, 'AI 回复后应追加「猜您还想问」的追问 chip（spec §1-7 样式二）').toBeGreaterThan(0);
    });

    test('F1b 点追问 chip 真的发出一条新消息', async ({ page }) => {
      test.setTimeout(240000);
      await newCustomer(page);
      await page.locator('#view-home .ax-ask__chips .chip').first().click();
      await waitAiDone(page);

      const before = await page.evaluate(() => document.querySelectorAll('#view-home .ax-msg').length);
      const chip = page.locator('#view-home .ax-msg--ai:last-child .ax-msg__col .chip').first();
      await chip.click();
      await page.waitForTimeout(2000);
      const after = await page.evaluate(() => document.querySelectorAll('#view-home .ax-msg').length);
      expect(after, '点追问 chip 应像用户自己发了一句话那样上屏').toBeGreaterThan(before);
    });
  });
});

// ============================================================================
// J5 跨页发消息（P2 回归）
// ============================================================================
test.describe('J5 · 在别的页面发消息（P2）', () => {
  test('J5 在商品页发消息，自动回对话流且自己那条看得见', async ({ page }) => {
    test.setTimeout(240000);
    await newCustomer(page);
    await tabTo(page, '商品');
    expect(await page.evaluate(() => document.querySelector('.view.active')?.id)).toBe('view-products');

    await page.fill('#composerInput', '北欧风格');
    await page.click('#composerSend');
    await waitAiDone(page);

    const r = await page.evaluate(() => ({
      active: document.querySelector('.view.active')?.id,
      userTexts: [...document.querySelectorAll('#view-home .ax-msg--user .ax-msg__bubble')].map((b) => b.textContent.trim()),
      aiCount: document.querySelectorAll('#view-home .ax-msg--ai').length,
    }));
    expect(r.active, '在别的页发消息应自动切回对话流').toBe('view-home');
    expect(r.userTexts, '自己刚发的那句必须在对话流里看得见').toContain('北欧风格');
    expect(r.aiCount, '阿杏必须有回音').toBeGreaterThan(1);

    expectJourneyClean();
  });
});

// ============================================================================
// J6 右上角电话 / 时间戳 / 卡片头像（R6/R7/R5 回归）
// ============================================================================
test.describe('J6 · 常驻元素（R6/R7/R5）', () => {
  test('J6 右上角极小字有门店电话和地址', async ({ page }) => {
    await newCustomer(page);
    const tr = await page.evaluate(() => {
      const call = document.querySelector('#topRight a[href^="tel:"]');
      const addr = document.querySelector('#topRight .topbar__addr');
      return {
        href: call?.getAttribute('href') || '',
        callFont: call ? parseFloat(getComputedStyle(call).fontSize) : 0,
        addr: addr?.textContent || '',
        addrFont: addr ? parseFloat(getComputedStyle(addr).fontSize) : 0,
      };
    });
    expect(tr.href, '右上角应有可点的门店电话').toBe('tel:13359140982');
    expect(tr.addr, '右上角应有门店地址').toContain('柞水');
    expect(tr.callFont, '电话应是极小字（≤11px）').toBeLessThanOrEqual(11);
    expect(tr.addrFont, '地址应是极小字（≤10px）').toBeLessThanOrEqual(10);
  });

  test('J6 每条气泡带时间戳，阿杏卡片的头像真实加载，功能入口不加头像', async ({ page }) => {
    await newCustomer(page);
    // 让对话长起来：发一句话
    await page.fill('#composerInput', '小户型沙发');
    await page.click('#composerSend');
    await waitAiDone(page);

    const msgs = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#view-home .ax-msg')];
      return {
        total: rows.length,
        allHaveTime: rows.every((r) => /^\d{1,2}:\d{2}$/.test((r.querySelector('.ax-msg__time')?.textContent || '').trim())),
        noTime: rows.filter((r) => !/^\d{1,2}:\d{2}$/.test((r.querySelector('.ax-msg__time')?.textContent || '').trim())).length,
      };
    });
    expect(msgs.total, '对话里应有消息').toBeGreaterThan(1);
    expect(msgs.noTime, `${msgs.total} 条气泡里有 ${msgs.noTime} 条缺时间戳`).toBe(0);

    const ava = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('#view-home .ax-card-ava')];
      const imgs = cards.flatMap((c) => [...c.querySelectorAll('img')]);
      const broken = imgs.filter((i) => i.naturalWidth === 0).map((i) => i.getAttribute('src'));
      return {
        cards: cards.length,
        broken,
        tabInCard: [...document.querySelectorAll('.tabbar .tab')].some((t) => t.closest('.ax-card-ava')),
        composerInCard: Boolean(document.getElementById('composer')?.closest('.ax-card-ava')),
      };
    });
    expect(ava.cards, '首页应有带头像的阿杏卡片').toBeGreaterThan(0);
    expect(ava.broken, `卡片头像破图了：${JSON.stringify(ava.broken)}`).toEqual([]);
    expect(ava.tabInCard, '底部 Tab 是功能入口，不该套在阿杏头像卡里').toBe(false);
    expect(ava.composerInCard, 'Composer 是功能入口，不该套在阿杏头像卡里').toBe(false);
  });
});

// ============================================================================
// J7 Markdown 渲染回归（确定性：mock SSE，不依赖模型心情）
// ============================================================================
test.describe('J7 · Markdown 渲染回归（确定性）', () => {
  // 真 LLM 有时只回一段话，没有标题/表格；这条用 mock 的 SSE 喂一段
  // 「一定有标题 + 表格 + 列表 + 引用」的回复，把上一轮 Markdown 改造钉死。
  const MD_REPLY = [
    '为您找到一款合适的：',
    '',
    '## 植物印花弧形布艺沙发',
    '',
    '| 商品 | 价格 | 编号 |',
    '| --- | --- | --- |',
    '| 植物印花弧形布艺沙发 | ¥2999起 | p-1 |',
    '',
    '- **科技布** 好打理',
    '- 库存：现货在售',
    '',
    '> 到店试坐，感受下面料。',
  ].join('\n');

  /** 把 SSE 逐帧写回去，模拟后端 runner.run({stream:true}) 的吐字 */
  async function mockStream(page, markdown) {
    await page.route('**/api/chat/guide/stream', async (route) => {
      const chunks = markdown.match(/[\s\S]{1,12}/g) || [];
      const body = [
        `data: ${JSON.stringify({ type: 'status', provider: 'mock', model: 'mock', streaming: true })}\n\n`,
        ...chunks.map((c) => `data: ${JSON.stringify({ type: 'delta', text: c })}\n\n`),
        `data: ${JSON.stringify({ type: 'done', reply: markdown })}\n\n`,
      ].join('');
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' },
        body,
      });
    });
  }

  test('J7 喂一段带标题+表格的回复，必须渲染成结构化节点且不漏骨架', async ({ page }) => {
    await newCustomer(page);
    await mockStream(page, MD_REPLY);

    await page.fill('#composerInput', '店里有什么沙发');
    await page.click('#composerSend');
    await waitAiDone(page);

    const r = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll('#view-home .ax-msg--ai .ax-msg__bubble')];
      const last = bubbles[bubbles.length - 1];
      return {
        h2: last.querySelectorAll('.md-h2').length,
        table: last.querySelectorAll('.md-table').length,
        th: [...last.querySelectorAll('.md-th')].map((e) => e.textContent.trim()),
        li: last.querySelectorAll('.md-li').length,
        quote: last.querySelectorAll('.md-quote').length,
        strong: last.querySelectorAll('.md-strong').length,
        text: last.textContent,
        rawHash: last.textContent.includes('##'),
        rawSep: /\|\s*---/.test(last.textContent),
        ynet: /ynet-md/.test(last.innerHTML),
      };
    });
    expect(r.h2, '二级标题应渲染成 .md-h2').toBe(1);
    expect(r.table, '表格应渲染成 .md-table').toBe(1);
    expect(r.th, '表头应是 商品/价格/编号').toEqual(['商品', '价格', '编号']);
    expect(r.li, '两条列表项应渲染成 .md-li').toBe(2);
    expect(r.quote, '引用块应渲染成 .md-quote').toBe(1);
    expect(r.strong, '**科技布** 应渲染成 .md-strong').toBe(1);
    expect(r.rawHash, '不该漏出裸 ##').toBe(false);
    expect(r.rawSep, '不该漏出表格分隔行').toBe(false);
    expect(r.ynet, '不该泄漏上游 ynet-md-* 类名').toBe(false);
  });

  test('J7b 追问上下文要真的带到后端（history 非空）', async ({ page }) => {
    await newCustomer(page);
    const seen = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/chat/guide')) {
        try { seen.push(JSON.parse(r.postData() || '{}')); } catch { /* 忽略 */ }
      }
    });

    await page.fill('#composerInput', '我要沙发');
    await page.click('#composerSend');
    await waitAiDone(page);
    await page.fill('#composerInput', '便宜点的');
    await page.click('#composerSend');
    await waitAiDone(page);

    const last = seen[seen.length - 1];
    expect(seen.length, '两轮问答应各打一次导购接口').toBeGreaterThanOrEqual(2);
    expect(
      Array.isArray(last.history) && last.history.some((h) => String(h.content).includes('沙发')),
      '第二轮必须把第一轮的上下文带给后端，否则听不懂「便宜点的」',
    ).toBe(true);
  });
});

// ============================================================================
// F2/F4 浮窗不该盖住新页面（回归）
// ============================================================================
test.describe('F2/F4 · 切 view 收浮窗', () => {
  // 浮窗是**模态**的（#sheetPanel 带 aria-modal，且 chat.css 在 data-sheet=on 时
  // 给 .tabbar 设了 pointer-events:none），所以开着浮窗时点 Tab 本来就点不动——
  // 这是设计意图，不是缺陷。顾客的出路是点蒙版 / 下拉把手 / Esc。
  // 要验的是：**代码里切 view（AI 回复里的「浏览家具」按钮、试摆页跳转等）
  // 必须顺手把浮窗收掉**，否则顾客会被蒙版困住。

  test('F4a 开着浮窗时点蒙版能出去（顾客必须有出路）', async ({ page }) => {
    await newCustomer(page);
    await page.locator('#view-home .ax-ucard').click();
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '点上传卡应打开浮窗',
    ).toBe(true);

    // 蒙版虽覆盖整个 #phone，但浮窗面板占着 120..844，蒙版中心点被面板盖着，
    // 必须点在顶部露出那条（0..120）才真的落在蒙版上。
    await page.locator('#sheetMask').click({ position: { x: 195, y: 40 } });
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '点蒙版应能关掉浮窗，顾客不能被困在浮窗里',
    ).toBe(false);
  });

  test('F4b 开着浮窗时代码切 view，浮窗应收起且 Composer 还能打字', async ({ page }) => {
    await newCustomer(page);
    await page.locator('#view-home .ax-ucard').click();
    await page.waitForTimeout(800);
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '点上传卡应打开浮窗',
    ).toBe(true);

    // 模拟「AI 回复里点了浏览家具」这类代码侧跳转
    await goView(page, 'view-products');
    const r = await page.evaluate(() => {
      const input = document.getElementById('composerInput');
      const rect = input.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return {
        active: document.querySelector('.view.active')?.id,
        sheetOpen: document.getElementById('sheetRoot')?.classList.contains('is-open'),
        inputHittable: Boolean(top && (top === input || input.contains(top))),
      };
    });
    expect(r.active, '应切到商品页').toBe('view-products');
    expect(r.sheetOpen, '切 view 后浮窗必须收起，否则蒙版盖住新页面').toBe(false);
    expect(r.inputHittable, 'Composer 输入框应能被打到（蒙版没收干净就会点到浮窗里的元素）').toBe(true);
  });

  test('F2 开着浮窗时从别的 view go 回首页，浮窗也不该又被带出来', async ({ page }) => {
    await newCustomer(page);
    await page.locator('#view-home .ax-ucard').click();
    await page.waitForTimeout(600);
    await goView(page, 'view-products');
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '切到商品页时浮窗就该收了',
    ).toBe(false);
    await goView(page, 'view-home');
    expect(
      await page.evaluate(() => document.getElementById('sheetRoot')?.classList.contains('is-open')),
      '从别的 view 回首页也不该又把浮窗带出来',
    ).toBe(false);
  });
});
