// ============================================================================
// 真实顾客测试 · C 组：常驻对话中枢跨页一致性（e2e-customer-chat.test.js）
// ============================================================================
// 覆盖的核心不变式：v2.1 spec §70.1「任何状态都不能让用户失去 Chat」
//   —— 这是 PM 批判 🔴 ②，也是交互规范 P2 修的那个真 bug
//       （在别页发消息，自己那条落进 display:none 的容器里）。
//
// 断言四件套（每个 view 都跑一遍）：
//   (a) 消息切回首页后看得见
//   (b) 消息只有一条（全文档 .ax-msg 数 == 首页 .ax-msg 数，防 display:none 容器里再 append 一份）
//   (c) 最新气泡落在 #views 视口内（时间线必须贴在 Composer 上方）
//   (d) 无 pageerror
//
// 端口：3512（独立 spawn。不碰 3000 常驻实例，也不碰 3100/3412/3420/3430）
// 单独跑：./node_modules/.bin/playwright test tests/e2e-customer-chat.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3512;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

/** 一段结构完整的 Markdown 回复，用来确认真回复上屏（不是兜底话术） */
const REPLY_MD = [
  '为你找到一款合适的：',
  '',
  '## 植物印花弧形布艺沙发',
  '',
  '| 商品 | 价格 |',
  '| --- | --- |',
  '| 植物印花弧形布艺沙发 | ¥2899起 |',
  '',
  '- **材质**：粗纺布艺软包',
].join('\n');
const REPLY_MARK = '植物印花弧形布艺沙发';

/** 除 view-voice 外都要跑同一套的 view（view-voice 是唯一例外，单独验证） */
const VIEWS_ALL = [
  'view-home',
  'view-products',
  'view-3d',
  'view-plans',
  'view-me',
  'view-tryon',
  'view-material',
  'view-booking',
];

// ---------------------------------------------------------------- 服务器

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

async function waitServerReady(timeoutMs = 25000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('C 组服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

let serverProc = null;

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

// ---------------------------------------------------------------- mock / helper

/** 把一段 Markdown 包成 /api/chat/guide/stream 的 SSE 报文 */
function sseBody(replyMd, { splitAt = 12, delayFrames = 0 } = {}) {
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

/** 正常流式 mock：状态 → 思考 → 工具 → 若干 delta → done */
function mockStream(replyMd = REPLY_MD) {
  return async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: sseBody(replyMd),
    });
  };
}

/** 挂住的流：只发 status，之后永远不给数据（用于测超时/停止生成） */
function mockHangStream() {
  return async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      body: 'data: {"type":"status","provider":"mock","model":"mock","streaming":true}\n\n',
    });
  };
}

async function openHome(page) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(`${BASE_URL}/axing`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.AXING && document.querySelector('#view-home.active'), null, { timeout: 15000 });
  await page.waitForSelector('#view-home .ax-ucard__title', { timeout: 15000 });
}

async function goView(page, id) {
  await page.evaluate((v) => window.AXING.go(v), id);
  await page.waitForFunction((v) => document.getElementById(v)?.classList.contains('active'), id, { timeout: 20000 });
}

/**
 * 等一轮对话彻底定局。
 * 不能只等「停止生成键收起」——点击发送的瞬间 busy 还是 false，那一刻键就是收起的，
 * 会瞬间通过、抢在 send() 还在 await ctx.go('view-home') 的时候拍快照。
 * 所以顺序必须是：用户气泡真的进 chat-core → busy 落下 → 占位/流式行清空 → 让异步 markdown 画完。
 */
async function waitSettled(page, sentText) {
  await page.waitForFunction((t) => {
    const c = window.AXING && window.AXING.chat;
    return Boolean(c) && c.messages.some((m) => m.role === 'user' && m.text === t);
  }, sentText, { timeout: 20000 });
  await page.waitForFunction(() => {
    const c = window.AXING && window.AXING.chat;
    if (!c || c.isBusy()) return false;
    return document.querySelectorAll('.ax-msg--typing, .ax-msg--streaming').length === 0;
  }, null, { timeout: 40000 });
  // 气泡正文走异步 markdown 渲染，高度在渲染完才定型（正是要测的点之一）
  await page.waitForTimeout(200);
}

/** 抓全文档 + 首页两份消息清单，用来对数量（display:none 容器 duplication 就藏在这里） */
async function snapshot(page) {
  return page.evaluate(() => {
    const pick = (root) => Array.from(root.querySelectorAll('.ax-msg')).map((m) => ({
      side: m.classList.contains('ax-msg--user') ? 'user' : 'ai',
      typing: m.classList.contains('ax-msg--typing'),
      streaming: m.classList.contains('ax-msg--streaming'),
      text: (m.querySelector('.ax-msg__bubble')?.textContent || '').trim(),
    }));
    const views = document.getElementById('views');
    const host = document.getElementById('chatHost') || document.querySelector('.ax-timeline');
    // 最新一条**正文**气泡（排除占位与流式临时行）
    const rows = host
      ? Array.from(host.querySelectorAll('.ax-msg')).filter((m) => !m.classList.contains('ax-msg--typing'))
      : [];
    const last = rows[rows.length - 1];
    const comp = document.getElementById('composer');
    const stack = document.querySelector('#view-home > .stack');
    return {
      all: pick(document),
      home: pick(document.getElementById('view-home') || document),
      homeActive: !!document.querySelector('#view-home.active'),
      scroll: views ? { top: views.scrollTop, height: views.scrollHeight, client: views.clientHeight } : null,
      lastBubbleBottom: last ? last.getBoundingClientRect().bottom : null,
      viewsBottom: views ? views.getBoundingClientRect().bottom : null,
      composerTop: comp ? comp.getBoundingClientRect().top : null,
      hostIndex: host && stack ? Array.from(stack.children).indexOf(host) : -1,
      blockCount: stack ? stack.children.length : -1,
      inputs: Array.from(document.querySelectorAll('#composerInput')).map((i) => ({
        value: i.value,
        readOnly: i.readOnly,
        placeholder: i.placeholder,
        focused: document.activeElement === i,
      })),
      axingMsgs: window.AXING && window.AXING.chat ? window.AXING.chat.messages.length : -1,
    };
  });
}

/** 在 Composer 里发一句话并点发送 */
async function sendFromComposer(page, text) {
  await page.fill('#composerInput', text);
  await page.locator('#composerSend').click();
}

/** 兼容旧调用名：语义已改为「发一句并等它彻底定局」 */
async function sendAndSettle(page, text) {
  await sendFromComposer(page, text);
  await waitSettled(page, text);
}

/**
 * 核心四件套断言。
 * @param {string} sent 发出去的原文
 * @param {boolean} expectAiReply 是否要求阿杏真回复（mock 了正常流时为 true）
 */
async function assertInvariant(page, sent, expectAiReply, label) {
  const s = await snapshot(page);

  expect(s.homeActive, `${label}：必须自动切回对话流 view-home`).toBe(true);

  // (a) 自己那条看得见
  const mine = s.home.filter((m) => m.side === 'user' && m.text.includes(sent));
  expect(mine.length, `${label}：用户气泡应恰好 1 条，实际 ${mine.length} → ${JSON.stringify(s.home)}`).toBe(1);
  expect(mine[0].text).toBe(sent);

  // (a') 阿杏必须有回音：真回复或兜底话术都算，空洞不算
  const ai = s.home.filter((m) => m.side === 'ai' && !m.typing);
  const lastAi = ai[ai.length - 1];
  expect(lastAi, `${label}：时间线出现「问了没答」的空洞`).toBeTruthy();
  if (expectAiReply) {
    expect(lastAi.text, `${label}：阿杏没给出 mock 的回复`).toContain(REPLY_MARK);
  } else {
    expect(lastAi.text.length, `${label}：兜底话术为空`).toBeGreaterThan(0);
  }

  // (b) 不多不少：全文档数量 == 首页数量，且与 chat-core 内部消息数一致
  //     （这条专门抓「落进 display:none 容器」——那里的 .ax-msg 会算进 all 但不算进 home）
  expect(s.all.length, `${label}：全文档有 ${s.all.length} 条，首页只有 ${s.home.length} 条，疑似落进了隐藏容器`).toBe(s.home.length);
  expect(s.home.length, `${label}：首页消息数与 chat-core 内部不一致（重复渲染或丢失）`).toBe(s.axingMsgs);
  // 同一条 user 消息不能出现第二次
  const dup = s.all.filter((m) => m.side === 'user' && m.text === sent).length;
  expect(dup, `${label}：同一条用户消息出现 ${dup} 次`).toBe(1);

  // (c1) 新消息必须从 Composer 上方长出来（交互规范 §4-1 铁律 / v1.2 修正）
  //      timeline 后面若还挂着「你可以这样问」+「打给店里」，滚到底看到的就是它们，
  //      最新气泡被顶到折叠线以上——正是 v1.0/v1.1 被推翻的那个排法。
  expect(s.lastBubbleBottom, `${label}：量不到最新气泡`).not.toBeNull();
  const gapToComposer = s.composerTop - s.lastBubbleBottom;
  expect(
    gapToComposer,
    `${label}：最新气泡底边距 Composer ${Math.round(gapToComposer)}px（规范要求贴着输入框长出来）。`
    + `timeline 是第 ${s.hostIndex}/${s.blockCount - 1} 块，后面还挂着 ${s.blockCount - 1 - s.hostIndex} 块内容`,
  ).toBeLessThanOrEqual(48);

  // (c2) 滚到位：chat-core 契约是「来新消息就 views.scrollTop = views.scrollHeight」。
  //      appendAi 是同步滚的，但气泡正文走异步 markdown 渲染，高度在滚动之后才定型，
  //      之后没有补偿滚动 → scrollGap 会一直留着。
  expect(
    s.scroll.height - s.scroll.top - s.scroll.client,
    `${label}：scrollToEnd 之后仍差 ${s.scroll.height - s.scroll.top - s.scroll.client}px 才到底`
    + '（疑因异步 markdown 渲染使高度在滚动之后才增长，且无补偿滚动）',
  ).toBeLessThanOrEqual(2);

  // 没有残留占位 / 流式临时气泡
  expect(s.home.some((m) => m.typing), `${label}：「阿杏正在想」占位没撤掉`).toBe(false);
  expect(s.home.some((m) => m.streaming), `${label}：流式临时气泡没转正`).toBe(false);
}

// ============================================================================
// 1. 跨 view 恒等式：每个 view 都发一句话，四件套全过
// ============================================================================
test.describe('1 · 任何页面发消息都看得见（P2 核心）', () => {
  for (const view of VIEWS_ALL) {
    test(`1.${VIEWS_ALL.indexOf(view) + 1} 在 ${view} 发消息 → 回对话流、只一条、在视口内`, async ({ page }) => {
      test.slow();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.route('**/api/chat/guide/stream', mockStream());

      await openHome(page);
      if (view !== 'view-home') await goView(page, view);
      // 起点必须真的在目标 view（view-home 已由 openHome 保证）
      await page.waitForFunction((v) => document.getElementById(v)?.classList.contains('active'), view, { timeout: 10000 });

      const text = `在${view}问的沙发预算`;
      await sendAndSettle(page, text);

      await assertInvariant(page, text, true, `${view}`);
      expect(errs, `pageerror: ${errs.join(' | ')}`).toEqual([]);
    });
  }
});

// ============================================================================
// 2. 上传浮窗态（主路径已是底部浮窗，不再是全屏 view-upload）
// ============================================================================
test.describe('2 · 上传浮窗打开时', () => {
  test('2.1 浮窗开着 → 首页不离开、Composer 按 §1-2.4 让位（不再接收输入）', async ({ page }) => {
    await openHome(page);
    await page.locator('#view-home .ax-ucard__title', { hasText: '上传客厅照片' }).first().click();
    await page.waitForFunction(() => document.getElementById('sheetRoot')?.classList.contains('is-open'), null, { timeout: 8000 });
    await page.waitForTimeout(300);        // .ax-composer 有 .15s opacity transition，等它走完再量

    const st = await page.evaluate(() => ({
      homeActive: !!document.querySelector('#view-home.active'),
      sheetOpen: !!document.querySelector('#sheetRoot.is-open'),
      composerPointer: getComputedStyle(document.querySelector('.ax-composer')).pointerEvents,
      composerOpacity: parseFloat(getComputedStyle(document.querySelector('.ax-composer')).opacity),
      timelineAlive: !!document.querySelector('#chatHost'),
    }));
    // 浮窗只是覆盖层，首页（含对话流）仍在场
    expect(st.homeActive, '上传浮窗把首页顶掉了，对话流被藏起来').toBe(true);
    expect(st.sheetOpen).toBe(true);
    expect(st.timelineAlive, '浮窗开着的时候聊天时间线宿主不见了').toBe(true);
    // §1-2.4 键盘不顶浮窗：浮窗期间 Composer 不收输入（这是设计，见 css/chat.css）
    expect(st.composerPointer, '浮窗开着时 Composer 仍可点（与 §1-2.4 的键盘不顶浮窗相悖）').toBe('none');
    expect(st.composerOpacity).toBeLessThan(1);
  });

  test('2.2 浮窗关掉 → Composer 恢复可输入，且能正常发消息', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);

    await page.locator('#view-home .ax-ucard__title', { hasText: '上传客厅照片' }).first().click();
    await page.waitForFunction(() => document.getElementById('sheetRoot')?.classList.contains('is-open'), null, { timeout: 8000 });
    // Esc 关浮窗（交互规范 §1-2）
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('sheetRoot')?.classList.contains('is-open'), null, { timeout: 8000 });

    await sendAndSettle(page, '关掉浮窗后问一句');
    await assertInvariant(page, '关掉浮窗后问一句', true, '浮窗关闭后');
    expect(errs).toEqual([]);
  });

  test('2.3 浮窗开着时走 hash 直入 view-upload 全屏路由，仍能发消息', async ({ page }) => {
    test.slow();
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);
    await page.evaluate(() => { location.hash = '#view-upload'; });
    await goView(page, 'view-upload');
    const text = '全屏上传页里问的';
    await sendAndSettle(page, text);
    await assertInvariant(page, text, true, 'view-upload 全屏路由');
  });
});

// ============================================================================
// 3. 唯一例外 view-voice：语音是另一种聊天模态，Composer 让位
// ============================================================================
test.describe('3 · view-voice 例外', () => {
  test('3.1 view-voice 里 Composer 让位，但不变式没被破坏', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);

    // 先在首页聊一句，建立上下文
    await sendAndSettle(page, '先聊一句垫底');

    await goView(page, 'view-voice');
    const st = await page.evaluate(() => ({
      composerDisplay: getComputedStyle(document.getElementById('composer')).display,
      datasetComposer: document.getElementById('phone').dataset.composer,
      voiceActive: !!document.querySelector('#view-voice.active'),
      hostAlive: !!document.querySelector('#chatHost'),
    }));
    expect(st.composerDisplay, 'view-voice 里 Composer 必须让位（唯一例外）').toBe('none');
    expect(st.datasetComposer).toBe('off');
    expect(st.voiceActive).toBe(true);
    // 时间线宿主不能被销毁
    expect(st.hostAlive, '切到 view-voice 把聊天时间线宿主弄丢了').toBe(true);

    // 回到首页，之前那句还在、且只有一条
    await goView(page, 'view-home');
    const s = await snapshot(page);
    const mine = s.home.filter((m) => m.side === 'user' && m.text === '先聊一句垫底');
    expect(mine.length, '离开语音页再回来，之前那句话丢了或重复了').toBe(1);
    expect(s.all.length, '离开语音页再回来，全文档与首页消息数不一致').toBe(s.home.length);
    expect(errs).toEqual([]);
  });
});

// ============================================================================
// 4. display:none 容器 duplication / Tab 来回切
// ============================================================================
test.describe('4 · 不重复、不丢失', () => {
  test('4.1 连发 3 轮：消息数恒等于 chat-core 内部条数，无隐藏容器副本', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);

    for (const q of ['第一句沙发', '第二句床', '第三句茶几']) {
      await sendAndSettle(page, q);
      const s = await snapshot(page);
      expect(s.all.length, `发完「${q}」后全文档 ${s.all.length} 条 ≠ 首页 ${s.home.length} 条`).toBe(s.home.length);
      expect(s.home.length, `发完「${q}」后首页 ${s.home.length} 条 ≠ chat-core 内部 ${s.axingMsgs} 条`).toBe(s.axingMsgs);
    }
    const s = await snapshot(page);
    // 3 轮 + 阿杏问候 = 至少 7 条
    expect(s.home.length).toBeGreaterThanOrEqual(7);
    expect(errs).toEqual([]);
  });

  test('4.2 Tab 反复来回切 5 次，消息既不丢也不翻倍', async ({ page }) => {
    test.slow();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);

    await sendAndSettle(page, '这句要活过反复切 Tab');
    const before = (await snapshot(page)).home.length;

    for (const v of ['view-products', 'view-3d', 'view-plans', 'view-me', 'view-home']) {
      await goView(page, v);
    }
    await goView(page, 'view-home');
    await page.waitForTimeout(300);

    const after = await snapshot(page);
    expect(after.home.length, `切 Tab 前 ${before} 条，切完 ${after.home.length} 条`).toBe(before);
    expect(after.all.length, '切 Tab 后全文档与首页条数不一致（隐藏容器里多出副本）').toBe(after.home.length);
    expect(after.home.filter((m) => m.side === 'user' && m.text === '这句要活过反复切 Tab').length).toBe(1);
    expect(errs).toEqual([]);
  });

  test('4.3 view-home 挂载前就发消息（自举宿主）→ 挂载后不出现两条时间线', async ({ page }) => {
    test.slow();
    await page.route('**/api/chat/guide/stream', mockStream());
    await page.setViewportSize(VIEWPORT);
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
    // hash 直入商品页：这时 view-home 尚未挂载，立刻发消息
    await page.goto(`${BASE_URL}/axing#view-products`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AXING && window.AXING.chat, null, { timeout: 15000 });

    const text = '首页还没挂就发的一句';
    await page.fill('#composerInput', text);
    await page.locator('#composerSend').click();
    await waitSettled(page, text);

    // 时间线宿主只能有一个
    const hosts = await page.evaluate(() => document.querySelectorAll('#chatHost, .ax-timeline').length);
    expect(hosts, `出现 ${hosts} 个时间线宿主（自举宿主没被清掉）`).toBe(1);

    const s = await snapshot(page);
    expect(s.home.filter((m) => m.side === 'user' && m.text === text).length, '自举路径下发出去的消息丢了或重复').toBe(1);
    expect(s.all.length).toBe(s.home.length);
    // 问候语也只有一条（不能自举一份、view-home 又渲染一份）
    const greetings = s.home.filter((m) => m.text.includes('我是阿杏')).length;
    expect(greetings, `阿杏问候出现 ${greetings} 次`).toBe(1);
  });
});

// ============================================================================
// 5. 「阿杏正在想」与流式临时气泡的生命周期
// ============================================================================
test.describe('5 · 占位气泡生命周期', () => {
  test('5.1 生成中出现「阿杏正在想」+ 工具人话提示，结束后必须撤干净', async ({ page }) => {
    test.slow();
    // 长回复 + 极小分片：让流式真的跨越很多帧，rAF 轮询才抓得到中间态
    const long = [REPLY_MD, ''].concat(
      Array.from({ length: 30 }, (_, i) => `- 款式 ${i + 1}：${i % 2 ? '布艺' : '真皮'}沙发，¥${2000 + i * 100}起`),
    ).join('\n');
    await page.route('**/api/chat/guide/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: sseBody(long, { splitAt: 3 }),
      });
    });
    await openHome(page);

    // SSE 是一次性送达的，整个流在同一个任务里跑完，rAF 轮询根本抓不到中间态。
    // 改用 MutationObserver 记录每一帧的 typing/streaming 并存数量，才看得见规范 §1-6.4 有没有被违反。
    await page.evaluate(() => {
      window.__obs = { maxTyping: 0, maxStreaming: 0, maxSum: 0, sawTyping: false, sawStreaming: false, samples: 0 };
      const count = () => ({
        t: document.querySelectorAll('#view-home .ax-msg--typing').length,
        s: document.querySelectorAll('#view-home .ax-msg--streaming').length,
      });
      const mo = new MutationObserver(() => {
        const c = count();
        const o = window.__obs;
        o.samples += 1;
        o.maxTyping = Math.max(o.maxTyping, c.t);
        o.maxStreaming = Math.max(o.maxStreaming, c.s);
        o.maxSum = Math.max(o.maxSum, c.t + c.s);
        o.sawTyping = o.sawTyping || c.t > 0;
        o.sawStreaming = o.sawStreaming || c.s > 0;
      });
      mo.observe(document.getElementById('view-home'), { childList: true, subtree: true });
      window.__mo = mo;
    });

    await page.fill('#composerInput', '推荐三十款沙发');
    await page.locator('#composerSend').click();
    await waitSettled(page, '推荐三十款沙发');

    const mid = await page.evaluate(() => window.__obs);
    expect(mid.samples, '一次 DOM 变更都没观察到，观测器没装上').toBeGreaterThan(0);
    expect(mid.maxTyping, `「阿杏正在想」同时挂了 ${mid.maxTyping} 个`).toBeLessThanOrEqual(1);
    expect(mid.maxStreaming, `流式气泡同时挂了 ${mid.maxStreaming} 个`).toBeLessThanOrEqual(1);
    // 规范 §1-6.4：抖点气泡与流式正文气泡是同一个对话流的两种态，不能同时在时间线上
    expect(mid.maxSum, `抖点气泡与流式正文气泡同时在场（最多 ${mid.maxSum} 个）`).toBe(1);
    expect(mid.sawTyping || mid.sawStreaming, '生成中一个过渡气泡都没挂，顾客不知道阿杏在干活').toBe(true);
    const s = await snapshot(page);
    expect(s.home.some((m) => m.typing), '结束后「阿杏正在想」没撤掉').toBe(false);
    expect(s.home.some((m) => m.streaming), '结束后流式临时气泡没转正').toBe(false);
    // 转正后的正文只能有一条（不能既留流式那行、又 append 一条转正消息）
    const bodies = s.home.filter((m) => m.side === 'ai' && m.text.includes(REPLY_MARK)).length;
    expect(bodies, `阿杏回复出现 ${bodies} 次（流式气泡与转正消息重复）`).toBe(1);
  });

  test('5.2 停止生成：保留半截回答、时间线不留空洞', async ({ page }) => {
    test.slow();
    // 长回复 + 小分片：让流式持续足够久，才抓得到「停止生成」那个窗口
    const long = [REPLY_MD, '', '另外还有几款也可以看看：', '']
      .concat(Array.from({ length: 12 }, (_, i) => `- 款式 ${i + 1}：布艺沙发，¥${2000 + i * 100}起`))
      .join('\n');
    // ⚠️ route.fulfill 会把整个 body 一次性送完，流可能在 Playwright 观察到「停止生成」
    // 之前就结束了——按钮从来没出现过，这条测试就变成纯竞态（实测约 1/3 概率红）。
    // 改成：mock 先挂住不放行，等测试点到停止按钮再放。窗口因此 100% 稳定。
    await page.addInitScript(() => {
      window.__releaseStream = new Promise((resolve) => { window.__doRelease = resolve; });
    });
    await page.route('**/api/chat/guide/stream', async (route) => {
      await page.evaluate(() => window.__releaseStream);
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: sseBody(long, { splitAt: 4 }),
      });
    });
    await openHome(page);
    await page.fill('#composerInput', '说一半停掉');
    await page.locator('#composerSend').click();

    // 按钮可见的同一帧里点它（页面内 click）
    await page.waitForFunction(() => {
      const b = document.getElementById('composerStop');
      return Boolean(b && !b.hidden && getComputedStyle(b).display !== 'none');
    }, null, { timeout: 20000 });
    await page.evaluate(() => document.getElementById('composerStop').click());
    await page.evaluate(() => window.__doRelease());
    await page.waitForFunction(() => {
      const c = window.AXING && window.AXING.chat;
      return Boolean(c) && !c.isBusy() && document.querySelectorAll('.ax-msg--typing, .ax-msg--streaming').length === 0;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(200);

    const s = await snapshot(page);
    const ai = s.home.filter((m) => m.side === 'ai' && !m.typing);
    expect(ai.length, '停止生成后时间线出现空洞').toBeGreaterThanOrEqual(1);
    expect(s.home.some((m) => m.streaming), '停止后残留流式气泡').toBe(false);
    // 输入框应恢复可用
    expect(s.inputs[0].readOnly, '停止生成后输入框仍是 readOnly').toBe(false);
  });
});

// ============================================================================
// 6. 输入框状态（老人连着问）
// ============================================================================
test.describe('6 · Composer 输入态', () => {
  test('6.1 发送后输入框清空、可继续打字', async ({ page }) => {
    await page.route('**/api/chat/guide/stream', mockStream());
    await openHome(page);
    await sendAndSettle(page, '第一问');
    const s = await snapshot(page);
    expect(s.inputs[0].value, '发送后输入框没清空').toBe('');
    expect(s.inputs[0].readOnly, '生成结束后输入框仍是只读').toBe(false);

    await sendAndSettle(page, '第二问');
    const s2 = await snapshot(page);
    expect(s2.home.filter((m) => m.side === 'user' && m.text === '第二问').length).toBe(1);
    expect(s2.home.filter((m) => m.side === 'user' && m.text === '第一问').length, '第二问把第一问冲掉了').toBe(1);
  });

  test('6.2 空输入点不了发送；生成中禁连发', async ({ page }) => {
    await page.route('**/api/chat/guide/stream', async (route) => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        body: sseBody(REPLY_MD, { splitAt: 6 }),
      });
    });
    await openHome(page);

    // 空输入：发送键不可见
    await page.waitForFunction(() => getComputedStyle(document.getElementById('composerSend')).display === 'none', null, { timeout: 5000 });

    await page.fill('#composerInput', '连发测试');
    // 连点 3 次发送（中间不等）
    await page.locator('#composerSend').click();
    await page.locator('#composerSend').click({ force: true }).catch(() => {});
    await page.locator('#composerSend').click({ force: true }).catch(() => {});

    await waitSettled(page, '连发测试');
    const s = await snapshot(page);
    const mine = s.home.filter((m) => m.side === 'user' && m.text === '连发测试');
    expect(mine.length, `连点发送产生了 ${mine.length} 条用户消息（禁连发失效）`).toBe(1);
    const ai = s.home.filter((m) => m.side === 'ai' && m.text.includes(REPLY_MARK));
    expect(ai.length, `阿杏回复 ${ai.length} 条（重复请求）`).toBe(1);
  });
});

// ============================================================================
// 7. 降级路径
// ============================================================================
test.describe('7 · 降级路径', () => {
  test('7.1 断网 → 兜底话术上屏，时间线不留空洞', async ({ page }) => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/chat/guide/stream', (route) => route.abort('failed'));
    await openHome(page);

    const text = '断网也问一句';
    await sendAndSettle(page, text);

    const s = await snapshot(page);
    const ai = s.home.filter((m) => m.side === 'ai' && !m.typing);
    expect(ai.length, '断网后时间线出现「问了没答」的空洞').toBeGreaterThanOrEqual(1);
    expect(s.all.length, '断网后全文档与首页条数不一致').toBe(s.home.length);
    // 输入框恢复可用，顾客能再试
    expect(s.inputs[0].readOnly, '断网后输入框卡在只读').toBe(false);
    expect(errs, `pageerror: ${errs.join(' | ')}`).toEqual([]);
  });

  test('7.2 后端 503 → 快速恢复 + 兜底话术，不把顾客晾住', async ({ page }) => {
    test.slow();
    await page.route('**/api/chat/guide/stream', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: '导购暂时不可用：请配置 STEP_API_KEY' }),
    }));
    // 记录真实发出的请求：防止这条测试悄悄打到真服务上而「假通过」
    const hits = [];
    page.on('response', (r) => { if (r.url().includes('/api/chat/guide/stream')) hits.push(r.status()); });
    await openHome(page);
    const t0 = Date.now();
    await sendFromComposer(page, '服务挂了吗');
    // 等 busy 落下。给 40s 上限：实测这条路径会一路卡到 20s 竞速超时才解开，
    // 所以要放得比 20s 宽，才能把「卡了多久」量出来而不是只报一个超时。
    await page.waitForFunction(() => {
      const c = window.AXING && window.AXING.chat;
      return Boolean(c) && !c.isBusy();
    }, null, { timeout: 40000 });
    const recoverMs = Date.now() - t0;
    await page.waitForTimeout(300);

    expect(recoverMs, `503 后 busy 花了 ${recoverMs}ms 才落下（正常应是毫秒级；20s 说明重试路径的 Promise 没人 settle）`).toBeLessThan(8000);

    expect(hits.length, `503 mock 一次都没生效（实际响应：${hits.join(',')}），测试可能打到真服务上`).toBeGreaterThanOrEqual(1);
    expect(hits.every((c) => c === 503), `mock 应全部回 503，实际：${hits.join(',')}`).toBe(true);

    const s = await snapshot(page);
    const ai = s.home.filter((m) => m.side === 'ai' && !m.typing);
    expect(ai.length, '503 后时间线出现「问了没答」的空洞（无兜底话术）').toBeGreaterThanOrEqual(1);
    expect(s.home.some((m) => m.typing), '503 后残留「阿杏正在想」').toBe(false);
    expect(s.inputs[0].readOnly, '503 后输入框卡在只读，顾客再也问不了下一句').toBe(false);
  });

  test('7.3 挂住的流（20s 竞速超时）→ 保留已有内容、界面恢复可用', async ({ page }) => {
    test.setTimeout(60000);
    await page.route('**/api/chat/guide/stream', mockHangStream());
    await openHome(page);
    await sendFromComposer(page, '会超时的一句');
    // chat-core 的 UI 层竞速超时是 20s；给足 buffer。超时本身按「打断」处理，
    // 会保留半截回答 + 兜底话术，所以最终一定会有 ≥2 条 AI 消息。
    await page.waitForFunction(() => {
      const c = window.AXING && window.AXING.chat;
      if (!c || c.isBusy()) return false;
      return c.messages.filter((m) => m.role === 'ai').length >= 2
        && document.querySelectorAll('.ax-msg--typing, .ax-msg--streaming').length === 0;
    }, null, { timeout: 45000 });
    await page.waitForTimeout(200);
    const s = await snapshot(page);
    expect(s.home.some((m) => m.typing), '超时后残留「阿杏正在想」').toBe(false);
    expect(s.inputs[0].readOnly, '超时后输入框卡在只读').toBe(false);
    const ai = s.home.filter((m) => m.side === 'ai' && !m.typing);
    expect(ai.length, '超时后时间线空洞').toBeGreaterThanOrEqual(1);
  });
});
