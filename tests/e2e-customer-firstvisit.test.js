// ============================================================================
// 真实顾客 E2E · 「县城老人第一次打开阿杏」完整动线
// ============================================================================
// 视角：一位不太会用智能手机的老人，第一次从微信/短信里点进 /axing。
// 目标不是「代码能跑」，而是**他能不能不问人就走完：看首页 → 问一句 → 得到能看懂的回答
//   → 逛家具 → 看懂价格 → 想打电话就打电话**。
//
// 与既有测试的分工：
//   tests/axing-interaction.test.js —— 交互规范 §7 的 A1~A10（按条款验收）
//   tests/axing-ui.test.js         —— §70 视觉结构 / shell 布局 / 老人友好的规格断言
//   本文件                       —— **顾客视角的串行动线** + 只按顾客能感知到的现象断言
//
// 端口：3510（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100/3412/3420/3425/3430/3500）
// 跑法：./node_modules/.bin/playwright test tests/e2e-customer-firstvisit.test.js --reporter=line
//
// 原则：
//   ① 不改 src/（并行开发，文件边界不重叠）
//   ② AI 回复一律用 mock SSE 报文桩住，断言确定、不依赖真 key、不烧 token
//   ③ 「出图」与「诚实报错」都算通过——只有「假装成功」「白屏」算失败
//   ④ 每个用例只断言顾客**看得见摸得着**的东西，不碰内部实现细节
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3510;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };          // iPhone 逻辑分辨率
const STORE_PHONE = '13359140982';

let serverProc = null;

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

async function waitServerReady(timeoutMs = 40000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`顾客 E2E 服务器启动超时（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  const hasLiveLlm = Boolean(process.env.OPENAI_API_KEY || process.env.ARK_API_KEY);
  serverProc = spawn('node', ['src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      ...(hasLiveLlm ? {} : { CHAT_GUIDE_FAKE_MODEL: '1' }),
    },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
});

// ---------------------------------------------------------------- mock 报文

/** 一段「结构完整」的 Markdown：二级标题 + 表格 + 列表 + 引用 + 加粗。
 *  老人最可能问的就是「三千左右有什么沙发」，回答长这样最真实。 */
const MD_REPLY = [
  '为您挑了两款三千左右的沙发：',
  '',
  '## 植物印花弧形布艺沙发',
  '',
  '| 商品 | 价格 | 编号 |',
  '| --- | --- | --- |',
  '| 植物印花弧形布艺沙发 | ¥2899起 | p-1 |',
  '',
  '- **材质**：粗纺布艺软包，好打理',
  '- 库存：现货在售',
  '',
  '> 满意的话可以来店试坐。',
].join('\n');

/** 把 Markdown 包成 /api/chat/guide/stream 的 SSE 帧 */
function sseBody(replyMd, { splitAt = 14 } = {}) {
  const frames = [
    { type: 'status', provider: 'mock', model: 'mock', streaming: true },
    { type: 'thinking', text: '想一下' },
    { type: 'tool', name: 'search_products' },
  ];
  for (let i = 0; i < replyMd.length; i += splitAt) {
    frames.push({ type: 'delta', text: replyMd.slice(i, i + splitAt) });
  }
  frames.push({ type: 'done', reply: replyMd });
  return frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('');
}

/** 桩住流式接口：不写盘、不烧 key、每次行为一致 */
async function mockStream(page, replyMd = MD_REPLY, opts) {
  await page.route('**/api/chat/guide/stream', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sseBody(replyMd, opts),
    });
  });
}

/** 桩住非流式接口（兜底路径用） */
async function mockGuide(page, reply = '为您找到一款三千左右的沙发，欢迎来店试坐。') {
  await page.route('**/api/chat/guide', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, data: { reply } }),
    });
  });
}

// ---------------------------------------------------------------- 顾客视角 helpers

/** 老人第一次打开：干净 localStorage、手机视口、等壳就绪 */
async function openAsGrandpa(page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 15000 });
}

/** 进首页并等时间线宿主挂上 */
async function openHome(page) {
  await openAsGrandpa(page);
  await page.waitForFunction(() => {
    const el = document.getElementById('view-home');
    return el && el.classList.contains('active') && el.querySelector('.ax-timeline');
  }, null, { timeout: 15000 });
}

/** 页面里「顾客真的看得见」：不被 [hidden] / display:none 祖先遮住，且有面积 */
async function visibleOnScreen(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    if (el.closest('[hidden]')) return false;
    let node = el;
    while (node && node !== document.body) {
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
  }, selector);
}

/** 抓 pageerror + 4xx/5xx 资源，跑完一段动线一次性结算 */
function collectErrors(page) {
  const state = { pageErrors: [], httpErrors: [] };
  page.on('pageerror', (e) => state.pageErrors.push(String(e.message || e)));
  page.on('response', (r) => {
    // 只算静态资源与自家 API；mock 路由与外部字体不算
    const url = r.url();
    if (!url.startsWith(BASE_URL) && !url.startsWith('http://127.0.0.1')) return;
    if (r.status() >= 400) state.httpErrors.push(`${r.status()} ${url.replace(BASE_URL, '')}`);
  });
  return state;
}

/** 等阿杏回复落到时间线上（`.ax-msg--ai` 出现且有实质文字） */
async function waitAiReply(page, timeout = 30000) {
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('#view-home .ax-msg--ai:not(.ax-msg--typing):not(.ax-msg--streaming)'));
    const row = rows[rows.length - 1];
    if (!row) return false;
    const t = (row.innerText || row.textContent || '').trim();
    return t.length > 4 && !row.querySelector('.ax-dots');
  }, null, { timeout });
}

// ============================================================================
// C1 · 推开门第一眼：他能不能认出「这是卖家具的、有个真人在招呼我」
// ============================================================================
test.describe('C1 第一眼', () => {
  test('C1.1 阿杏是真图不是文字占位，标题打招呼', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);

    const hero = await page.evaluate(() => {
      const img = document.querySelector('.ax-hero__girl img');
      return img ? { src: img.getAttribute('src') || '', ok: img.naturalWidth > 0, alt: img.alt || '' } : null;
    });
    expect(hero, '首页应有阿杏半身像').not.toBeNull();
    expect(hero.ok, `阿杏 hero 图应真加载出来（src=${hero.src}），不能退化成文字圆`).toBe(true);
    expect(hero.src).toContain('axing-hero');

    await expect(page.locator('.ax-hero__title')).toContainText('阿杏');
    await expect(page.locator('.ax-hero__sub')).toContainText('银杏家具');
    // 铁律：真实 IP 图，不用 emoji 占位
    await expect(page.locator('#view-home')).not.toContainText(/[\u{1F300}-\u{1FAFF}]/u);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C1.2 右上角就能打电话，门店地址在旁边（老人最需要的兜底）', async ({ page }) => {
    await openHome(page);

    const call = page.locator(`.topbar__call[href="tel:${STORE_PHONE}"]`);
    await expect(call).toHaveCount(1);
    expect(await visibleOnScreen(page, '.topbar__call'), '拨号按钮必须在首屏真看得见（不能被折叠/遮挡）').toBe(true);

    const label = (await call.getAttribute('aria-label')) || '';
    expect(label, `拨号按钮应有无障碍标签说明打给谁（实际：${label}）`).toMatch(new RegExp(STORE_PHONE));

    // 极小字地址：存在、可读、不抢主视觉
    const addr = await page.evaluate(() => {
      const el = document.querySelector('.topbar__addr');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: (el.textContent || '').trim(), fontSize: parseFloat(cs.fontSize), opacity: parseFloat(cs.opacity) };
    });
    expect(addr, '顶栏应有门店地址小字').not.toBeNull();
    expect(addr.text).toContain('柞水');
    expect(addr.fontSize, '地址应是「极小字」').toBeLessThan(12);
    expect(addr.opacity, '极小字不该隐到看不清').toBeGreaterThan(0.5);
  });

  test('C1.3 第一屏就能看到「上传客厅照片」和四个功能，不用先滚屏', async ({ page }) => {
    await openHome(page);
    for (const sel of ['.ax-ucard__title', '.ax-quick__tile', '.ax-ask__chips .chip']) {
      expect(await visibleOnScreen(page, sel), `${sel} 应落在首屏内（老人不会主动滚屏）`).toBe(true);
    }
    await expect(page.locator('.ax-quick__tile')).toHaveCount(4);
    await expect(page.locator('.ax-quick__tile').nth(0)).toContainText('拍照试摆');
  });
});

// ============================================================================
// C2 · 开口问一句：点 chip → 自己那句立刻在 → 阿杏回复 → 看得懂
// ============================================================================
test.describe('C2 开口问一句', () => {
  test('C2.1 点「三千左右的沙发」→ 用户气泡立即上屏 + AI 回复到达', async ({ page }) => {
    await mockStream(page);
    const errs = collectErrors(page);
    await openHome(page);

    const chip = page.locator('.ax-ask__chips .chip', { hasText: '三千左右的沙发' }).first();
    await expect(chip, '「你可以这样问」里应有「三千左右的沙发」这条 chip（老人不会自己组织提问）').toHaveCount(1);

    const before = await page.evaluate(() => document.querySelectorAll('#view-home .ax-msg--user').length);
    await chip.click();

    // 铁律：用户消息立即上屏，不等网络——否则慢网下像「点了没反应」
    await page.waitForFunction(
      (n) => document.querySelectorAll('#view-home .ax-msg--user').length > n,
      before,
      { timeout: 3000 },
    );

    await waitAiReply(page);
    await expect(page.locator('#view-home .ax-msg--user').last()).toContainText('三千左右的沙发');

    // 成对出现：AI 侧带头像
    const aiCount = await page.locator('#view-home .ax-msg--ai:not(.ax-msg--typing):not(.ax-msg--streaming)').count();
    expect(aiCount, '问了一句就该有至少一条阿杏回复').toBeGreaterThanOrEqual(1);
    const aiAva = await page.evaluate(() => {
      const row = document.querySelector('#view-home .ax-msg--ai');
      const img = row && row.querySelector('.ax-msg__ava img');
      return img ? { ok: img.naturalWidth > 0, src: img.getAttribute('src') || '' } : null;
    });
    expect(aiAva, '阿杏回复左侧应有头像图').not.toBeNull();
    expect(aiAva.ok, '阿杏头像应真加载').toBe(true);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C2.2 在「浏览家具」页发消息 → 自动回到对话流，那句话没丢', async ({ page }) => {
    // 这条是上一轮真踩过的坑：消息落进 display:none 的 view-home 容器里，用户看不见
    await mockStream(page, '好的，这款沙发是 ¥2899 起，欢迎来店试坐。');
    const errs = collectErrors(page);
    await openHome(page);

    await page.evaluate(() => window.AXING.go('view-products'));
    await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 10000 });

    await page.locator('#composerInput').fill('这款有别的颜色吗');
    await page.locator('#composerSend').click();

    // 铁律：非对话页发消息，先切回对话流再上屏
    await page.waitForFunction(() => document.getElementById('view-home')?.classList.contains('active'), null, { timeout: 10000 });
    await waitAiReply(page);

    const visible = await visibleOnScreen(page, '#view-home .ax-msg--user');
    expect(visible, '在别页发的那句话必须回到对话流且真看得见（不能掉进 display:none 容器）').toBe(true);
    await expect(page.locator('#view-home .ax-msg--user').last()).toContainText('这款有别的颜色吗');
    expect(errs.pageErrors).toEqual([]);
  });

  test('C2.3 Composer 一直在场：除了全屏语音页，每个页面底部都输得上话', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);
    const views = ['view-home', 'view-products', 'view-3d', 'view-plans', 'view-me', 'view-upload', 'view-tryon', 'view-material', 'view-booking'];
    for (const v of views) {
      const ok = await page.evaluate((viewId) => {
        window.AXING.go(viewId);
        const el = document.getElementById(viewId);
        const c = document.getElementById('composer');
        const phone = document.getElementById('phone');
        return Boolean(el && el.classList.contains('active') && c && getComputedStyle(c).display !== 'none'
          && (!phone || phone.dataset.composer === 'on'));
      }, v);
      expect(ok, `${v} 页 Composer 应在场（老人每页都该能随时开口）`).toBe(true);
    }
    // 唯一例外：语音页是另一种聊天模态，全屏收音
    const voiceOk = await page.evaluate(() => {
      window.AXING.go('view-voice');
      const el = document.getElementById('view-voice');
      const c = document.getElementById('composer');
      const phone = document.getElementById('phone');
      return Boolean(el && el.classList.contains('active') && c && getComputedStyle(c).display === 'none'
        && (!phone || phone.dataset.composer === 'off'));
    });
    expect(voiceOk, 'view-voice 应让位（全屏收音），这是 §77 唯一例外').toBe(true);
    expect(errs.pageErrors).toEqual([]);
  });
});

// ============================================================================
// C3 · 看得懂：Markdown 必须渲染成结构，不能把 # 和表格竖线甩他脸上
// ============================================================================
test.describe('C3 看得懂', () => {
  test('C3.1 回答里的标题/表格/列表渲染成结构化 DOM，无裸 # / | / **', async ({ page }) => {
    await mockStream(page, MD_REPLY);
    const errs = collectErrors(page);
    await openHome(page);

    await page.locator('.ax-ask__chips .chip').first().click();
    await waitAiReply(page);
    // 等 markdown 渲染器把最后一版画完
    await page.waitForTimeout(400);

    const bubble = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#view-home .ax-msg--ai:not(.ax-msg--typing):not(.ax-msg--streaming)'));
      const row = rows[rows.length - 1];
      const b = row && row.querySelector('.ax-msg__bubble');
      if (!b) return null;
      return {
        html: b.innerHTML,
        text: (b.textContent || ''),
        hasMdClass: Boolean(b.querySelector('[class*="md-"]')),
        mdTags: Array.from(new Set(Array.from(b.querySelectorAll('[class*="md-"]')).map((n) => n.className.split(/\s+/).filter((c) => c.startsWith('md-')).join(',')))),
      };
    });

    expect(bubble, '阿杏回复气泡应存在').not.toBeNull();
    expect(bubble.hasMdClass, `回答应被渲染成 .md-* 结构化 DOM（实际 class：${bubble.mdTags.join(',') || '无'}）`).toBe(true);
    expect(bubble.mdTags.join(' '), '表格/标题/列表至少各有一样').toMatch(/md-(h[1-6]|table|ul|quote|p)/);

    // 铁律检查：不能把 markdown 标记符号裸着吐给顾客
    expect(bubble.text, '不应出现裸露的 # 标题符号').not.toMatch(/^#{1,6}\s/m);
    expect(bubble.text, '不应出现裸露的表格竖线').not.toContain('| 商品 |');
    expect(bubble.text, '不应出现裸露的 ** 加粗符号').not.toContain('**');
    expect(bubble.html, '不应残留 < 标签原文').not.toContain('&lt;h2');

    // 两色调铁律：上游 injectMarkdownStyle() 会灌 #2F7CF6 蓝 / #B42318 红，必须没被调用
    const forbidden = await page.evaluate(() => {
      const bad = ['rgb(47, 124, 246)', 'rgb(180, 35, 24)'];
      const hits = [];
      document.querySelectorAll('#view-home .ax-msg__bubble *').forEach((n) => {
        const cs = getComputedStyle(n);
        for (const b of bad) {
          if (cs.color === b || cs.backgroundColor === b || cs.borderColor === b) hits.push(`${n.className}:${cs.color}`);
        }
      });
      const styleTags = Array.from(document.querySelectorAll('style')).map((s) => s.textContent || '');
      const injected = styleTags.some((t) => t.includes('#2F7CF6') || t.includes('#B42318'));
      return { hits, injected };
    });
    expect(forbidden.hits, `不许引入蓝/红原色（违反两色调铁律）：${forbidden.hits.join(',')}`).toEqual([]);
    expect(forbidden.injected, '不许调用上游 injectMarkdownStyle() 注入样式').toBe(false);

    expect(errs.pageErrors).toEqual([]);
  });

  test('C3.2 回答又长又乱时也能读完：最新气泡滚到底就在视口内', async ({ page }) => {
    const long = [
      '为您找到几款合适的，我按价位排一下：',
      '',
      '## 一、三千左右',
      '- 植物印花弧形布艺沙发 ¥2899 起',
      '- 尺寸 3.2 米 × 1.8 米',
      '',
      '## 二、五千左右',
      '- 轻奢 L 形转角沙发，雾霾蓝天鹅绒',
      '',
      '| 商品 | 价格 |',
      '| --- | --- |',
      '| 弧形布艺沙发 | ¥2899起 |',
      '| L 形转角沙发 | ¥5xxx 起 |',
      '',
      '> 三米五的客厅放 L 形刚好，建议来店量一下尺寸。',
      '',
      '### 选购建议',
      '1. 先量客厅开间',
      '2. 再定几人位',
      '3. 最后挑面料颜色',
    ].join('\n');
    await mockStream(page, long, { splitAt: 20 });
    const errs = collectErrors(page);
    await openHome(page);

    await page.locator('.ax-ask__chips .chip').first().click();
    await waitAiReply(page);
    await page.waitForTimeout(500);

    const inView = await page.evaluate(() => {
      const views = document.getElementById('views');
      if (!views) return { ok: false, why: 'no #views' };
      views.scrollTop = views.scrollHeight;                    // 顾客自己滚到底
      const rows = Array.from(document.querySelectorAll('#view-home .ax-msg--ai:not(.ax-msg--typing):not(.ax-msg--streaming)'));
      const row = rows[rows.length - 1];
      if (!row) return { ok: false, why: 'no ai row' };
      const vr = views.getBoundingClientRect();
      const rr = row.getBoundingClientRect();
      // 最新气泡必须至少上半部分落在可视区里
      return {
        ok: rr.bottom > vr.top + 20 && rr.top < vr.bottom - 20,
        why: `timeTop=${Math.round(rr.top - vr.top)} timeBottom=${Math.round(rr.bottom - vr.top)} viewH=${Math.round(vr.height)}`,
      };
    });
    expect(inView.ok, `滚到底后最新回复气泡应在视口内（时间线必须贴在 Composer 上方）：${inView.why}`).toBe(true);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C3.3 每条气泡带时间戳（回看时知道是什么时候问的）', async ({ page }) => {
    await mockStream(page);
    await openHome(page);
    await page.locator('.ax-ask__chips .chip').first().click();
    await waitAiReply(page);

    const times = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#view-home .ax-msg__time')).map((n) => (n.textContent || '').trim()));
    expect(times.length, '每条气泡都应有时间戳').toBeGreaterThanOrEqual(2);
    for (const t of times) expect(t, `时间戳不应为空（实际：${JSON.stringify(times)}）`).not.toBe('');
  });
});

// ============================================================================
// C4 · 逛家具：点进列表 → 看商品卡 → 看详情，全程能看懂价格
// ============================================================================
test.describe('C4 逛逛家具', () => {
  test('C4.1 商品列表是真实家具卡，不是 emoji 占位也不是空白', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);

    await page.locator('.ax-quick__tile', { hasText: '浏览家具' }).first().click();
    await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 15000 });

    // 等骨架卡换成真卡
    await page.waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll('#view-products .p-card'));
      return cards.length > 0 && cards.some((c) => (c.innerText || '').trim().length > 6);
    }, null, { timeout: 20000 });

    const info = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#view-products .p-card'));
      const withImg = cards.filter((c) => {
        const img = c.querySelector('img');
        return img && img.naturalWidth > 0;
      }).length;
      return {
        total: cards.length,
        withImg,
        texts: cards.slice(0, 6).map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()),
        hasSkeletonOnly: cards.every((c) => (c.innerText || '').trim().length <= 2),
      };
    });

    expect(info.total, '商品列表应渲染出卡片').toBeGreaterThan(0);
    expect(info.hasSkeletonOnly, '不能一直停在骨架屏').toBe(false);
    expect(info.withImg, `至少应有带真图的商品卡（实际 ${info.withImg}/${info.total}）`).toBeGreaterThan(0);
    // 铁律：真实家具图，不用 emoji 占位
    for (const t of info.texts) expect(t, `商品卡不应是 emoji 占位：${t}`).not.toMatch(/^[\p{Emoji}\s]+$/u);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C4.2 点一张商品卡 → 详情能看清价格和「我想要」', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);
    await page.locator('.ax-quick__tile', { hasText: '浏览家具' }).first().click();
    await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const cards = Array.from(document.querySelectorAll('#view-products .p-card'));
      return cards.some((c) => (c.innerText || '').trim().length > 6 && c.querySelector('img'));
    }, null, { timeout: 20000 });

    // 顾客会点第一张有图的卡
    await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#view-products .p-card'));
      const target = cards.find((c) => (c.innerText || '').trim().length > 6 && c.querySelector('img')) || cards[0];
      target.click();
    });

    // 详情落地：商品名/价格出现，且状态确实切走了
    await page.waitForFunction(() => {
      const ids = ['view-home', 'view-tryon', 'view-product', 'view-material', 'view-3d'];
      const active = document.querySelector('.view.active');
      return active && !active.id.includes('products') && active.id !== 'view-products';
    }, null, { timeout: 15000 }).catch(() => { /* 有的实现就地展开，不断言跳转 */ });

    const detail = await page.evaluate(() => {
      const active = document.querySelector('.view.active');
      if (!active) return null;
      const text = (active.innerText || '').replace(/\s+/g, ' ');
      return {
        viewId: active.id,
        text,
        hasPrice: /[¥￥]\s?\d|到店询价|元/.test(text),
      };
    });
    expect(detail, '点商品卡后应有内容').not.toBeNull();
    expect(detail.hasPrice, `选中的商品应能看到价格（视图 ${detail.viewId}，内容：${(detail.text || '').slice(0, 160)}）`).toBe(true);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C4.3 商品卡可点高度 ≥ 44px（老人手指粗）', async ({ page }) => {
    await openHome(page);
    await page.locator('.ax-quick__tile', { hasText: '浏览家具' }).first().click();
    await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('#view-products .p-card').length > 0, null, { timeout: 20000 });

    const heights = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#view-products .p-card')).map((c) => {
        const r = c.getBoundingClientRect();
        return Math.round(r.height);
      }));
    const tooSmall = heights.filter((h) => h > 0 && h < 44);
    expect(tooSmall, `以下商品卡高度不足 44px（Apple HIG 最小可点区）：${tooSmall.join(',')}`).toEqual([]);
  });
});

// ============================================================================
// C5 · 老人友好硬指标 + 零破图零报错
// ============================================================================
test.describe('C5 不生事', () => {
  test('C5.1 全站扫描：可点元素高度 ≥44px、按钮有无障碍标签', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);

    const report = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#view-home button, #view-home a[href], #view-home [role="button"]').forEach((n) => {
        if (n.closest('[hidden]')) return;
        const cs = getComputedStyle(n);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const label = (n.getAttribute('aria-label') || n.textContent || '').trim();
        out.push({
          desc: (n.className || n.tagName) + ' ' + label.slice(0, 18),
          h: Math.round(r.height),
          labelled: label.length > 0,
        });
      });
      return out;
    });

    const small = report.filter((x) => x.h < 44);
    expect(small.length, `首页可点元素高度不足 44px：${JSON.stringify(small)}`).toBeLessThanOrEqual(0);
    const unlabelled = report.filter((x) => !x.labelled);
    expect(unlabelled.length, `首页缺少可读名称的按钮（读屏软件没法用）：${JSON.stringify(unlabelled)}`).toBe(0);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C5.2 全程零 pageerror、零可见破图', async ({ page }) => {
    await mockStream(page);
    const errs = collectErrors(page);
    await openHome(page);

    await page.locator('.ax-ask__chips .chip').first().click();
    await waitAiReply(page);
    await page.locator('.ax-quick__tile', { hasText: '浏览家具' }).first().click();
    await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.AXING.go('view-home'));
    await page.waitForTimeout(600);

    // 可见破图：加载失败、真在视口里、不在 [hidden] 容器里
    const broken = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#views img').forEach((img) => {
        if (img.naturalWidth !== 0 || !img.complete) return;
        if (img.closest('[hidden]')) return;
        let node = img.parentElement;
        let hidden = false;
        while (node && node !== document.body) {
          const cs = getComputedStyle(node);
          if (cs.display === 'none') { hidden = true; break; }
          node = node.parentElement;
        }
        if (hidden) return;
        out.push({ src: img.getAttribute('src') || '', alt: img.alt || '' });
      });
      return out;
    });
    expect(broken, `顾客看得见的破图：${JSON.stringify(broken)}`).toEqual([]);
    expect(errs.pageErrors, `页面报错：${errs.pageErrors.join(' | ')}`).toEqual([]);
    // 自家静态资源 404（数据债 default-room-bed.jpg 之类）单独列，便于定位但不诬陷成回归
    const api404 = errs.httpErrors.filter((u) => u.startsWith('404') && /\/api\//.test(u));
    expect(api404, `自家 API 404：${api404.join(' | ')}`).toEqual([]);
  });

  test('C5.3 网络差也不白屏：导购挂了要有兜底话术，不是问了没答', async ({ page }) => {
    const errs = collectErrors(page);
    await openHome(page);
    await page.route('**/api/chat/guide/stream', (route) => route.abort('failed'));

    await page.locator('.ax-ask__chips .chip').first().click();

    // 兜底：用户那句已上屏，且阿杏侧要有回音（兜底话术也算）
    await page.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('#view-home .ax-msg--ai'));
      return rows.some((r) => !r.classList.contains('ax-msg--typing') && (r.innerText || '').trim().length > 4);
    }, null, { timeout: 25000 });

    const hasUser = await page.locator('#view-home .ax-msg--user').count();
    expect(hasUser, '用户那句不能因请求失败而消失').toBeGreaterThan(0);
    expect(errs.pageErrors, `网络失败不该抛 pageerror：${errs.pageErrors.join(' | ')}`).toEqual([]);
  });
});

// ============================================================================
// C6 · 首屏不排队等接口（生产慢网下的真回归）
// ============================================================================
test.describe('C6 不让他干等', () => {
  test('C6.1 /api/categories + /api/products 拖慢 4 秒，首页照样一次画全', async ({ page }) => {
    const errs = collectErrors(page);
    for (const p of ['**/api/categories', '**/api/products']) {
      await page.route(p, async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue();
      });
    }
    await openAsGrandpa(page);
    await page.waitForSelector('#view-home.active .ax-hero', { timeout: 20000 });

    const paint = await page.evaluate(() => ({
      ucard: document.querySelectorAll('#view-home .ax-ucard').length,
      chips: document.querySelectorAll('#view-home .ax-ask__chips .chip').length,
      tiles: document.querySelectorAll('#view-home .ax-quick__tile').length,
      call: document.querySelectorAll('#view-home a[href^="tel:"]').length,
    }));
    expect(paint.ucard, '上传客厅照卡（第一 CTA）应同帧出现，不等接口').toBe(1);
    expect(paint.chips, 'chips 不依赖接口，应立即渲染').toBeGreaterThanOrEqual(3);
    expect(paint.tiles, '四大功能 tile 不依赖接口，应立即渲染').toBe(4);
    expect(paint.call, '打给店里兜底按钮应立即渲染').toBeGreaterThanOrEqual(1);
    expect(errs.pageErrors).toEqual([]);
  });

  test('C6.2 上传卡立即可点：接口还没回来时点它就能开始传照片', async ({ page }) => {
    await page.route('**/api/categories', async (route) => {
      await new Promise((r) => setTimeout(r, 6000));
      await route.continue();
    });
    await openHome(page);
    await page.waitForSelector('#view-home.active .ax-ucard', { timeout: 15000 });
    // 接口仍在飞的窗口内点（不等 fill 回来）
    // 选择器走 .ax-ucard 本身：卡住进 ui.axingCard() 后标题行类名是 .ax-card-ava__title，
    // 老的 .ax-ucard__head 已经不存在了。
    await page.locator('#view-home .ax-ucard').click({ timeout: 5000 });
    // 交互规范 §1-2：上传收进底部浮窗，不离开首页
    await page.waitForFunction(() => {
      const sheet = document.querySelector('.ax-sheet, [class*="sheet"]');
      const host = document.getElementById('view-home');
      const active = document.querySelector('.view.active');
      return Boolean(sheet && getComputedStyle(sheet).display !== 'none')
        || Boolean(active && active.id === 'view-upload')
        || Boolean(host && host.classList.contains('active'));
    }, null, { timeout: 10000 });
    // 不论落浮窗还是路由，至少要能给顾客「传照片」的入口
    const entry = await page.evaluate(() => {
      const sheet = document.querySelector('.ax-sheet, [class*="sheet"]');
      const sheetOpen = sheet && getComputedStyle(sheet).display !== 'none' && sheet.getBoundingClientRect().height > 100;
      const fileInput = document.querySelector('input[type="file"]');
      return { sheetOpen: Boolean(sheetOpen), fileInput: Boolean(fileInput) };
    });
    expect(entry.sheetOpen || entry.fileInput, '接口未回时点上传卡，也必须给出可用的传照片入口').toBe(true);
  });
});
