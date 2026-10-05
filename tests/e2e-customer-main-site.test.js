// 「真实顾客」端到端验收 F 组：**主站**顾客动线（http://127.0.0.1:3515/，不是 /axing）
// 自带服务器（独立端口 3517，不碰 3000 常驻旧实例、不碰其它组的端口）。
//
// 为什么单独立一组：生产上真实顾客唯一在用的入口是主站 `/`，阿杏 `/axing` 还没部署。
// 前面 5 个组全在测 /axing，主站一次没被系统测过——而它才是线上那一个。
//
// 覆盖动线：首页（hero/家具真图/联系信息）→ 默认客厅图分支 & 真实上传分支 →
// 试摆（读秒计时器自己走 + 出图或诚实降级）→ 商品详情 → 下单 → 订单成功页（拨号）→ 登录查订单
//
// 写真合成：本地 .env 的 TWO_FISH_API_KEY 已失效，会退化成侧边预览或诚实报错。
// 约定「出图」和「诚实的 aiError/demoType 说明」都算通过，只有「静默假装成功」或白屏算失败。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

// 端口 3515 已被 E 组 markdown-render.spec.js 占用（撞了会把它的服务器顶掉、打出假红），改用 3517
const PORT = 3517;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ORDERS_FILE = path.join(process.cwd(), 'data', 'orders.json');
const STORE_PHONE = '13359140982';
const VIEWPORT = { width: 390, height: 844 };

let serverProc = null;
let ordersBackup = null;

async function waitServerReady(timeoutMs = 25000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`);
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('F 组测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** 备份 orders.json，测完还原（别把顾客真订单冲掉） */
function backupOrders() {
  try { ordersBackup = fs.readFileSync(ORDERS_FILE, 'utf-8'); }
  catch { ordersBackup = null; }
}
function restoreOrders() {
  if (ordersBackup === null) return;
  try { fs.writeFileSync(ORDERS_FILE, ordersBackup, 'utf-8'); } catch { /* 忽略 */ }
}

/** 进首页：清 localStorage + 收集 pageerror */
async function openHome(page, { errors } = {}) {
  if (errors) page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* 隐私模式 */ } });
  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' });
  // 首页数据是启动后拉 /api/products + /api/categories 渲染的，等到家具格有卡再断言
  await page.waitForFunction(() => document.querySelectorAll('#furnGrid .furn-card').length > 0, null, { timeout: 15000 });
}

test.beforeAll(async () => {
  backupOrders();
  serverProc = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
  restoreOrders();
});

// ============================================================================
// A. 首页：老人第一眼看到的东西必须齐备且不糊弄
// ============================================================================
test.describe('A · 首页', () => {
  test('A1 hero 文案 + 6 款家具是真图不是 emoji + 联系信息可见', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });

    const h1 = (await page.locator('.hero h1').innerText()).replace(/\s+/g, '');
    expect(h1, 'hero 应是「沙发搬进你家再决定」').toContain('沙发');
    expect(h1).toContain('搬进你家');
    expect(h1).toContain('再决定');

    // 试摆区家具格：真实图片（加载失败会 onerror 隐藏），至少有 6 款在售商品
    const cards = page.locator('#furnGrid .furn-card');
    const n = await cards.count();
    expect(n, `试摆区至少 6 款家具，实际 ${n}`).toBeGreaterThanOrEqual(6);

    // 铁律：家具图必须是 <img>，不能是 emoji 占位
    const imgs = page.locator('#furnGrid .furn-card img');
    expect(await imgs.count(), '每张家具卡都该有图片元素').toBe(n);
    const broken = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#furnGrid .furn-card img').forEach((img) => {
        if (!img.complete || img.naturalWidth === 0) {
          out.push({ src: img.getAttribute('src') || '', alt: img.getAttribute('alt') || '' });
        }
      });
      return out;
    });
    expect(broken, `以下家具图没加载出来：${JSON.stringify(broken)}`).toEqual([]);

    // 联系信息：电话（可拨）、地址、营业时间三样都要在首屏能摸到
    const telLink = page.locator(`a[href="tel:${STORE_PHONE}"]`).first();
    await expect(telLink).toBeVisible();
    const bodyText = (await page.locator('body').innerText()).replace(/\s+/g, '');
    expect(bodyText, '首页应出现门店电话').toContain(STORE_PHONE);
    expect(bodyText, '首页应出现门店地址（柞水）').toContain('柞水');
    expect(bodyText, '首页应出现营业时间').toMatch(/9:00|20:00|全年无休/);

    expect(errors, `首页不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('A2 主站守住两色调：不引红/绿/蓝/黄原色', async ({ page }) => {
    await openHome(page);
    // CLAUDE.md §7：只有 #3a2818（深咖）+ #faf6ef（奶白）。后台页另有既定约定，主站不许。
    const offenders = await page.evaluate(() => {
      const bad = [];
      const isBad = (c) => {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return false;
        const [r, g, b] = [+m[1], +m[2], +m[3]];
        // 纯红 / 纯绿 / 纯蓝判定（含高饱和变体）：某通道远高于其它两个
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max - min < 60) return false;                 // 近灰/近白/近黑，放过
        if (r === max && r - g > 60 && r - b > 60) return true;   // 红
        if (g === max && g - r > 60 && g - b > 60) return true;   // 绿
        if (b === max && b - r > 60 && b - g > 60) return true;   // 蓝
        return false;
      };
      document.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor']) {
          const v = cs[prop];
          if (v && isBad(v)) bad.push(`${el.tagName}.${el.className} ${prop}=${v}`);
        }
      });
      return [...new Set(bad)].slice(0, 12);
    });
    expect(offenders, `主站出现原色，违反两色调铁律：${JSON.stringify(offenders)}`).toEqual([]);
  });

  test('A3 首页业务 CTA 高度 ≥ 44px（老人手指粗）', async ({ page }) => {
    await openHome(page);
    // 只量业务 CTA（试摆/拨号/默认图/家具卡）。顶栏导航链另见 A3b——那是已知缺陷。
    const tooSmall = await page.evaluate(() => {
      const out = [];
      // 只取试摆/默认图/家具卡/品类 tab；顶栏与底部固定栏的 tel: 链归 A3b（同一已知缺陷）
      const sel = '#submitBtn, #useDefaultBtn, .furn-card, .take-home-btn, .product-link, .cat-tab, .fbtn';
      document.querySelectorAll(sel).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 44) out.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 16) });
      });
      return out;
    });
    expect(tooSmall, `以下业务 CTA 高度不足 44px：${JSON.stringify(tooSmall)}`).toEqual([]);
  });

  // ⚠️ 已知缺陷：src/index.html 顶栏导航链（AI 导购 / 联系我们 / 登录）和电话小字
  //   实测高度只有 23~33px，低于 Apple HIG 的 44px 最小可点区域。
  //   客群是县城老人、手指粗，这几处是导航级入口却要点得很准。
  //   期望改法：给 .nav-actions a / .nav-logo small 补 min-height:44px（或用 padding 撑开）。
  // 已修：顶栏「AI 导购 / 联系我们 / 登录」实测只有 23~33px 高，低于 Apple HIG 的
  // 44px 最小可点区域，而客群是手指粗的县城老人、这又是导航级入口。
  // axing-ui 的 F1 只量 #axing，主站整条漏网。现在统一 min-height:44px。
  test('A3b 顶栏导航链高度 ≥44px（老人手指粗，导航级入口不能只有 23px）', async ({ page }) => {
    await openHome(page);
    const small = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.nav-actions a, .nav-logo small, .nav-actions a[href^="tel:"]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (r.height < 44) out.push({ text: (el.textContent || '').trim().slice(0, 12), h: Math.round(r.height) });
      });
      return out;
    });
    expect(small, `顶栏导航链里这些链接不足 44px：${JSON.stringify(small)}`).toEqual([]);
  });
});

// ============================================================================
// B. 两条进门路径：默认客厅图（不要求先上传）& 真实上传
// ============================================================================
test.describe('B · 进门路径', () => {
  test('B1 「没有照片？用默认房间图体验一下」不要求先上传就能试摆', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });

    await page.locator('#furnGrid .furn-card').first().click();
    await page.fill('#phoneInput', '13800138000');
    // 默认图按钮：点了就把预览换成默认房间图，且不该弹「请先上传」
    await page.locator('#useDefaultBtn').click();
    await expect(page.locator('#useDefaultBtn')).toHaveClass(/active/);
    const previewSrc = await page.locator('#roomPreview').getAttribute('src');
    expect(previewSrc, '点默认图后预览应有 src').toBeTruthy();

    // 预览图要真加载得出来（object-fit:contain，别把房间裁坏）
    await page.waitForFunction(() => {
      const img = document.getElementById('roomPreview');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 8000 }).catch(() => { /* 让下面的断言去报 */ });
    const ok = await page.evaluate(() => {
      const img = document.getElementById('roomPreview');
      return img ? { w: img.naturalWidth, fit: getComputedStyle(img).objectFit } : null;
    });
    expect(ok && ok.w, '默认客厅图应加载得出来').toBeGreaterThan(0);
    expect(ok.fit, '房间预览必须 contain，cover 会把关键部位裁掉').toBe('contain');

    expect(errors, `默认图路径不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('B2 真实上传：选一张客厅照 → 预览出现 → 能带到试摆', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });

    await page.setInputFiles('input[name="room"]', path.join(process.cwd(), 'src', 'images', 'default-room.jpg'));
    await expect(page.locator('#roomPreview')).toBeVisible();
    await page.waitForFunction(() => {
      const img = document.getElementById('roomPreview');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 8000 });
    // 选了真图，默认图按钮就不该还是 active 态
    await expect(page.locator('#useDefaultBtn')).not.toHaveClass(/active/);

    expect(errors, `上传路径不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('B3 后端上传接口：真实文件 → MinIO 返回 url', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });
    await page.setInputFiles('input[name="room"]', path.join(process.cwd(), 'src', 'images', 'default-room.jpg'));
    await page.waitForTimeout(1500);

    // 直接打一次接口验真落盘（页面只在提交成功后才 upload，这里单独验链路）
    const r = await page.evaluate(async () => {
      const buf = await (await fetch('/images/default-room.jpg')).blob();
      const fd = new FormData();
      fd.append('file', new File([buf], 'room.jpg', { type: 'image/jpeg' }));
      fd.append('phone', '13800138000');
      const res = await fetch('/api/upload/room', { method: 'POST', body: fd });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    expect(r.status, `上传接口应 200：${JSON.stringify(r.body)}`).toBe(200);
    expect(r.body && r.body.success).toBe(true);
    expect(r.body.data && r.body.data.url, '应返回可访问的 url').toBeTruthy();
  });
});

// ============================================================================
// C. 试摆：读秒计时器必须自己走起来；结果要么出图、要么诚实说明
// ============================================================================
test.describe('C · 试摆', () => {
  test('C1 读秒计时器自己走起来，界面不像卡死', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });
    await page.locator('#furnGrid .furn-card').first().click();
    await page.fill('#phoneInput', '13800138000');
    await page.locator('#useDefaultBtn').click();

    // 打桩一个慢响应（4s），才能看清计时器在请求期间是否真的在跳
    await page.route('**/api/tryon/ai-anon', async (route) => {
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            compositionUrl: '/images/default-room.jpg',
            aiError: null,
            demoType: 'ai-composition',
            product: { name: '测试沙发', subtitle: '打桩' },
            remaining: 2,
          },
        }),
      });
    });

    await page.locator('#submitBtn').click();
    // 计时器一按就 active，并开始往上跳
    await expect(page.locator('#bigTimer')).toHaveClass(/active/, { timeout: 15000 });
    const first = await page.locator('#bigTimerNum').innerText();
    await page.waitForTimeout(1600);
    const second = await page.locator('#bigTimerNum').innerText();
    expect(parseFloat(second), `计时器应自己走（${first} → ${second}）`).toBeGreaterThan(parseFloat(first) || 0);
    expect(parseFloat(second), '1.6s 后至少走到 1.0 秒').toBeGreaterThanOrEqual(1.0);

    // 出图后计时器必须停（不能一直跳到天荒地老）
    await expect(page.locator('#bigTimer')).not.toHaveClass(/active/, { timeout: 20000 });
    await expect(page.locator('.preview-img')).toBeVisible({ timeout: 20000 });
    // 成功路径不该挂「AI 暂不可用」的降级横幅
    await expect(page.locator('.tryon-result').getByText('AI 暂不可用')).toHaveCount(0);

    expect(errors, `试摆过程不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  // ⚠️ 已知缺陷（真被打到）：合成彻底失败时 src/index.html 的 showAnonResult / showResult
  //   只渲染 esc(d.aiError)。而后端 callTryonAI 上游全挂时抛的是
  //   'AI upstream failed and no fallback image available'（server.js:896）——
  //   一句英文技术文案，没有门店电话、也没有可点的拨号按钮。
  //   顾客在 AI 试摆失败这一刻恰恰最需要「打给店里」（CLAUDE.md §13 的最终解法）。
  //   期望改法：失败分支固定渲染一句人话 + <a href="tel:13359140982"> 一键拨号，
  //   aiError 收进折叠详情或只在开发态露出。
  test('C2 AI 整体不可用：失败必须是人话 + 有门店电话出路', async ({ page }) => {
    // 已修：原先直接把后端 aiError 原文（英文技术文案
    // 「AI upstream failed and no fallback image available」）摆给顾客，
    // 那一刻恰恰是他最需要「打给店里」的时候。现在固定渲染人话 + 大号拨号按钮，
    // 原文折进 <details> 只给排查用。
    const errors = [];
    await openHome(page, { errors });
    await page.locator('#furnGrid .furn-card').first().click();
    await page.fill('#phoneInput', '13800138000');
    await page.locator('#useDefaultBtn').click();
    await page.route('**/api/tryon/ai-anon', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            compositionUrl: null, compositionBase64: null,
            aiError: 'AI upstream failed and no fallback image available',
            demoType: 'side-by-side',
          },
        }),
      });
    });

    await page.locator('#submitBtn').click();
    // 计时器是瞬态：请求快时它可能在 Playwright 观察到 active 之前就收尾了
    // （F 组报告里记过这个坑的正反两面：`not.toHaveClass(/active/)` 在从未 active 时会
    // 立即通过，于是把「还在转圈」误判成静默失败）。所以不写死「必须看到 active」，
    // 只要求流程真的跑完——结果区出现内容即可，计时器顺带记录（不参与断言）。
    await page.evaluate(() => {
      window.__sawBigTimerActive = Boolean(document.getElementById('bigTimer'));
    });
    await page.waitForFunction(() => {
      const t = document.getElementById('bigTimer');
      const box = document.querySelector('.tryon-result');
      const hasResult = box && /合成失败|暂不可用|合成服务|没合成出来|摆放好了|在你家/.test(box.textContent || '');
      const timerSettled = !t || !/active/.test(t.className);
      return Boolean(hasResult && timerSettled);
    }, null, { timeout: 30000 });

    const r = await page.evaluate((phone) => {
      const box = document.querySelector('.tryon-result') || {};
      return {
        text: (box.textContent || '').replace(/\s+/g, ''),
        dialBtn: !!box.querySelector(`a[href="tel:${phone}"]`),
      };
    }, STORE_PHONE);

    // 1) 不能静默
    expect(/合成失败|暂不可用|合成服务|没合成出来/.test(r.text), 'AI 不可用时必须有横幅或说明，不能静默').toBe(true);
    // 2) 不能把英文技术文案直接摆给顾客
    expect(r.text, `顾客看到的是英文技术文案：${r.text.slice(0, 120)}`).not.toMatch(/upstream failed|no fallback image/i);
    // 3) 必须给一条当场能用的出路
    expect(r.dialBtn || r.text.includes(STORE_PHONE),
      `失败结果区既无拨号按钮也无门店号码：${r.text.slice(0, 120)}`).toBe(true);

    expect(errors, `降级过程不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('C3 真打一次合成：出图或诚实报错都算过', async ({ page }) => {
    test.slow();                       // 生产首帧 ~130s，给足
    const errors = [];
    await openHome(page, { errors });
    await page.locator('#furnGrid .furn-card').first().click();
    await page.fill('#phoneInput', '13800138000');
    await page.locator('#useDefaultBtn').click();
    await page.locator('#submitBtn').click();

    await expect(page.locator('#bigTimer')).not.toHaveClass(/active/, { timeout: 200000 });
    const st = await page.evaluate(() => {
      const box = document.querySelector('.tryon-result') || {};
      return {
        hasImg: !!box.querySelector('.preview-img'),
        imgOk: (() => { const i = box.querySelector('.preview-img'); return i ? i.complete && i.naturalWidth > 0 : false; })(),
        text: (box.textContent || '').replace(/\s+/g, ''),
      };
    });
    // 出图：必须真加载得出来
    if (st.hasImg) {
      expect(st.imgOk, `合成图没加载出来：${st.text.slice(0, 120)}`).toBe(true);
      return;
    }
    // 没出图：必须给一句人能看懂的话（不是空白、不是 undefined）
    expect(st.text.length, `试摆结果区不该空白：${st.text.slice(0, 120)}`).toBeGreaterThan(6);
    expect(st.text).not.toMatch(/undefined|TypeError|Cannot read/);
    expect(errors, `试摆失败路径不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('C4 生成期间按钮禁用：顾客连点打不出第二个请求', async ({ page }) => {
    await openHome(page);
    await page.locator('#furnGrid .furn-card').first().click();
    await page.fill('#phoneInput', '13800138000');
    await page.locator('#useDefaultBtn').click();
    await page.route('**/api/tryon/ai-anon', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { compositionUrl: '/images/default-room.jpg', demoType: 'ai-composition' } }),
      });
    });

    const reqs = [];
    page.on('request', (r) => { if (r.url().includes('/api/tryon/ai-anon')) reqs.push(r.url()); });

    await page.locator('#submitBtn').click();
    await expect(page.locator('#submitBtn')).toBeDisabled();
    // 防线就是浏览器原生：disabled 的按钮点不动，submit 事件根本不会派发。
    // 不用 force:true 去绕过它——那是在测一个真实顾客做不到的动作。
    const stillDisabled = await page.evaluate(() => document.getElementById('submitBtn').disabled);
    expect(stillDisabled, '生成期间按钮应保持 disabled').toBe(true);

    await page.waitForTimeout(1500);
    expect(reqs.length, '生成期间只应有一个合成请求').toBe(1);
    // 生成结束后按钮要恢复可点（否则顾客想再试一次也没门）
    await expect(page.locator('#submitBtn')).toBeEnabled({ timeout: 15000 });
  });


  test('C5 预设 prompt 六个都在，「自定义」才展开输入框', async ({ page }) => {
    await openHome(page);
    const opts = await page.locator('#presetSelect option').evaluateAll((els) => els.map((e) => e.value));
    for (const v of ['default', 'sunlight', 'night', 'minimal', 'family', 'custom']) {
      expect(opts, `预设缺 ${v}：${opts.join(',')}`).toContain(v);
    }
    // custom 才显示 textarea
    await expect(page.locator('#customPrompt')).toBeHidden();
    await page.selectOption('#presetSelect', 'custom');
    await expect(page.locator('#customPrompt')).toBeVisible();
  });
});

// ============================================================================
// D. 商品详情 → 下单 → 订单成功页
// ============================================================================
test.describe('D · 详情与下单', () => {
  test('D1 商品详情：价格/尺寸/「我要这个」都在，且跳到下单页', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });

    // 从首页 catalog 区点进详情
    await page.locator('#catalogSections .product-link').first().click();
    await page.waitForURL(/\/product\//);
    await page.waitForFunction(() => document.getElementById('buyBtn') && document.getElementById('buyBtn').href, null, { timeout: 15000 });

    const info = await page.evaluate(() => ({
      price: ((document.querySelector('.info .price') || {}).textContent || '').trim(),
      sub: ((document.querySelector('.info .sub') || {}).textContent || '').trim(),
      size: ((document.querySelector('.product-img .size') || {}).textContent || '').trim(),
      buy: document.getElementById('buyBtn').href,
    }));
    expect(info.price, '详情页应有价格').toMatch(/¥|\d/);
    expect(info.sub.length, '详情页应有副标题').toBeGreaterThan(2);
    expect(info.buy, '「我要这个」应指向下单页').toMatch(/\/checkout\//);

    expect(errors, `详情页不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('D2 下单：称呼/手机号/地址 → 提交 → 成功页有订单号 + 拨号按钮', async ({ page }) => {
    const errors = [];
    await openHome(page, { errors });
    await page.locator('#furnGrid .furn-card').first().click();

    const productId = await page.locator('#furnGrid .furn-card').first().getAttribute('data-id');
    await page.goto(`${BASE_URL}/checkout/${productId}`);
    await page.waitForFunction(() => document.getElementById('submit-btn'), null, { timeout: 15000 });

    await page.fill('#name', '张阿姨');
    await page.fill('#phone', '13800138000');
    await page.selectOption('#address', { index: 0 });
    await page.fill('#spec', '要 3.4 米那款');
    await page.locator('#submit-btn').click();

    await page.waitForURL(/\/order\//, { timeout: 20000 });
    await page.waitForFunction(() => {
      const t = (document.getElementById('order-detail') || {}).textContent || '';
      return t.includes('订单号');
    }, null, { timeout: 15000 });

    const detail = (await page.locator('#order-detail').innerText()).replace(/\s+/g, '');
    expect(detail).toContain('订单号');
    expect(detail).toContain('13800138000');
    // 服务端有意脱敏：称呼「张阿姨」只露姓、地址「来店自提」整串打星。
    // 这不是 bug——订单详情页可能被截图外传，脱敏是对的。断言要验脱敏真的生效。
    expect(detail, '称呼应被脱敏（只露姓）').toMatch(/张\*+|张·+/);
    expect(detail, '称呼不该明文露出').not.toContain('张阿姨');
    // 成功页必须能一键打给店里（老人卡住时的最终解法）
    await expect(page.locator(`a[href="tel:${STORE_PHONE}"]`).first()).toBeVisible();

    // 真落盘了：orders.json 里应能查到
    const saved = await page.evaluate(async (p) => {
      const r = await fetch('/api/orders/by-phone/' + p);
      const d = await r.json();
      return (d.data && d.data.orders) || [];
    }, '13800138000');
    expect(saved.length, '下单后按手机号应能查到').toBeGreaterThan(0);
    expect(saved[0].name, '按手机号查回的称呼也应脱敏').toBe('张**');

    expect(errors, `下单链路不该有页面报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('D3 下单校验：空称呼 / 坏手机号各有对应人话', async ({ page }) => {
    await openHome(page);
    await page.locator('#furnGrid .furn-card').first().click();
    const productId = await page.locator('#furnGrid .furn-card').first().getAttribute('data-id');
    await page.goto(`${BASE_URL}/checkout/${productId}`);
    await page.waitForFunction(() => document.getElementById('submit-btn'), null, { timeout: 15000 });

    const bad = await page.evaluate(async (pid) => {
      const out = [];
      const cases = [
        [{ name: '', phone: '13800138000', productId: pid }, '称呼'],
        [{ name: '李四', phone: '12345', productId: pid }, '手机号'],
        [{ name: '李四', phone: '10000000000', productId: pid }, '手机号'],
        [{ name: '王五', phone: '13800138000' }, '商品'],
      ];
      for (const [body, kw] of cases) {
        const r = await fetch('/api/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json().catch(() => null);
        out.push({ status: r.status, kw, msg: (d && d.error) || '' });
      }
      return out;
    }, productId);

    expect(bad[0].status, '空称呼应 400').toBe(400);
    expect(bad[0].msg).toContain('称呼');
    expect(bad[1].status, '短手机号应 400').toBe(400);
    expect(bad[1].msg).toContain('手机号');
    expect(bad[2].status, '10000000000 前端放行、后端应 400').toBe(400);
    expect(bad[3].status, '缺商品应 400').toBe(400);
    for (const c of bad) {
      expect(c.msg, '错误必须是人话，不能是 undefined').not.toMatch(/undefined|TypeError/);
    }
  });

  test('D4 登录后能按手机号查到刚下的单', async ({ page }) => {
    await openHome(page);
    await page.locator('#furnGrid .furn-card').first().click();
    const productId = await page.locator('#furnGrid .furn-card').first().getAttribute('data-id');

    // 先造一单（同一手机号）。注意「我的订单」只渲染商品名/价格/地址/规格，
    // 不渲染顾客称呼，所以用独特 spec 当可识别标记，别拿 name 断言。
    await page.request.post(`${BASE_URL}/api/orders`, {
      data: { name: '登录查单', phone: '13800138000', productId, address: '来店自提', quantity: 1, spec: '登录查单验证' },
    });

    await page.goto(`${BASE_URL}/login`);
    await page.fill('#phone', '13800138000');
    await page.fill('#code', '123456');
    await page.locator('#login').click();
    await page.waitForFunction(() => {
      const t = (document.getElementById('msg') || {}).textContent || '';
      return /成功|欢迎/.test(t) || location.pathname !== '/login';
    }, null, { timeout: 15000 });

    await page.goto(`${BASE_URL}/my-orders`);
    // #content 里没有「订单」二字（卡内标题是「单号 xxx」），等订单卡或空态出现
    await page.waitForFunction(() => {
      const c = document.getElementById('content') || {};
      const t = c.textContent || '';
      return !!c.querySelector('.order') || t.includes('暂无');
    }, null, { timeout: 15000 });

    const text = (await page.locator('#content').innerText()).replace(/\s+/g, '');
    expect(text, '登录后应显示手机号').toContain('13800138000');
    expect(text, '登录后我的订单应能查到刚造的那条').toContain('登录查单验证');
  });
});

// ============================================================================
// E. 默认客厅图：必须 object-fit:contain（CLAUDE.md §9 记过 cover 裁坏的坑）
// ============================================================================
test.describe('E · 默认客厅图', () => {
  test('E1 默认客厅图可用：沙发品类默认图加载得出来', async ({ page }) => {
    await openHome(page);
    const r = await page.evaluate(async () => {
      const out = [];
      for (const u of ['/images/default-room.jpg']) {
        const res = await fetch(u);
        const b = await res.blob();
        out.push({ url: u, status: res.status, bytes: b.size, type: b.type });
      }
      return out;
    });
    for (const x of r) {
      expect(x.status, `${x.url} 应 200`).toBe(200);
      expect(x.bytes, `${x.url} 不该是 0 字节`).toBeGreaterThan(10000);
      expect(x.type, `${x.url} 应是图片`).toMatch(/^image\//);
    }
    // 默认图必须是空房间素材：带水印/带沙发的图会让顾客以为「已经摆过了」
    // （CLAUDE.md §9 记的 default-room-real.png 就是这个坑）。这里只验它能加载，
    // 构图是否干净要人眼看，见报告「未覆盖」。
  });
});
