// ============================================================================
// 阿杏 AI 家居助手 · v2.1 首页视觉还原 —— Playwright 验收测试
// ============================================================================
// 覆盖什么：
//   A 首页视觉结构        —— Spec §70 首页最终布局 + §5.1 + 视觉基准
//                            docs/阿杏AI家居导购界面.png
//   B 核心不变式          —— Spec §70.1（聊天窗口始终在场 / 功能按钮在 Chat 后 Input 前 /
//                            上传客厅照是第一 CTA / 头像与 AI 消息绑定）
//   C App shell 布局      —— §70（顶栏 + 唯一滚动区 + Composer + Tab 固定不跑）
//   D Composer 交互       —— §70 / §11.3（发消息、发送态、AI 回复或诚实兜底）
//   E 降级路径            —— §55 失败降级 + §74「无论 WebGL 是否成功都能继续购买决策」
//   F 老人友好            —— 项目铁律（爸妈能直接用的界面）：≥44px 可点高度 + 无障碍标签
// 断言目标选择器全部来自已定稿契约：
//   src/axing/css/axing.css（.ax-hero* / .ax-msg* / .ax-ucard* / .ax-samples* /
//                            .ax-sample / .ax-ask* / .ax-quick* / .ax-composer*）、
//   src/axing/index.html（#composer / #composerInput / #composerSend / #composerImage /
//                         #composerVoice / #composerPlus / #phone[data-composer]）、
//   src/axing/js/app.js（window.AXING.go / state / appendChat / emit / on）。
//
// 端口：3412（独立 spawn，不复用 playwright.config.js 的 3000，也不碰 3100 的 axing.test.js）
// 单独跑：
//   ./node_modules/.bin/playwright test tests/axing-ui.test.js --reporter=line
// 回归（旧阿杏接口/挂载冒烟，3100 端口）：
//   ./node_modules/.bin/playwright test tests/axing.test.js --reporter=line
//
// 说明：src/axing/js/view-home.js 的 v2.1 视觉版由另一位同学实现中。本文件只做验收，
//       不修改任何 src/ 文件；若失败源于实现未落地，报告里单独列「等实现落地后应通过」。
// ============================================================================
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3412;                       // ⚠️ 被占用时改 3413 并在报告里说明
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };   // iPhone 12/13 mini 逻辑分辨率
const APPOINTMENTS_FILE = path.join(process.cwd(), 'data', 'appointments.json');
const SCENES_FILE = path.join(process.cwd(), 'data', 'scenes.json');

// §77 P0「首页 Chat 永远存在」的唯一例外：view-voice。
// 语音本身就是另一种聊天输入模态（全屏收音），此时让位给独立语音页，避免误触。
const VOICE_VIEW = 'view-voice';
const COMPOSER_ALWAYS_VIEWS = [
  'view-home', 'view-upload', 'view-products', 'view-tryon', 'view-3d',
  'view-material', 'view-booking', 'view-plans', 'view-me',
];
// §70 布局顺序：功能按钮必须落在 Chat（时间线）之后、Input（Composer）之前
const ORDER_SELECTORS = ['.ax-timeline', '.ax-quick', '#composer'];

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

async function waitServerReady(timeoutMs = 30000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error(`阿杏 v2.1 测试服务器启动超时（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  // ⚠️ 不能传 NODE_ENV=test：server.js 的 listen() 被 `if (process.env.NODE_ENV !== 'test')` 包着，
  //    传了它服务器根本不监听、进程直接 exit(0)，beforeAll 只会等到「启动超时」。
  // 与 playwright.config.js 同一套判定：没有真 key 时启用假模型，
  // 让「AI 回复」用例在无 ARK_API_KEY 的机器上也能确定性地走到成功分支。
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
  for (const f of [APPOINTMENTS_FILE, SCENES_FILE]) {
    try { fs.writeFileSync(f, JSON.stringify(f.includes('scenes') ? { scenes: [] } : { appointments: [] }, null, 2), 'utf-8'); } catch { /* 忽略 */ }
  }
});

/** 统一入口：清干净 localStorage 再进首页（每组测试互不污染） */
async function openHome(page) {
  await page.setViewportSize(VIEWPORT);
  // addInitScript 在首屏脚本之前跑，保证 app.js 读 localStorage 时就是空状态
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/axing', { waitUntil: 'domcontentloaded' });
  // 壳就绪：app.js 已把 ctx 挂到 window.AXING，并把 view-home 设为 active
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 10000 });
}

/** 等首页 view 渲染完毕（有子节点），实现未落地时给出可定位的提示 */
async function waitHomeMounted(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('view-home');
    return el && el.classList.contains('active') && el.children.length > 0;
  }, null, { timeout: 10000 });
}

/** 切到某个 view 并等它挂载完成（go() 返回 mount 的 Promise，evaluate 会 await 它） */
async function go(page, viewId) {
  await page.evaluate((v) => window.AXING.go(v), viewId);
  await page.waitForFunction((v) => {
    const el = document.getElementById(v);
    return el && el.classList.contains('active');
  }, viewId, { timeout: 15000 });
}

/** 取若干元素在 v2.1 手机视口里的上下边界，用于断言 §70 布局顺序 */
async function rectsOf(page, selectors) {
  return page.evaluate((sels) => {
    const out = {};
    sels.forEach((s) => {
      const el = document.querySelector(s);
      out[s] = el ? el.getBoundingClientRect().toJSON() : null;
    });
    return out;
  }, selectors);
}

// ============================================================================
// A. 首页视觉结构（Spec §70 / §5.1 / 视觉基准 docs/阿杏AI家居导购界面.png）
// ============================================================================
test.describe('A · 首页视觉结构（§70 / 视觉基准）', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); await waitHomeMounted(page); });

  test('A1 阿杏 hero 用真图加载（不是文字圆回退），src 指向 axing-hero', async ({ page }) => {
    const girl = page.locator('.ax-hero__girl img');
    await expect(girl, '首页应有 .ax-hero__girl img（阿杏半身像，见 ui.js axingHero()）').toHaveCount(1);
    const info = await girl.evaluate((img) => ({ src: img.getAttribute('src') || '', w: img.naturalWidth, h: img.naturalHeight }));
    expect(info.src, 'hero 图应指向 /axing/images/axing-hero.png').toContain('axing-hero');
    expect(info.w, `阿杏 IP 图应真实加载出来（naturalWidth=${info.w}），不能回退成「杏」字圆`).toBeGreaterThan(0);
    expect(info.h).toBeGreaterThan(0);
  });

  test('A2 聊天时间线有用户+AI 消息，且 AI 消息头像绑定了真图', async ({ page }) => {
    await expect(page.locator('.ax-msg--user'), '时间线应有至少 1 条用户消息（打招呼/示例提问）').not.toHaveCount(0);
    await expect(page.locator('.ax-msg--ai'), '时间线应有至少 1 条阿杏回复').not.toHaveCount(0);

    // §70.1「阿杏头像必须与 AI 消息绑定」
    const avas = page.locator('.ax-msg--ai .ax-msg__ava img');
    const n = await avas.count();
    expect(n, '每条 AI 消息都应带头像 img（.ax-msg__ava img）').toBeGreaterThan(0);
    const broken = await avas.evaluateAll((els) => els
      .map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth }))
      .filter((x) => x.w === 0));
    expect(broken, `AI 消息头像破图了：${JSON.stringify(broken)}，应回退成文字圆而不是留破图`).toEqual([]);
  });

  test('A3 「上传客厅照片」是首页第一业务 CTA，文案与 Spec §70 一致', async ({ page }) => {
    const card = page.locator('.ax-ucard');
    await expect(card, '首页应有 .ax-ucard（上传客厅照卡，class 见 axing.css）').toHaveCount(1);
    const text = (await card.innerText()).replace(/\s+/g, '');
    expect(text, '第一 CTA 标题应为「上传客厅照片」').toContain('上传客厅照片');
    expect(text, '第一 CTA 描述应为「让阿杏提前把喜欢的家具为您搬回家～」')
      .toContain('让阿杏提前把喜欢的家具为您搬回家');
  });

  test('A4 「你可以这样问」chips ≥3，点「换一换」文案会变', async ({ page }) => {
    const chips = page.locator('.ax-ask__chips .chip');
    const count = await chips.count();
    expect(count, '「你可以这样问」至少 3 个建议问题 chip（视觉基准里有 4 个）').toBeGreaterThanOrEqual(3);

    const before = await chips.allInnerTexts();
    const refresh = page.locator('.ax-ask__more').first();
    await expect(refresh, '应有「换一换」按钮（.ax-ask__more）').toBeVisible();
    let changed = false;
    for (let i = 0; i < 5 && !changed; i++) {           // 最多试 5 次，容忍随机重回
      await refresh.click();
      const after = await chips.allInnerTexts();
      changed = after.join('|') !== before.join('|');
    }
    expect(changed, `点「换一换」后建议问题应变化（点之前是：${before.join(' / ')}）`).toBe(true);
  });

  test('A5 四大功能 tile 恰好 4 个，标签为 拍照试摆/语音导购/浏览家具/我的方案', async ({ page }) => {
    const tiles = page.locator('.ax-quick__tile');
    await expect(tiles, '四大功能入口应为 .ax-quick__tile ×4').toHaveCount(4);
    const labels = (await tiles.allInnerTexts()).map((t) => t.replace(/\s+/g, ''));
    expect(labels[0], '第 1 个功能应是「拍照试摆」').toContain('拍照试摆');
    expect(labels[1], '第 2 个功能应是「语音导购」').toContain('语音导购');
    expect(labels[2], '第 3 个功能应是「浏览家具」').toContain('浏览家具');
    expect(labels[3], '第 4 个功能应是「我的方案」').toContain('我的方案');
  });

  test('A6 首页无 emoji 占位（铁律：真实图标，不用 emoji）', async ({ page }) => {
    const text = await page.evaluate(() => document.getElementById('view-home').textContent || '');
    const hit = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
    expect(hit, `首页仍含 emoji 占位「${hit ? hit[0] : ''}」，应改用 #i-* symbol 图标（icon()）`).toBeNull();
  });
});

// ============================================================================
// B. 核心不变式（Spec §70.1）
// ============================================================================
test.describe('B · 核心不变式（§70.1）', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); await waitHomeMounted(page); });

  test('B1 聊天窗口始终在页面上：除了 view-voice（全屏收音，唯一例外）都能看到 Composer', async ({ page }) => {
    test.slow();
    const missing = [];
    for (const v of COMPOSER_ALWAYS_VIEWS) {
      await go(page, v);
      const display = await page.evaluate(() => {
        const c = document.getElementById('composer');
        return c ? getComputedStyle(c).display : 'MISSING';
      });
      if (display !== 'flex') missing.push(`${v} → display:${display}`);
    }
    expect(missing, `以下 view 看不到 Composer：${missing.join('；')}。§77 P0 要求「首页 Chat 永远存在」`).toEqual([]);
  });

  test('B1b 唯一例外 view-voice：语音是另一种聊天模态，Composer 让位', async ({ page }) => {
    await go(page, VOICE_VIEW);
    const state = await page.evaluate(() => {
      const c = document.getElementById('composer');
      return { display: c ? getComputedStyle(c).display : 'MISSING', attr: document.getElementById('phone').dataset.composer };
    });
    expect(state.attr, 'app.js 应把 #phone[data-composer] 置成 off（见 COMPOSER_HIDDEN_VIEWS）').toBe('off');
    expect(state.display, '语音页是全屏收音，Composer 应收起（不是 flex）').not.toBe('flex');
  });

  test('B2 功能按钮位于 Chat 之后、Input 之前（timeline → quick → composer）', async ({ page }) => {
    const r = await rectsOf(page, ORDER_SELECTORS);
    for (const s of ORDER_SELECTORS) {
      expect(r[s], `布局顺序断言需要 ${s} 存在（axing.css 已定义该类）`).not.toBeNull();
    }
    // (1) 文档顺序：时间线 → 四大功能 → Composer。这是与「首页是否可以滚动」无关的铁律。
    const domOrder = await page.evaluate(() => {
      const t = document.querySelector('.ax-timeline');
      const q = document.querySelector('.ax-quick');
      const c = document.getElementById('composer');
      const before = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { timelineFirst: before(t, q), quickBeforeComposer: before(q, c) };
    });
    expect(domOrder.timelineFirst, '聊天时间线应排在四大功能按钮之前（§70.1「功能按钮位于 Chat 之后」）').toBe(true);
    expect(domOrder.quickBeforeComposer, '四大功能按钮应排在输入框之前（§70.1「…、Input 之前」）').toBe(true);

    // (2) 视口几何：时间线整体在四大功能上方（首页不滚动时即可验证）。
    expect(r['.ax-timeline'].bottom, '聊天时间线应整体落在四大功能按钮上方')
      .toBeLessThanOrEqual(r['.ax-quick'].top + 1);
    // (3) 滚到首页最底后，四大功能必须整体落在输入框上方、不被 Composer 盖住。
    // 注：§2.3「用户向下滚动后不再反复显示大头像」明确允许首页滚动，所以不能用「首屏不滚动」
    //     来卡这条；这里滚到底再看按钮与固定输入框的关系。
    await page.evaluate(() => { const v = document.getElementById('views'); v.scrollTop = v.scrollHeight; });
    await page.waitForTimeout(150);
    const bottom = await rectsOf(page, ORDER_SELECTORS);
    expect(bottom['.ax-quick'].bottom, `滚到底后四大功能按钮仍被输入框压住/落在其下（quick.bottom=${bottom['.ax-quick'].bottom.toFixed(0)} / composer.top=${bottom['#composer'].top.toFixed(0)}）`)
      .toBeLessThanOrEqual(bottom['#composer'].top + 1);
  });

  test('B3 「上传客厅照片」卡排在四大功能按钮之前（第一业务 CTA）', async ({ page }) => {
    const r = await rectsOf(page, ['.ax-ucard', '.ax-quick']);
    expect(r['.ax-ucard'], '需要 .ax-ucard 存在').not.toBeNull();
    expect(r['.ax-quick'], '需要 .ax-quick 存在').not.toBeNull();
    expect(r['.ax-ucard'].bottom, '上传客厅照卡应在四大功能按钮上方（§70.1 第一业务 CTA）')
      .toBeLessThanOrEqual(r['.ax-quick'].top + 1);
  });
});

// ============================================================================
// C. App shell 布局（§70：顶栏 / 唯一滚动区 / Composer / Tab 固定不跑）
// ============================================================================
test.describe('C · App shell 布局（390×844）', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); await waitHomeMounted(page); });

  test('C1 #views 是唯一滚动区，Tab 贴屏幕底，Composer 完整可见', async ({ page }) => {
    const m = await page.evaluate(() => {
      const views = document.getElementById('views');
      const tab = document.getElementById('tabbar');
      const composer = document.getElementById('composer');
      return {
        scrollH: views.scrollHeight, clientH: views.clientHeight,
        tabBottom: tab.getBoundingClientRect().bottom,
        composerTop: composer.getBoundingClientRect().top,
        composerBottom: composer.getBoundingClientRect().bottom,
      };
    });
    expect(m.scrollH, `首页内容应比一屏高（scrollHeight=${m.scrollH} / clientHeight=${m.clientH}）`)
      .toBeGreaterThanOrEqual(m.clientH);
    expect(Math.abs(m.tabBottom - VIEWPORT.height), `Tab 栏底边应贴在视口底部 ${VIEWPORT.height}（实测 ${m.tabBottom}）`)
      .toBeLessThanOrEqual(2);
    expect(m.composerTop, `Composer 顶部不能超出屏幕（实测 top=${m.composerTop}）`).toBeGreaterThanOrEqual(0);
    expect(m.composerBottom, `Composer 底部不能超出屏幕（实测 bottom=${m.composerBottom} / 视口 ${VIEWPORT.height}）`)
      .toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('C2 滚动内容后顶栏仍固定在顶部', async ({ page }) => {
    const before = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
    await page.evaluate(() => { document.getElementById('views').scrollTop = 99999; });
    await page.waitForTimeout(150);
    const after = await page.evaluate(() => ({
      top: document.querySelector('.topbar').getBoundingClientRect().top,
      scrollTop: document.getElementById('views').scrollTop,
      position: getComputedStyle(document.querySelector('.topbar')).position,
    }));
    expect(after.scrollTop, '#views 应真的滚下去了（首页内容不够长？）').toBeGreaterThan(0);
    expect(after.position, '顶栏应为 sticky/fixed').toMatch(/sticky|fixed/);
    expect(Math.abs(after.top - before), `滚动后顶栏应仍固定在 top≈${before}（实测 ${after.top}）`).toBeLessThanOrEqual(2);
  });

  test('C3 切 view 时 #views.scrollTop 归零', async ({ page }) => {
    await page.evaluate(() => { document.getElementById('views').scrollTop = 99999; });
    const scrolled = await page.evaluate(() => document.getElementById('views').scrollTop);
    expect(scrolled, '首页内容应足够长以产生滚动（v2.1 首页信息量：hero + 时间线 + CTA + chips + 四大功能）').toBeGreaterThan(0);
    await go(page, 'view-products');
    const top = await page.evaluate(() => document.getElementById('views').scrollTop);
    expect(top, '切 view 后滚动位置应归零（app.js setActive 里 views.scrollTop = 0）').toBe(0);
  });
});

// ============================================================================
// D. Composer 交互（§70 / §11.3）
// ============================================================================
test.describe('D · Composer 交互', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); await waitHomeMounted(page); });

  test('D1 有字显示发送、收起图片钮；清空反过来', async ({ page }) => {
    const send = page.locator('#composerSend');
    const img = page.locator('#composerImage');
    await expect(send, '初始（空输入）应看不到发送钮').toBeHidden();
    await expect(img, '初始（空输入）应看得到图片钮').toBeVisible();

    await page.fill('#composerInput', '三千左右的布艺沙发');
    await expect(send, '输入文字后应出现发送钮（chat-composer.js syncSendVisibility）').toBeVisible();
    await expect(img, '输入文字后应收起图片钮，避免误触发图').toBeHidden();

    await page.fill('#composerInput', '');
    await expect(send, '清空后发送钮应重新收起').toBeHidden();
    await expect(img, '清空后图片钮应重新出现').toBeVisible();
  });

  test('D2 点发送：用户消息立刻上屏、输入框清空、无页面报错', async ({ page }) => {
    test.slow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    const ask = '帮我找个三千左右的布艺沙发';
    await page.fill('#composerInput', ask);
    await page.click('#composerSend');

    const userMsg = page.locator('.ax-msg--user', { hasText: ask });
    await expect(userMsg, `发送后时间线应立即出现用户消息「${ask}」（view-home 监听 ctx.on('chat:message')）`).toHaveCount(1);
    const inputValue = await page.inputValue('#composerInput');
    expect(inputValue, '发送后输入框应被清空').toBe('');
    await page.waitForTimeout(500);
    expect(errors, `页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('D3 发送后阿杏必须有回音：回复/兜底消息至少一种，缺 key 不算失败', async ({ page }) => {
    test.slow();
    const before = await page.locator('#view-home .ax-msg--ai').count();
    await page.fill('#composerInput', '客厅三米五，摆得下转角沙发吗？');
    await page.click('#composerSend');

    // (a) AI 回复条数增加，或 (b) 弹 toast 并追加兜底话术——两种都算「没有问了没答的空洞」
    // 有真 ARK_API_KEY 时走真实豆包，45s 是宽容上限；没有 key 时后端是假模型，秒回。
    const outcome = await page.waitForFunction((n) => {
      const ai = document.querySelectorAll('#view-home .ax-msg--ai').length;
      const toast = document.getElementById('toast');
      const toastShown = Boolean(toast && toast.classList.contains('show') && (toast.textContent || '').trim());
      return (ai > n || toastShown) ? { ai, toastShown } : null;
    }, before, { timeout: 45000 }).then((h) => h.jsonValue()).catch(() => null);

    expect(outcome, '30s 内既没有阿杏回复、也没有 toast+兜底消息：用户会看到「问了没人答」的空洞')
      .not.toBeNull();
    const aiNow = await page.locator('#view-home .ax-msg--ai').count();
    const hasFallback = /走神|没听清|再说一遍/.test(await page.evaluate(() => document.getElementById('view-home').textContent || ''));
    expect(aiNow > before || hasFallback, '要么多一条 AI 消息，要么有阿杏的兜底话术，时间线不能出现空洞').toBe(true);
  });
});

// ============================================================================
// E. 降级路径（§55 失败降级 / §74 WebGL 不可用仍可继续购物）
// ============================================================================
test.describe('E · 降级路径（§55 / §74）', () => {
  test('E1 示例客厅图 404 时不留破图，首页其他功能全部仍可点', async ({ page }) => {
    test.slow();
    await page.route('**/default-room*.jpg', (r) => r.abort());
    await openHome(page);
    await waitHomeMounted(page);
    await page.waitForTimeout(800);

    await expect(page.locator('.ax-ucard'), '示例图挂了也要保留上传客厅照卡').toHaveCount(1);
    const cardText = (await page.locator('.ax-ucard').innerText()).replace(/\s+/g, '');
    expect(cardText, '上传卡仍应有可读文字（不能只剩一张破图）').toContain('上传客厅照片');

    // 等图片错误事件都发完，再查有没有「裸奔」的破图
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('#view-home img'));
      return imgs.length > 0 && imgs.every((i) => i.complete);
    }, null, { timeout: 6000 }).catch(() => { /* 查不到就让下面的断言去报 */ });

    const broken = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#view-home img').forEach((img) => {
        if (!img.complete || img.naturalWidth !== 0) return;
        // 破图的宿主（示例缩略图优先取 .ax-sample，其它取父元素）必须带可读文字或 alt
        const host = img.closest('.ax-sample') || img.parentElement;
        out.push({
          src: img.getAttribute('src') || '',
          alt: (img.getAttribute('alt') || '').trim(),
          hostText: (host && host.textContent || '').trim(),
        });
      });
      return out;
    });
    const naked = broken.filter((b) => !b.alt && !b.hostText);
    expect(naked, `以下是既没有文字也没有 alt 的裸破图：${JSON.stringify(naked)}。应像 ui.js 那样回退成文字说明`)
      .toEqual([]);

    // §74「无论 WebGL 是否成功，用户都必须可以继续完成购买决策」：四大功能必须仍可点
    const tiles = page.locator('.ax-quick__tile');
    await expect(tiles, '示例图挂掉后四大功能 tile 仍应在场').toHaveCount(4);
    const disabled = await tiles.evaluateAll((els) => els.filter((e) => e.disabled).length);
    expect(disabled, '示例图挂掉后四大功能 tile 不应被禁用').toBe(0);
    for (let i = 0; i < 4; i++) {
      await expect(tiles.nth(i), `第 ${i + 1} 个功能 tile 在示例图挂掉后仍应可见可点`).toBeVisible();
    }
  });

  test('E2 3D 页：WebGL 可用出 canvas，不可用给图片兜底文案', async ({ page }) => {
    test.slow();
    await openHome(page);
    await go(page, 'view-3d');
    await page.waitForTimeout(1500);
    const stage = await page.evaluate(() => {
      const s = document.querySelector('#view-3d .stage');
      const canvas = s && s.querySelector('canvas');
      return { hasCanvas: Boolean(canvas), w: canvas ? canvas.width : 0, text: s ? s.textContent : '' };
    });
    expect(stage.hasCanvas || /看不了|到店/.test(stage.text),
      `3D 页既没有 canvas 也没有降级文案（现有文案：${JSON.stringify(stage.text.slice(0, 40))}）`).toBe(true);
    if (stage.hasCanvas) expect(stage.w, 'canvas 宽度应 > 0').toBeGreaterThan(0);
  });
});

// ============================================================================
// F. 老人友好（项目铁律：爸妈能直接用的界面）
// ============================================================================
test.describe('F · 老人友好（≥44px 可点高度 + 无障碍标签）', () => {
  test.beforeEach(async ({ page }) => { await openHome(page); await waitHomeMounted(page); });

  test('F1 可点元素高度 ≥ 44px（Apple HIG 最小可点区域）', async ({ page }) => {
    const groups = await page.evaluate(() => {
      const sels = ['.ax-quick__tile', '.ax-ucard', '#view-home .chip', '.tab'];
      const out = [];
      sels.forEach((s) => {
        document.querySelectorAll(s).forEach((el, i) => {
          const r = el.getBoundingClientRect();
          out.push({ sel: s, i, h: Math.round(r.height * 10) / 10, text: (el.textContent || '').trim().slice(0, 10) });
        });
      });
      return out;
    });
    expect(groups.length, '一个都没量到：.ax-quick__tile / .ax-ucard / #view-home .chip / .tab 应至少各有一个').toBeGreaterThan(0);
    const tooSmall = groups.filter((g) => g.h < 44);
    expect(tooSmall, `以下可点元素高度不足 44px（老人手指粗）：${JSON.stringify(tooSmall)}`).toEqual([]);
  });

  test('F2 输入框与 Composer 按钮都有无障碍标签', async ({ page }) => {
    const input = page.locator('#composerInput');
    const labelled = await input.evaluate((el) =>
      Boolean((el.getAttribute('aria-label') || '').trim() || (el.labels && el.labels.length)));
    expect(labelled, '#composerInput 应有 aria-label 或关联 label（读屏软件要用）').toBe(true);

    for (const id of ['composerVoice', 'composerImage', 'composerPlus', 'composerSend']) {
      const label = await page.evaluate((i) => (document.getElementById(i).getAttribute('aria-label') || '').trim(), id);
      expect(label, `#${id} 应有 aria-label（index.html 契约里已定义）`).not.toBe('');
    }
  });
});
