// ============================================================================
// 阿杏交互规范落地 · 验收测试（docs/阿杏交互规范.md §7 · A1~A10）
// ============================================================================
// 覆盖什么：
//   A1  #view-upload 不再是主路径，上传收进底部浮窗          （P1）
//   A2  任何页面发消息都能看到自己那条 + 阿杏回复            （P2 核心）
//   A3  「你可以这样问」chip 走完整问答链路                  （P3 核心）
//   A4  AI 回答的 Markdown 被结构化渲染，无裸 # / 表格竖线   （P4 核心）
//   A5  阿杏产出的卡片左边都有头像；功能入口不加             （P5）
//   A6  右上角极小字：打给店里 + 门店地址
//   A7  每条气泡带时间戳
//   A8  生成中可「停止生成」
//   A9  首屏无 404、无 pageerror
//   A10 十个 view 都能挂载
//
// 第二波（2026-10-05 真实顾客实测补的洞）见文件末尾 describe('B · …')：
//   B1 Composer 相册键直达上传浮窗，不自己弹系统相册
//   B2 把手命中区 ≥44px（原来是 4px，粗手指点不到）
//   B3 鼠标/触控板也能拖把手收起（触屏有隐式捕获，遮住了这个问题）
//   B4 浮窗里写明「怎么收起」
//   B5 试摆页「立即生成」在固定栏（Composer）以上，黄金路径不用滑
//   B6 追问 chip 落在滚动区内，不被固定 Composer 挡住（真链路）
//
// ⚠️ 量坐标前必须等浮窗动画真的播完：is-open 是「先加 class 再播 0.15s 过渡」，
//    class 一加上那一帧面板还在屏幕外（panelTop=634/844）。等 transform 收敛到
//    translateY(0) 才动 mouse，否则起始点落在没升上来的面板上，手势静默失效。
//
// 端口：3430（独立 spawn，不复用 playwright.config.js 的 3000，也不碰
//       3100/3412/3420 的阿杏其他测试文件）
// 单独跑：./node_modules/.bin/playwright test tests/axing-interaction.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3430;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

// 一段「结构完整」的 Markdown 回复：含二级标题 + 表格 + 列表 + 引用 + 加粗。
// 用来验证 P4：渲染后不得再有裸的 ## 和 | 商品 | 文本。
const MD_REPLY = [
  '为你找到一款合适的：',
  '',
  '## 植物印花弧形布艺沙发',
  '',
  '| 商品 | 价格 | 编号 |',
  '| --- | --- | --- |',
  '| 植物印花弧形布艺沙发 | ¥2899起 | p-1 |',
  '',
  '- **材质**：粗纺布艺软包',
  '- 库存：现货在售',
  '',
  '> 满意的话可以来店试坐。',
].join('\n');

/** 把一段 Markdown 包成 /api/chat/guide/stream 的 SSE 报文 */
function sseBody(replyMd, { splitAt = 12 } = {}) {
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

function mockStream(replyMd, opts) {
  return async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sseBody(replyMd, opts),
    });
  };
}

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

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('阿杏验收服务器启动超时');
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

/** 开首页并等壳就绪（AXING ctx 挂上 + 首页 section 有内容） */
async function openHome(page) {
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  // 等首屏结构出来。只认契约里最稳的件——标题文字「上传客厅照片」，
  // 不绑 .ax-ucard__head / .ax-ucard__inner 这类会被重构改名的中间层。
  await page.waitForSelector('#view-home .ax-ucard__title', { timeout: 15000 });
}

/**
 * 上传卡的整卡可点元素。
 * 上传卡这几轮被重构过好几次（.ax-ucard → axingCard 里 .ax-ucard__inner → .ax-ucard [role=button]），
 * 所以不绑死某一层中间结构：认「带 .ax-ucard 的容器 + 其中的 role=button」，
 * 容器自己就是按钮时也算。再退一步就用标题文字点（事件会冒泡到可点元素）。
 */
async function tapUploadCard(page) {
  const tap = page.locator('#view-home .ax-ucard[role="button"], #view-home .ax-ucard [role="button"]').first();
  const title = page.locator('#view-home .ax-ucard__title', { hasText: '上传客厅照片' }).first();
  try {
    await tap.click({ timeout: 6000 });
    return 'role-button';
  } catch {
    await title.click({ timeout: 6000 });
    return 'title-text';
  }
}

/** 等「阿杏正在想」占位消失（生成结束） */
async function waitIdle(page) {
  await page.waitForFunction(
    () => !document.querySelector('#composerStop:not([hidden])'),
    null,
    { timeout: 20000 },
  ).catch(() => { /* 有些实现不用 hidden 属性，靠 display 判断 */ });
  await page.waitForFunction(
    () => document.querySelector('#composerStop') && getComputedStyle(document.querySelector('#composerStop')).display === 'none',
    null,
    { timeout: 20000 },
  );
}

// ---------------------------------------------------------------- A6 / A7 / A9 / A10

test('A6 右上角极小字：打给店里 13359140982 + 门店地址', async ({ page }) => {
  await openHome(page);
  const right = page.locator('#topRight');
  await expect(right).toBeVisible();
  const call = right.locator('a.topbar__call');
  await expect(call).toHaveCount(1);
  await expect(call).toHaveAttribute('href', 'tel:13359140982');
  await expect(call).toContainText('13359140982');
  // 门店地址
  const addr = right.locator('.topbar__addr');
  await expect(addr).toContainText('银杏家具体验店');
  await expect(addr).toContainText('柞水县');
  // 「极小字」：字号必须 ≤ 12px
  const size = await addr.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeLessThanOrEqual(12);
  const callSize = await call.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(callSize).toBeLessThanOrEqual(12);
});

test('A7 每条气泡带时间戳', async ({ page }) => {
  await page.route('**/api/chat/guide/stream', mockStream(MD_REPLY));
  await openHome(page);
  await page.fill('#composerInput', '三千左右的沙发');
  await page.locator('#composerSend').click();
  await waitIdle(page);
  const times = page.locator('#view-home .ax-msg .ax-msg__time');
  const n = await times.count();
  expect(n).toBeGreaterThanOrEqual(2);          // 至少用户一条 + 阿杏一条
  for (let i = 0; i < n; i++) {
    await expect(times.nth(i)).toHaveText(/^\d{1,2}:\d{2}$/);
  }
});

test('A9 首屏无 404、无 pageerror', async ({ page }) => {
  const bad = [];
  const errs = [];
  page.on('response', (r) => { if (r.status() === 404) bad.push(r.url()); });
  page.on('pageerror', (e) => errs.push(e.message));
  await openHome(page);
  await page.waitForTimeout(1500);
  expect(bad, `404: ${bad.join(', ')}`).toEqual([]);
  expect(errs, `pageerror: ${errs.join(' | ')}`).toEqual([]);
});

test('A10 十个 view 都能挂载', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await openHome(page);
  const ids = [
    'view-voice', 'view-upload', 'view-products', 'view-tryon', 'view-3d',
    'view-material', 'view-booking', 'view-plans', 'view-me',
  ];
  for (const id of ids) {
    await page.evaluate((v) => window.AXING.go(v), id);
    await page.waitForFunction((v) => document.getElementById(v)?.classList.contains('active'), id, { timeout: 10000 });
    // 挂载失败时 app.js 会塞这句兜底；不能只查 .empty——view-products 的「没有符合
    // 条件的家具」是正常空态，也长这样，会误判。
    const failText = await page.evaluate((v) => {
      const box = document.getElementById(v)?.querySelector('.empty');
      return box ? box.textContent : '';
    }, id);
    expect(failText, `${id} 挂载失败：${failText}`).not.toContain('这个页面加载失败了');
  }
  expect(errs, `pageerror: ${errs.join(' | ')}`).toEqual([]);
});

// ---------------------------------------------------------------- A1 底部浮窗

test('A1 上传改底部浮窗：点首页上传卡 → 浮窗开、首页不离开', async ({ page }) => {
  test.slow();                       // 上传卡要等 categories API 回来才填图
  await openHome(page);
  // 未开时浮窗必须真的藏起来（display:none，不是只靠 hidden 属性）
  const hiddenBefore = await page.evaluate(() => {
    const r = document.getElementById('sheetRoot');
    return !r || getComputedStyle(r).display === 'none';
  });
  expect(hiddenBefore).toBe(true);

  // 用哪一种可点元素都行（实现分层在演进），关键是点完要真的把浮窗开起来
  await tapUploadCard(page);
  await page.waitForFunction(
    () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
    null,
    { timeout: 8000 },
  );

  // 浮窗可见，且首页仍在场（不是跳走）
  await expect(page.locator('#sheetRoot')).toBeVisible();
  const active = await page.evaluate(() => document.querySelector('.view.active')?.id);
  expect(active).toBe('view-home');

  // 浮窗里有上传三件套：拍照 / 相册 / 示例房间
  const panel = page.locator('#sheetPanel');
  await expect(panel).toContainText('拍一张客厅照');
  await expect(panel).toContainText('从相册选择');

  // 关得掉：点蒙版
  await page.locator('#sheetMask').click({ force: true });
  await page.waitForFunction(
    () => !document.getElementById('sheetRoot')?.classList.contains('is-open'),
    null,
    { timeout: 5000 },
  );
});

// ---------------------------------------------------------------- A2 / A3 常驻对话 + chip

test('A2 在别的页面发消息 → 自动回对话流，自己那条可见（P2 核心）', async ({ page }) => {
  await page.route('**/api/chat/guide/stream', mockStream(MD_REPLY));
  await openHome(page);

  // 切到商品页（非对话页）
  await page.evaluate(() => window.AXING.go('view-products'));
  await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 10000 });

  // 在商品页用 Composer 发一句话
  await page.fill('#composerInput', '有没有三千左右的布艺沙发');
  await page.locator('#composerSend').click();

  // 必须自动切回对话流
  await page.waitForFunction(() => document.getElementById('view-home')?.classList.contains('active'), null, { timeout: 10000 });
  await waitIdle(page);

  const msgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#view-home .ax-msg')).map((m) => ({
      side: m.classList.contains('ax-msg--user') ? 'user' : 'ai',
      text: (m.querySelector('.ax-msg__bubble')?.textContent || '').trim(),
    })),
  );
  // 自己那条必须在，且 textContent 与发送内容一致
  const mine = msgs.find((m) => m.side === 'user' && m.text.includes('三千左右的布艺沙发'));
  expect(mine, `用户气泡没出现：${JSON.stringify(msgs)}`).toBeTruthy();
  // 阿杏也回答了（Markdown 渲染后的正文，不含裸 # 和竖线）
  const ai = msgs.find((m) => m.side === 'ai' && m.text.includes('植物印花弧形布艺沙发'));
  expect(ai, `阿杏回复没出现：${JSON.stringify(msgs)}`).toBeTruthy();
  expect(ai.text).not.toContain('##');
  expect(ai.text).not.toContain('| 商品 |');
});

test('A3 点「你可以这样问」chip → 用户气泡 + AI 回复都出现（P3 核心）', async ({ page }) => {
  const hits = [];
  page.on('request', (r) => { if (r.url().includes('/api/chat/guide')) hits.push(r.url()); });
  await page.route('**/api/chat/guide/stream', mockStream(MD_REPLY));
  await openHome(page);

  const chips = page.locator('#view-home .ax-ask__chips .chip');
  await expect(chips.first()).toBeVisible();
  await chips.first().click();

  await waitIdle(page);

  // 真的打了导购接口（原来只 appendChat，一次请求都不发）
  expect(hits.length, `导购接口一次都没调：${hits.join(', ')}`).toBeGreaterThan(0);

  const msgs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#view-home .ax-msg')).map((m) => ({
      side: m.classList.contains('ax-msg--user') ? 'user' : 'ai',
      text: (m.querySelector('.ax-msg__bubble')?.textContent || '').trim(),
    })),
  );
  expect(msgs.some((m) => m.side === 'user'), 'chip 点了但没有用户气泡').toBe(true);
  expect(msgs.some((m) => m.side === 'ai' && m.text.includes('植物印花弧形布艺沙发')), 'chip 点了但没有 AI 回复').toBe(true);
});

// ---------------------------------------------------------------- A4 Markdown

test('A4 AI 回答的 Markdown 被结构化渲染（P4 核心）', async ({ page }) => {
  await page.route('**/api/chat/guide/stream', mockStream(MD_REPLY));
  await openHome(page);
  await page.fill('#composerInput', '推荐一款沙发');
  await page.locator('#composerSend').click();
  await waitIdle(page);

  // 结构化节点必须出现
  await expect(page.locator('#view-home .ax-msg--ai .md-h2').first()).toBeVisible();
  await expect(page.locator('#view-home .ax-msg--ai .md-table').first()).toBeAttached();
  await expect(page.locator('#view-home .ax-msg--ai .md-li').first()).toBeAttached();
  await expect(page.locator('#view-home .ax-msg--ai .md-quote').first()).toBeAttached();

  // 表格里必须真的有单元格
  const thCount = await page.locator('#view-home .ax-msg--ai .md-table .md-th').count();
  expect(thCount).toBeGreaterThanOrEqual(3);   // 商品 | 价格 | 编号

  // 不得漏出裸 Markdown
  const bubbleText = await page.evaluate(() =>
    (document.querySelector('#view-home .ax-msg--ai:last-of-type .ax-msg__bubble')?.textContent || ''),
  );
  expect(bubbleText).not.toContain('##');
  expect(bubbleText).not.toContain('| ---');
  expect(bubbleText).not.toContain('| 商品 |');

  // 表格标题文字真的进去了
  await expect(page.locator('#view-home .ax-msg--ai .md-table')).toContainText('植物印花弧形布艺沙发');
  await expect(page.locator('#view-home .ax-msg--ai .md-table')).toContainText('¥2899起');
});

// ---------------------------------------------------------------- A5 卡片头像

test('A5 阿杏产出的卡片左边都有头像；功能入口不加（P5 核心）', async ({ page }) => {
  await openHome(page);
  await page.waitForTimeout(1200);   // 等首页结构完全落定

  // 首页至少有一个带头像的阿杏卡片
  const cards = page.locator('#view-home .ax-card-ava');
  const n = await cards.count();
  expect(n, '首页没有 .ax-card-ava 卡片').toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const ava = cards.nth(i).locator('.ax-avatar img, img');
    await expect(ava.first()).toBeAttached();
    const src = await ava.first().getAttribute('src');
    expect(src, '卡片头像缺图').toBeTruthy();
  }

  // 商品卡带头像
  await page.evaluate(() => window.AXING.go('view-products'));
  await page.waitForFunction(() => document.getElementById('view-products')?.classList.contains('active'), null, { timeout: 10000 });
  await page.waitForSelector('#view-products .p-card', { timeout: 15000 });
  const pcardAva = await page.evaluate(() => {
    const c = document.querySelector('#view-products .p-card');
    if (!c) return null;
    // 允许「卡片自己在 .ax-card-ava 里」或「卡片内部有头像」两种实现
    const wrap = c.closest('.ax-card-ava');
    const inner = c.querySelector('.ax-avatar img, img.ax-avatar__img');
    return {
      wrapped: !!wrap,
      hasInnerAvatar: !!inner,
      innerSrc: inner ? inner.getAttribute('src') : null,
    };
  });
  expect(pcardAva.wrapped || pcardAva.hasInnerAvatar, `商品卡没有头像前缀：${JSON.stringify(pcardAva)}`).toBe(true);

  // 纯功能入口不加头像：底部 Tab 与 Composer 按钮不能在 .ax-card-ava 里
  const leaked = await page.evaluate(() => ({
    tabs: document.querySelectorAll('#tabbar .ax-card-ava').length,
    composer: document.querySelectorAll('#composer .ax-card-ava').length,
  }));
  expect(leaked.tabs).toBe(0);
  expect(leaked.composer).toBe(0);
});

// ---------------------------------------------------------------- A8 停止生成

test('A8 生成中可「停止生成」', async ({ page }) => {
  // 让流一直挂着不返回，把客户端钉在「正在想」状态
  await page.route('**/api/chat/guide/stream', async (route) => {
    await new Promise((r) => setTimeout(r, 30000));
  });
  await openHome(page);

  await page.fill('#composerInput', '推荐一款沙发');
  await page.locator('#composerSend').click();

  // 发送键让位给停止键
  await page.waitForFunction(
    () => {
      const s = document.getElementById('composerSend');
      const t = document.getElementById('composerStop');
      return s && t && getComputedStyle(s).display === 'none' && getComputedStyle(t).display !== 'none';
    },
    null,
    { timeout: 8000 },
  );

  // 「正在想」占位在场
  const typingBefore = await page.evaluate(() => !!document.querySelector('#view-home .ax-msg--typing'));
  expect(typingBefore).toBe(true);

  await page.locator('#composerStop').click();

  // 停止后（spec §1-3）：占位消失、脱离生成态、停止键收回。
  // 不断言发送键回来——它的显隐由输入框有没有字决定（chat-composer 的单一逻辑），
  // 此时输入框已空，发送键本来就该是隐藏的。
  await page.waitForFunction(() => window.AXING && window.AXING.chat && !window.AXING.chat.isBusy(), null, { timeout: 8000 });
  await page.waitForFunction(
    () => getComputedStyle(document.getElementById('composerStop')).display === 'none',
    null,
    { timeout: 8000 },
  );
  const typingAfter = await page.evaluate(() => !!document.querySelector('#view-home .ax-msg--typing'));
  expect(typingAfter).toBe(false);
  // 输入框恢复正常（不再是「阿杏正在想…」的只读态）
  const inputState = await page.evaluate(() => {
    const i = document.getElementById('composerInput');
    return { readOnly: i.readOnly, placeholder: i.placeholder };
  });
  expect(inputState.readOnly).toBe(false);
  expect(inputState.placeholder).not.toContain('正在想');
});

test('B6 追问 chip 落在滚动区内，不被固定 Composer 挡住（真链路）', async ({ page }) => {
  test.slow();                       // 真模型，和 S1 一样按十几秒算
  await openHome(page);
  await page.fill('#composerInput', '三千左右的布艺沙发');
  await page.locator('#composerSend').click();
  // streaming 和 typing 都必须消失才算答完：懒建的流式气泡在第一个 delta 前不存在，
  // 只用「没有 streaming」判断会立刻 resolve（Agent F 踩过）。
  await page.waitForFunction(() => {
    const t = document.querySelector('#view-home .ax-msg--typing');
    const s = document.querySelector('#view-home .ax-msg--streaming');
    const stop = document.getElementById('composerStop');
    return !t && !s && !(stop && stop.offsetParent !== null);
  }, null, { timeout: 60000 });

  const m = await page.evaluate(() => {
    const row = document.querySelector('#view-home .ax-msg--ai:last-child');
    const chip = row?.querySelector('.ax-msg__followups .chip');
    if (!chip) return { chip: false };
    const views = document.getElementById('views');
    const c = chip.getBoundingClientRect();
    const v = views.getBoundingClientRect();
    const mid = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return {
      chip: true,
      overflow: Math.round(c.bottom - v.bottom),
      hitSelf: !!mid && (chip === mid || chip.contains(mid)),
    };
  });
  expect(m.chip, '这一轮没有产出追问 chip，测不到位置').toBe(true);
  // 追问 chip 是刚长出来的可点东西，必须在滚动区内。曾经它被顶到 Composer 底下
  // 63px——气泡里的 markdown 是异步画完继续长高的，append 时那次 scrollToEnd 滚的是
  // 「还没有答案」的高度，而 ResizeObserver 的 <80px 防拽阈值到这一步已经放弃。
  expect(m.overflow, `追问 chip 溢出滚动区 ${m.overflow}px（被固定 Composer 挡住）`).toBeLessThanOrEqual(0);
  expect(m.hitSelf, '追问 chip 被别的东西盖住').toBe(true);
});

// ---------------------------------------------------------------- 真实链路冒烟

test('S1 真实链路：Agents SDK 流式跑通，回复含表格/标题', async ({ page }) => {
  test.slow();                       // 真模型要十几秒
  await openHome(page);
  await page.fill('#composerInput', '三千左右的布艺沙发');
  await page.locator('#composerSend').click();
  await waitIdle(page);

  const aiText = await page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll('#view-home .ax-msg--ai .ax-msg__bubble'));
    return msgs.length ? msgs[msgs.length - 1].textContent : '';
  });
  expect(aiText.length, '真实链路没有拿到回复').toBeGreaterThan(20);
  // 后端GuideInstructions要求推荐用表格+二级标题，渲染后应留下结构化节点或至少不漏裸管道符
  expect(aiText).not.toContain('| ---');
  const hasTableNode = await page.locator('#view-home .ax-msg--ai .md-table').count();
  if (hasTableNode === 0) {
    // 模型这次没出表格也接受，但绝不能漏出裸 Markdown 表格行
    expect(aiText).not.toMatch(/\|\s*---/);
  }
});

// ============================================================================
// B · 第二次真实顾客实测的回归守门员（2026-10-05，Playwright 探针发现的洞）
// ============================================================================
// 这几条各自对应一次「改了会静默烂掉」的修复，没有测试守着就会复发：
//   B1 Composer 相册键直达上传浮窗，不自己弹系统相册
//      —— 原实现自己弹 OS 选图框，顾客取消就是一次零反馈的空点；且看不到示例房间。
//   B2 把手命中区 ≥44px
//      —— 原来只有 4px 高。这是顾客拖掉浮窗的手势出口（蒙版只露顶部一条、Tab 被
//         pointer-events:none 挡着），4px 对粗手指等于没有，而 F1 的 44px 检查只量
//         button/tile，漏了这类 div 手柄。
//   B3 鼠标/触控板也能拖把手收起
//      —— pointermove 监听在 panel 上，手指拖出浮窗体后事件不再到达；触屏有隐式
//         捕获所以看着是好的，笔记本触控板下完全失效。修法是 setPointerCapture。
//         Playwright 的 mouse 就是无隐式捕获的那条路径，正好当回归用。
//   B4 浮窗里有「怎么收起」的一句话
//      —— 三个出口对老人都是隐形的，必须写出来。
//   B5 试摆页「立即生成」在固定栏（Composer）以上
//      —— 按钮原来排在所有 chips 后面，390×844 上 top=905，黄金路径落地还得再滑一下。
// ============================================================================
test.describe('B · 上传浮窗与试摆主按钮（第二波实测洞）', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); });

  test('B1 Composer 相册键直达上传浮窗（不自己弹系统相册）', async ({ page }) => {
    await page.locator('#composerImage').click();
    await page.waitForFunction(
      () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
      null, { timeout: 8000 },
    );
    // 不能自己弹 file chooser：一弹就意味着「取消 = 空点」+「看不到示例房间」
    const panel = page.locator('#sheetPanel');
    await expect(panel).toContainText('拍一张客厅照');
    await expect(panel).toContainText('从相册选择');
    // 浮窗开着时人不离开对话页
    expect(await page.evaluate(() => document.querySelector('.view.active')?.id)).toBe('view-home');
  });

  test('B2 把手命中区 ≥44px（老人手指）', async ({ page }) => {
    await page.evaluate(() => window.AXING.openUpload());
    await page.waitForFunction(
      () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
      null, { timeout: 8000 },
    );
    const h = await page.evaluate(() => {
      const g = document.querySelector('#sheetPanel .ax-sheet__grip');
      return g ? g.getBoundingClientRect().height : 0;
    });
    expect(h, `把手只有 ${h}px 高，粗手指点不到`).toBeGreaterThanOrEqual(44);
  });

  test('B3 用鼠标拖把手也能收起浮窗（触屏以外的手势）', async ({ page }) => {
    await page.evaluate(() => window.AXING.openUpload());
    await page.waitForFunction(
      () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
      null, { timeout: 8000 },
    );
    // 必须等推入动画真的播完再量坐标。is-open 是「先加 class、再播 0.15s 过渡」，
    // class 一加上那一帧面板还在屏幕外（实测 panelTop=634/844，把手 y=642）。
    // 所以判据不能是「把手在视口内」——滑行途中它就有一刻是满足的，随后 mouse
    // 起始点落在还没升上来的面板上，整条手势静默失效（首次写这条就这么假失败）。
    // 直接等 transform 收敛到 translateY(0)：只有动画结束才成立，确定性强。
    await page.waitForFunction(() => {
      const pn = document.getElementById('sheetPanel');
      if (!pn) return false;
      const tr = getComputedStyle(pn).transform;
      return tr === 'none' || tr === 'matrix(1, 0, 0, 1, 0, 0)';
    }, null, { timeout: 5000 });

    // page.mouse 走的是无隐式指针捕获的那条路：拖出浮窗体后事件若不到把手，就关不掉。
    // 这正是 setPointerCapture 修的那条路径（触屏有隐式捕获，测不出来）。
    const grip = await page.locator('#sheetPanel .ax-sheet__grip').boundingBox();
    expect(grip, '量不到把手').not.toBeNull();
    const cy = grip.y + grip.height / 2;
    await page.mouse.move(grip.x + grip.width / 2, cy);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, cy - 90, { steps: 10 });
    await page.mouse.up();
    await page.waitForFunction(
      () => !document.getElementById('sheetRoot')?.classList.contains('is-open'),
      null, { timeout: 5000 },
    );
  });

  test('B4 浮窗里写明「怎么收起」', async ({ page }) => {
    await page.evaluate(() => window.AXING.openUpload());
    await page.waitForFunction(
      () => document.getElementById('sheetRoot')?.classList.contains('is-open'),
      null, { timeout: 8000 },
    );
    await expect(page.locator('#sheetPanel')).toContainText(/上滑|收起/);
  });

  test('B5 试摆页「立即生成」在固定栏以上（黄金路径不用滑）', async ({ page }) => {
    test.slow();
    // 走真实黄金路径：浮窗 → 示例房间 → 直接去试摆
    await page.evaluate(() => window.AXING.openUpload());
    await page.waitForSelector('#sheetPanel .chip-scroll button.chip', { timeout: 15000 });
    await page.locator('#sheetPanel .chip-scroll button.chip').first().click();
    await page.waitForFunction(() => Boolean(window.AXING.state.roomUrl), null, { timeout: 30000 });
    await page.locator('#sheetPanel button', { hasText: '直接去试摆' }).click();
    await page.waitForFunction(
      () => document.querySelector('.view.active')?.id === 'view-tryon', null, { timeout: 10000 },
    );
    // 等浮窗真的收干净再量：closeUploadSheet 是「先去掉 is-open，等 0.15s 推退动画播完
    // 再 hidden=true」。动画还没播完时 #sheetPanel 仍然盖在屏幕上，elementFromPoint
    // 命中的是浮窗而不是主按钮（实测首次写这条时就这样假失败）。
    await page.waitForFunction(() => {
      const r = document.getElementById('sheetRoot');
      return !!r && (r.hidden || getComputedStyle(r).display === 'none');
    }, null, { timeout: 5000 });
    // 再等 viewIn 过渡结束，transform 会带走命中点
    await page.waitForFunction(
      () => (document.querySelector('.view.active')?.getAnimations?.().length || 0) === 0,
      null, { timeout: 5000 },
    ).catch(() => { /* 老浏览器没有 getAnimations，不等也行 */ });
    await page.waitForFunction(() => Boolean(
      Array.from(document.querySelectorAll('#view-tryon button'))
        .find((x) => x.textContent.includes('立即生成')),
    ), null, { timeout: 10000 });

    const m = await page.evaluate(() => {
      const gen = Array.from(document.querySelectorAll('#view-tryon button'))
        .find((x) => x.textContent.includes('立即生成'));
      const comp = document.getElementById('composer');
      // 挡住底部的是固定 Composer（72px，紧贴 Tab 上面），不是 Tab 本身
      const chrome = comp && comp.offsetParent !== null ? comp : document.getElementById('tabbar');
      const g = gen.getBoundingClientRect();
      const c = chrome.getBoundingClientRect();
      const mid = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
      return {
        genBottom: g.bottom, chromeTop: c.top,
        hitSelf: !!mid && (gen === mid || gen.contains(mid)),
      };
    });
    expect(m.genBottom, `主按钮 bottom=${Math.round(m.genBottom)} 落到固定栏 top=${Math.round(m.chromeTop)} 下面了`).toBeLessThanOrEqual(m.chromeTop);
    expect(m.hitSelf, '主按钮首屏点不到（被固定栏或蒙版盖住）').toBe(true);
  });
});
