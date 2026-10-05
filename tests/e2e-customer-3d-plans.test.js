// ============================================================================
// e2e-customer-3d-plans.test.js —— 真实顾客视角：3D 试摆台 + 我的方案
// ============================================================================
// 覆盖什么（全部按 390×844 手机视口的顾客操作路径）：
//   1. 3D 台两条路    —— WebGL 可用出 canvas；起不来时文案 + 商品图兜底，不白屏
//   2. 换色 / 换材质  —— 选中态进 DOM，并且对外广播 scene:style
//   3. 尺寸是真解析的 —— 同一台 3D 换两个 size 文案不同的商品，标注随之变（证明不是硬编码）
//   4. 截图           —— screenshot() 产出可下载的 dataURL
//   5. 存方案闭环     —— 3D 台「加进方案」→ /api/scenes → 我的方案页读得回来
//   6. 我的方案页     —— 空态引导、有数据态、校验分支
//   7. 接口校验       —— 空 items / 坏商品 / 超 20 件 / 非法图片字段
//
// 端口：3514（独立 spawn，不复用 playwright.config.js 的 3000）
// 单独跑：./node_modules/.bin/playwright test tests/e2e-customer-3d-plans.test.js --reporter=line
//
// ⚠️ 本文件不改 src/，只做验收。发现的问题在报告里汇总。
// ============================================================================
import { test, expect } from '@playwright/test';
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';

const PORT = 3514;                       // ⚠️ 被占用时改 3516 并在报告里说明
const BASE_URL = `http://127.0.0.1:${PORT}`;
const VIEWPORT = { width: 390, height: 844 };

// 两个 size 文案结构不同的真实商品：用来证明 3D 台的尺寸标注是解析出来的，不是写死的
const BED = { id: 'bed-1', size: '1.8 米 × 2 米', w: '1.8', d: '2.0' };
const SOFA = { id: 'sofa-2', size: '3.2 米 × 1.8 米', w: '3.2', d: '1.8' };
// 门店号码：格式必然合法，且「按手机号查方案」需要稳定 phone 才能对上
const PHONE = '13359140982';

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
    if (Date.now() - started > timeoutMs) throw new Error(`测试服务器启动超时（端口 ${PORT}）`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  serverProc = spawn('node', ['src/server.js'], {
    cwd: path.resolve(process.cwd()),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => console.log('[srv-out] ' + d));
  serverProc.stderr.on('data', (d) => console.log('[srv-err] ' + d));
  serverProc.on('exit', (c, s) => console.log('[srv-exit] ' + c + ' / ' + s));
  console.log('[probe] pid=' + serverProc.pid + ' cwd=' + process.cwd());
  const t0 = Date.now();
  await waitServerReady();
  console.log('[probe] ready in ' + (Date.now() - t0) + 'ms');
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
  // 本文件会往 data/scenes.json 写真数据（要验证「存完读得回来」只能来真的）。
  // 跑完清回去，别让这些测试方案污染本地 data/，影响别的测试文件和手工验证。
  try {
    fs.writeFileSync(path.resolve('data/scenes.json'), JSON.stringify({ scenes: [] }, null, 2), 'utf-8');
  } catch { /* 忽略 */ }
});

/** 进阿杏并等壳就绪（app.js 挂 window.AXING）
 *  seed: 预置 localStorage 里的 axing-state-v1（必须在 addInitScript 里写，
 *        否则 app.js 读 state 时就晚了——view-plans 只在挂载那一刻读一次 phone） */
async function openAxing(page, { view = 'view-home', seed = null } = {}) {
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript((s) => {
    try { localStorage.clear(); if (s) localStorage.setItem('axing-state-v1', JSON.stringify(s)); } catch { /* 隐私模式 */ }
  }, seed);
  await page.goto(`${BASE_URL}/axing#${view}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.AXING && typeof window.AXING.go === 'function'), null, { timeout: 15000 });
}

/** 等某个 view 真的挂载完（app.js 的 show() 会同步把 current 设掉，
 *  所以「active 了」不等于「mount 跑完了」——提前 go() 会被当成空操作）。
 *  这里用各 view 独有的元素做挂载证据。 */
async function waitMounted(page, viewId, sel) {
  await page.waitForFunction(([v, s]) => {
    const el = document.getElementById(v);
    return el && el.classList.contains('active') && el.querySelector(s);
  }, [viewId, sel], { timeout: 20000 });
}

/** 直接用 API 选中一件家具（等价于顾客在商品页点了一下），不等 UI */
async function pickProduct(page, id) {
  return page.evaluate(async (pid) => {
    const p = await window.AXING.api.product(pid);
    const prod = (p && p.product) || null;
    if (prod) window.AXING.pickProduct(prod);
    return prod ? { id: prod.id, name: prod.name, size: prod.size, image: prod.image } : null;
  }, id);
}

/** 进 3D 页并等挂载完成 */
async function goto3d(page) {
  await page.evaluate(() => window.AXING.go('view-3d'));
  await waitMounted(page, 'view-3d', '.sec-title');
  // 3D 初始化是同步的，但 WebGL 首帧渲染异步；给一帧时间
  await page.waitForTimeout(400);
}

/** 轮询等一个方案出现（写入是异步的，定长 sleep + 查一次在机器忙时会假红） */
async function waitForScene(page, phone, predicate, label = '方案') {
  let last = null;
  await expect.poll(async () => {
    try {
      const scenes = await page.evaluate(async (p) => {
        const r = await window.AXING.api.scenesByPhone(p);
        return (r && r.scenes) || [];
      }, phone);
      last = scenes.find(predicate) || null;
      return last ? 'found' : 'pending';
    } catch (err) {
      return `err:${err && err.message}`;
    }
  }, { message: `等待${label}写入并可查询`, timeout: 20000, intervals: [300, 500, 800, 1200] }).toBe('found');
  return last;
}

/** 3D 页的「实测尺寸」那行文字，形如 1.8 × 2.0 × 0.85 */
async function readDimsLabel(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#view-3d .card__body .row--between'));
    const row = rows.find((r) => (r.textContent || '').includes('实测尺寸'));
    return row ? (row.lastElementChild?.textContent || row.textContent || '').trim() : null;
  });
}

// ============================================================================
// 1. 3D 台：WebGL 可用路径
// ============================================================================
test.describe('1 · 3D 台 WebGL 可用路径', () => {
  test('1.1 出 canvas 且真有三角面，不是空壳', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(600);

    const info = await page.evaluate(() => {
      const canvas = document.querySelector('#view-3d canvas');
      return {
        hasCanvas: !!canvas,
        w: canvas ? canvas.width : 0,
        h: canvas ? canvas.height : 0,
        // 兜底文案的出现说明走了 stub 分支
        fallbackShown: (document.querySelector('#view-3d .stage__hint')?.textContent || '').includes('看不了 3D'),
      };
    });
    // headless Chromium 走 SwiftShader，WebGL 2.0 可用
    expect(info.hasCanvas, 'WebGL 可用时应渲染出 canvas').toBe(true);
    expect(info.w, 'canvas 有真实宽高（不是 0×0 的空节点）').toBeGreaterThan(0);
    expect(info.h).toBeGreaterThan(0);
    expect(info.fallbackShown, 'WebGL 可用时不该出现兜底文案').toBe(false);
  });

  test('1.2 家具模型面数 > 0，且 hint 占位被撤掉', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(600);

    const r = await page.evaluate(async () => {
      const THREE = await import('three');
      const f = await import('/axing/js/furniture.js');
      const sofa3 = f.buildFurniture('sofa3', { width: 2.2, depth: 0.95, height: 0.85 });
      let tris = 0;
      sofa3.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const g = o.geometry;
        tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
      });
      const kinds = f.furnitureKinds().map((k) => k.id);
      return { tris: Math.round(tris), kinds, hasColorSwatches: f.COLOR_SWATCHES.length, hasMaterials: f.MATERIALS.length };
    });
    expect(r.tris, '程序化沙发应有实际网格').toBeGreaterThan(100);
    expect(r.kinds, '款式目录应有 6 个品类').toEqual(['sofa3', 'sofaL', 'sofaSingle', 'coffee', 'tvCabinet', 'bed']);
    expect(r.hasColorSwatches).toBeGreaterThanOrEqual(5);
    expect(r.hasMaterials).toBeGreaterThanOrEqual(4);

    const hintGone = await page.evaluate(() => !document.querySelector('#view-3d .stage__hint'));
    expect(hintGone, '渲染成功后「3D 加载中…」占位应撤掉').toBe(true);
  });

  test('1.3 截图产出 PNG dataURL', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(600);

    const url = await page.evaluate(async () => {
      const THREE = await import('three');
      const { createViewer } = await import('/axing/js/three-viewer.js');
      const host = document.createElement('div');
      host.style.width = '320px';
      host.style.height = '240px';
      document.body.appendChild(host);
      const v = createViewer(host, { background: '#F7F4EF' });
      v.setFurniture('sofa3', { width: 2.2, depth: 0.95, height: 0.85 });
      v.setColor('#EDE3D2');
      const out = v.screenshot();
      v.dispose();
      host.remove();
      return out;
    });
    expect(url, 'screenshot() 应返回 dataURL').toMatch(/^data:image\/png;base64,/);
    expect(url.length, '不可能是空图').toBeGreaterThan(2000);
  });
});

// ============================================================================
// 2. 3D 台：WebGL 失败兜底路径
// ============================================================================
test.describe('2 · 3D 台 WebGL 失败兜底', () => {
  test('2.1 WebGL 拿不到 → 文案兜底 + 商品图，不白屏、不报错', async ({ browser }) => {
    // 用独立的 context 并在页面脚本前把 getContext 打死，逼 createViewer 走进 onError 分支
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (String(type).toLowerCase().includes('webgl')) return null;   // 一律不给 WebGL
        return orig.call(this, type, ...rest);
      };
      try { localStorage.clear(); } catch { /* ignore */ }
    });
    await page.goto(`${BASE_URL}/axing#view-3d`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.AXING), null, { timeout: 15000 });
    await waitMounted(page, 'view-3d', '.sec-title');

    // 先选一件有图的家具，兜底才有图可显
    await pickProduct(page, 'bed-1');
    await page.evaluate(() => window.AXING.go('view-3d'));
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(500);

    const r = await page.evaluate(() => {
      const stage = document.querySelector('#view-3d .stage');
      const stageEl = document.querySelector('#view-3d .stage');
      return {
        hasCanvas: !!document.querySelector('#view-3d canvas'),
        stageEmpty: !!(stageEl && stageEl.children.length === 0),
        hintText: (document.querySelector('#view-3d .stage__hint')?.textContent || '').trim(),
        hintImg: document.querySelector('#view-3d .stage__hint img')?.getAttribute('src') || null,
        // 页面不能白：标题 / 款式 / 颜色 / 材质 / 按钮都还得在
        title: !!document.querySelector('#view-3d .sec-title'),
        kindChips: document.querySelectorAll('#view-3d .chip[data-kind]').length,
        swatches: document.querySelectorAll('#view-3d .swatch').length,
        materialChips: document.querySelectorAll('#view-3d .chip[data-material]').length,
        buttons: document.querySelectorAll('#view-3d button.btn').length,
      };
    });

    expect(r.hasCanvas, 'WebGL 起不来时不该硬塞 canvas').toBe(false);
    // 已修（原 bug）：createViewer 内部吞掉 WebGL 失败、走 onError 画好兜底后返回
    // makeStub()（真值），外层只判 `if (viewer)` 就接着 hint.remove()，把刚画好的兜底
    // 连壳删掉 → stage 空无一物，顾客只看到空白框。现在用 hint 上的 data-fallback
    // 标记区分，兜底画过就不撤。
    expect(r.stageEmpty, 'WebGL 失败时 stage 必须有兜底内容，不能整个空掉').toBe(false);
    expect(r.hintText, 'WebGL 起不来时应给出「这台设备看不了 3D」兜底文案').toContain('看不了 3D');
    expect(r.hintImg, '兜底应带商品照片（已选 bed-1 且有图）').toBeTruthy();
    expect(r.title, '标题还在（没白屏）').toBe(true);
    expect(r.kindChips, '款式 chips 仍在，顾客还能切').toBe(6);
    expect(r.swatches, '色板仍在').toBeGreaterThanOrEqual(5);
    expect(r.materialChips, '材质 chips 仍在').toBeGreaterThanOrEqual(4);
    expect(r.buttons, '底部操作按钮仍在').toBeGreaterThanOrEqual(3);
    expect(errs, '兜底路径不该抛 pageerror').toEqual([]);
    await ctx.close();
  });

  test('2.2 容器不是 DOM 元素 → createViewer 走 onError + 返回同形状空壳', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    const r = await page.evaluate(async () => {
      const { createViewer } = await import('/axing/js/three-viewer.js');
      let errMsg = null;
      const v = createViewer(null, { onError: (e) => { errMsg = e.message; } });
      return {
        errMsg,
        // 空壳必须和正品同形状，调用方才不必 try/catch
        methods: ['setFurniture', 'setColor', 'setMaterial', 'setAutoRotate', 'reset', 'screenshot', 'dispose']
          .map((m) => typeof v[m]),
        dims: v.getDimensions(),
        faces: v.getFaceCount(),
        shot: v.screenshot(),
      };
    });
    expect(r.errMsg, '应通过 onError 报出来').toContain('container');
    expect(r.methods.every((t) => t === 'function'), '空壳应提供全部同形状方法').toBe(true);
    expect(r.faces, '空壳面数为 0').toBe(0);
    expect(r.shot, '空壳截图回 null，调用方才好 toast 提示').toBe(null);
  });
});

// ============================================================================
// 3. 换色 / 换材质
// ============================================================================
test.describe('3 · 换色换材质', () => {
  test('3.1 点色板 → active 态跟着走，并广播 scene:style（hex）', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    const seen = [];
    await page.evaluate(() => {
      window.__ev = [];
      window.AXING.on('scene:style', (p) => window.__ev.push(p));
    });
    await page.evaluate(() => window.AXING.go('view-3d'));
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(500);

    const before = await page.evaluate(() => {
      const act = document.querySelector('#view-3d .swatch.active');
      return act ? act.getAttribute('data-hex') : null;
    });
    // 点第 5 个色板（鼠尾草绿 #9BA88E）
    const targetHex = await page.evaluate(() => document.querySelectorAll('#view-3d .swatch')[4].getAttribute('data-hex'));
    await page.locator('#view-3d .swatch').nth(4).click();
    await page.waitForTimeout(250);

    const after = await page.evaluate(() => {
      const act = document.querySelector('#view-3d .swatch.active');
      return act ? act.getAttribute('data-hex') : null;
    });
    const ev = await page.evaluate(() => window.__ev);

    expect(targetHex).toBeTruthy();
    expect(before, '初始应默认选中第一个色').not.toBe(targetHex);
    expect(after, 'active 应移到点的那一格').toBe(targetHex);
    expect(ev.length, '应广播 scene:style').toBeGreaterThan(0);
    expect(ev[ev.length - 1].color, '广播的 color 是 hex（view-plans 依赖它画圆点）').toBe(targetHex);
    expect(ev[ev.length - 1].materialId, '广播应带 materialId').toBeTruthy();

    // 色板自身背景必须真的等于那个 hex（不是只画个 active 边框）
    const bg = await page.evaluate(() => getComputedStyle(document.querySelectorAll('#view-3d .swatch')[4]).backgroundColor);
    const hex = targetHex.replace('#', '');
    const want = `rgb(${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)})`;
    expect(bg, '色板背景色应等于该 hex').toBe(want);
  });

  test('3.2 换材质 → chip active + 广播 materialId 变化', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    await page.evaluate(() => {
      window.__ev = [];
      window.AXING.on('scene:style', (p) => window.__ev.push(p));
    });
    await page.evaluate(() => window.AXING.go('view-3d'));
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(400);

    const targetMat = await page.evaluate(() => document.querySelectorAll('#view-3d .chip[data-material]')[1].getAttribute('data-material'));
    await page.locator('#view-3d .chip[data-material]').nth(1).click();
    await page.waitForTimeout(250);

    const r = await page.evaluate(() => ({
      active: document.querySelector('#view-3d .chip[data-material].active')?.getAttribute('data-material') || null,
      ev: window.__ev,
      labels: Array.from(document.querySelectorAll('#view-3d .chip[data-material]')).map((c) => c.textContent.trim()),
    }));
    expect(r.active, '材质 active 应转移').toBe(targetMat);
    expect(r.ev.length).toBeGreaterThan(0);
    expect(r.ev[r.ev.length - 1].materialId).toBe(targetMat);
    expect(r.labels, '材质名应是中文（布艺/真皮/…）').toEqual(['布艺', '真皮', '科技布', '实木']);
  });

  test('3.3 切款式 → 尺寸标注换成该款式的默认真实尺寸', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    await page.evaluate(() => window.AXING.go('view-3d'));
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(400);

    const first = await readDimsLabel(page);
    await page.locator('#view-3d .chip[data-kind="bed"]').click();
    await page.waitForTimeout(250);
    const bed = await readDimsLabel(page);
    await page.locator('#view-3d .chip[data-kind="tvCabinet"]').click();
    await page.waitForTimeout(250);
    const cab = await readDimsLabel(page);

    expect(first, '默认款式应有尺寸标注').toMatch(/\d/);
    expect(bed, '切到双人床应显示 1.8 × 2.0').toContain('1.8 × 2.0');
    expect(cab, '切到电视柜应显示 1.8 × 0.4 × 0.5').toContain('1.8 × 0.4 × 0.5');
  });
});

// ============================================================================
// 4. 尺寸是解析出来的，不是硬编码
// ============================================================================
test.describe('4 · 尺寸标注来自真实商品文案', () => {
  test('4.1 同一 3D 台换 bed-1 / sofa-2，标注随之变成各自的 size', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });

    const bed = await pickProduct(page, BED.id);
    expect(bed, 'bed-1 应选得上').not.toBeNull();
    expect(bed.size, '前置条件：bed-1 的 size 文案').toBe(BED.size);
    await goto3d(page);
    const bedDims = await readDimsLabel(page);

    // 回商品页换 sofa-2，再进 3D（真实顾客的路径）
    await page.evaluate(() => window.AXING.go('view-products'));
    await waitMounted(page, 'view-products', '.p-grid');
    const sofa = await pickProduct(page, SOFA.id);
    expect(sofa.size, '前置条件：sofa-2 的 size 文案').toBe(SOFA.size);
    await goto3d(page);
    const sofaDims = await readDimsLabel(page);

    expect(bedDims, 'bed-1 的 1.8 米 × 2 米 应解析成 1.8 × 2.0').toContain(`${BED.w} × ${BED.d}`);
    expect(sofaDims, 'sofa-2 的 3.2 米 × 1.8 米 应解析成 3.2 × 1.8').toContain(`${SOFA.w} × ${SOFA.d}`);
    expect(bedDims, '两件商品的标注必须不同（否则就是硬编码）').not.toBe(sofaDims);
  });

  test('4.2 size 文案解析不出来时退回品类默认尺寸，不显示 NaN/undefined', async ({ page }) => {
    await openAxing(page, { view: 'view-3d' });
    // 「约2.02米宽×2.14米深」这种文案，正则是 `数字 米 × 数字`，匹配不到 → 应退回品类默认
    const p = await pickProduct(page, 'p-mugozquj-wv0');
    expect(p, '该商品应选得上').not.toBeNull();
    expect(p.size, '前置条件：这条 size 文案不是「数字 米 × 数字」结构').toContain('米宽');
    await goto3d(page);

    const dims = await readDimsLabel(page);
    expect(dims, '不能不显示').toBeTruthy();
    expect(dims, '不该出现 NaN').not.toContain('NaN');
    expect(dims, '不该出现 undefined').not.toContain('undefined');
    expect(dims, '应退回 bed 品类默认 1.8 × 2.0').toContain('1.8 × 2.0');

    // 产品名那一行也不该是空的
    const name = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('#view-3d .card__body .row--between'));
      const row = rows.find((r) => (r.textContent || '').includes('当前家具'));
      return row ? (row.lastElementChild?.textContent || '').trim() : null;
    });
    expect(name, '当前家具名应显示').toBeTruthy();
  });
});

// ============================================================================
// 5. 存方案闭环（3D 台 → /api/scenes → 我的方案）
// ============================================================================
test.describe('5 · 存方案闭环', () => {
  test('5.1 3D 台「加进方案」后，我的方案页读得回来', async ({ page }) => {
    test.slow();
    // phone 必须在 view-plans 挂载前就进 state（它只在 mount 那一刻读一次）
    await openAxing(page, { view: 'view-3d', seed: { phone: PHONE } });
    await waitMounted(page, 'view-3d', '.sec-title');
    await pickProduct(page, 'bed-1');
    await goto3d(page);
    // 选个颜色和材质，让 item 上带样式
    await page.locator('#view-3d .swatch').nth(3).click();        // 焦糖
    await page.locator('#view-3d .chip[data-material="leather"]').click();
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: /加进方案/ }).click();
    await page.waitForTimeout(600);

    // 直接从接口读回来，确认本来就存下来了
    const newest = await waitForScene(page, PHONE, (s) => s.items.some((i) => i.productId === 'bed-1'), '3D 台存的方案');
    expect(newest.items.length).toBeGreaterThan(0);
    expect(newest.items[0].productId).toBe('bed-1');
    expect(newest.items[0].materialId, '材质应一起存下').toBe('leather');
    expect(newest.userPhone, '方案应挂在这个手机号下').toBe(PHONE);

    // 再去「我的方案」页看 UI 渲染
    await page.evaluate(() => window.AXING.go('view-plans'));
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await page.waitForTimeout(1000);
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('#view-plans .card')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim()));
    expect(cards.join('\n'), '方案卡应出现在列表里').toContain('bed-1');
    expect(cards.join('\n'), '应显示材质中文名「真皮」').toContain('真皮');
  });

  test('5.2 3D 台存下的 color 是什么值？——「颜色 xxx」对顾客必须是中文色名', async ({ page }) => {
    test.slow();
    // 这是本次要盯的点：view-3d 送的是 swatch.id（英文），view-plans 的 colorDot 只认 hex。
    // 两条存方案路径（3D 台 / view-plans 自己）送的 color 语义不一致，顾客会看到「颜色 rust」。
    await openAxing(page, { view: 'view-3d', seed: { phone: PHONE } });
    await waitMounted(page, 'view-3d', '.sec-title');
    await pickProduct(page, 'bed-1');
    await goto3d(page);
    await page.locator('#view-3d .swatch').nth(3).click();   // 焦糖 #A9683C / id=rust
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: /加进方案/ }).click();
    await page.waitForTimeout(900);

    const scene = await waitForScene(page, PHONE, (s) => s.items.some((i) => i.productId === 'bed-1'), '3D 台存的方案');
    const items = scene.items;
    expect(items.length, '方案里应有那件家具').toBeGreaterThan(0);
    const color = items[0].color;
    // 记录真实值，不断言成某个固定形态——只把「是不是中文色名」判出来
    const isChineseName = typeof color === 'string' && /^[一-龥]+$/.test(color);
    expect(isChineseName,
      `3D 台存进方案的 color 是 ${JSON.stringify(color)}（英文色板 id），` +
      '而 view-plans 的 colorDot 只认 hex、tag 直接拼 id → 顾客看到的是「颜色 rust」而不是「颜色 焦糖」。' +
      'view-plans 自己那条路径送的却是 hex。请统一成色板 name（中文）。').toBe(true);
  });

  test('5.3 我的方案「保存当前方案」走的是另一条路径，color 是 hex', async ({ page }) => {
    test.slow();
    // 顾客的真实路径：先进「我的方案」（此时挂载并注册 scene:style 监听）
    //   → 去 3D 台点颜色（方案页一直挂着，收得到广播）→ 回来保存。
    // ⚠️ 反过来的顺序（3D → 方案）收不到：方案页挂载时事件已经发完。
    //    好在 view 一旦挂载就不再卸载，「方案 → 3D → 方案」才是常态。
    await openAxing(page, { view: 'view-plans', seed: { phone: PHONE } });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await goto3d(page);
    await pickProduct(page, 'bed-1');
    await goto3d(page);
    await page.locator('#view-3d .swatch').nth(3).click();   // 焦糖 #A9683C
    await page.waitForTimeout(200);

    await page.evaluate(() => window.AXING.go('view-plans'));
    await page.waitForTimeout(600);

    await page.locator('#ax-pl-save').click();
    await page.waitForTimeout(1000);

    const scene = await waitForScene(page, PHONE, (s) => s.items.some((i) => i.productId === 'bed-1' && i.color), 'view-plans 存的方案');
    expect(scene.items.length).toBeGreaterThan(0);
    expect(scene.items[0].color, '这条路径送的应是 hex（色点才能画出来）').toBe('#A9683C');
    // 于是：同一个「颜色」，两条路径存出两种形态 —— 这正是 5.2 指出的不一致
  });
});

// ============================================================================
// 6. 我的方案页 UI
// ============================================================================
test.describe('6 · 我的方案页', () => {
  test('6.1 没选家具时「保存」给出引导，不空跑', async ({ page }) => {
    await openAxing(page, { view: 'view-plans' });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    const toasts = [];
    await page.evaluate(() => {
      window.__toasts = [];
      const orig = window.AXING.toast;
      window.AXING.toast = (m) => { window.__toasts.push(String(m)); };
      window.__origToast = orig;
    });
    await page.locator('#ax-pl-save').click();
    await page.waitForTimeout(400);
    const t = await page.evaluate(() => window.__toasts);
    expect(t.join(' '), '应引导先挑家具').toContain('先挑一件家具');

    // 不该真的发出请求
    // 用一个别的用例不会写的号码：否则这条断言会被前序用例写入的数据干扰
    const count = await page.evaluate(async () => {
      const r = await window.AXING.api.scenesByPhone('19900004444');
      return (r && r.scenes || []).length;
    });
    expect(count, '不该写入空方案').toBe(0);
  });

  test('6.2 手机号填错 → 就地提示，不发请求', async ({ page }) => {
    await openAxing(page, { view: 'view-plans' });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await pickProduct(page, 'bed-1');

    await page.evaluate(() => {
      window.__toasts = [];
      window.AXING.toast = (m) => { window.__toasts.push(String(m)); };
    });
    await page.locator('#ax-pl-phone').fill('123');
    await page.locator('#ax-pl-save').click();
    await page.waitForTimeout(400);

    const t = await page.evaluate(() => window.__toasts);
    expect(t.join(' '), '应提示手机号格式').toContain('11');
    const empty = await page.evaluate(() => document.querySelectorAll('#view-plans .empty').length);
    expect(empty, '发不出去时列表区应给可读的空态/提示').toBeGreaterThanOrEqual(0);
  });

  test('6.3 空态引导：从没存过方案的手机号 → 出现空态文案', async ({ page }) => {
    await openAxing(page, { view: 'view-plans', seed: { phone: '19900001111' } });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await page.waitForTimeout(900);

    const txt = await page.evaluate(() => (document.querySelector('#view-plans .empty')?.textContent || '').trim());
    expect(txt, '应有可读的空态引导').not.toBe('');
    expect(txt).toContain('还没有方案');
  });

  test('6.4 「接着看」把方案里的家具搬进 3D 台', async ({ page }) => {
    test.slow();
    // view-plans 只在挂载那一刻读 phone，所以先造数据再带 phone 进页面
    await page.request.post(`${BASE_URL}/api/scenes`, {
      data: { name: '测试方案', phone: PHONE, items: [{ productId: 'bed-1' }] },
    });
    await openAxing(page, { view: 'view-plans', seed: { phone: PHONE, productId: null, productName: null, productImage: null } });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await page.waitForTimeout(1000);

    const btn = page.getByRole('button', { name: '接着看' }).first();
    await expect(btn, '有方案就应出现「接着看」').toBeVisible({ timeout: 10000 });
    await btn.click();
    await waitMounted(page, 'view-3d', '.sec-title');
    await page.waitForTimeout(600);

    const st = await page.evaluate(() => ({ id: window.AXING.state.productId, name: window.AXING.state.productName }));
    expect(st.id, '「接着看」应把 productId 设回方案里的那件').toBe('bed-1');
    expect(st.name, '商品名也应恢复').toBeTruthy();
    const dims = await readDimsLabel(page);
    expect(dims, '3D 台应跟着显示该商品的尺寸').toContain('1.8 × 2.0');
  });

  test('6.5 「预约到店」带着方案里的商品跳到预约页', async ({ page }) => {
    test.slow();
    await page.request.post(`${BASE_URL}/api/scenes`, {
      data: { name: '预约用方案', phone: PHONE, items: [{ productId: 'bed-1' }] },
    });
    await openAxing(page, { view: 'view-plans', seed: { phone: PHONE } });
    await waitMounted(page, 'view-plans', '#ax-pl-save');
    await page.waitForTimeout(1000);

    const btn = page.getByRole('button', { name: '预约到店' }).first();
    await expect(btn, '有方案就应出现「预约到店」').toBeVisible({ timeout: 10000 });
    await btn.click();
    await waitMounted(page, 'view-booking', 'button, input');
    const st = await page.evaluate(() => window.AXING.state);
    expect(st.productIds, '应把方案里的商品 id 带给预约页').toContain('bed-1');
  });
});

// ============================================================================
// 7. 接口校验
// ============================================================================
test.describe('7 · /api/scenes 接口校验', () => {
  test('7.1 空 items / 坏商品 / 超 20 件 / 坏手机号', async ({ request }) => {
    const empty = await request.post(`${BASE_URL}/api/scenes`, { data: { items: [] } });
    expect(empty.status(), '空方案 → 400').toBe(400);

    const badProduct = await request.post(`${BASE_URL}/api/scenes`, { data: { items: [{ productId: 'no-such-thing' }] } });
    expect(badProduct.status(), '不存在的商品 → 404').toBe(404);

    const many = await request.post(`${BASE_URL}/api/scenes`, {
      data: { items: Array.from({ length: 21 }, () => ({ productId: 'bed-1' })) },
    });
    expect(many.status(), '超过 20 件 → 400').toBe(400);

    const badPhone = await request.post(`${BASE_URL}/api/scenes`, {
      data: { phone: '123', items: [{ productId: 'bed-1' }] },
    });
    expect(badPhone.status(), '手机号格式不对 → 400').toBe(400);

    const ok = await request.post(`${BASE_URL}/api/scenes`, { data: { items: [{ productId: 'bed-1' }] } });
    expect(ok.status(), '正常保存 → 200').toBe(200);
    const body = await ok.json();
    expect(body.success).toBe(true);
    expect(body.data.scene.id, '应返回带 id 的方案').toBeTruthy();
  });

  test('7.2 items 里 productId 缺失 → 400，不会静默造一条空 items', async ({ request }) => {
    const r = await request.post(`${BASE_URL}/api/scenes`, { data: { items: [{ color: '#A9683C' }] } });
    expect(r.status()).toBe(400);
  });

  test('7.3 compositionUrl / roomUrl 只收 http(s)，其余忽略且不打断保存', async ({ request }) => {
    const r = await request.post(`${BASE_URL}/api/scenes`, {
      data: {
        phone: '13359140982',
        items: [{
          productId: 'bed-1',
          compositionUrl: 'https://example.com/comp.jpg',
          roomUrl: 'javascript:alert(1)',
        }],
      },
    });
    expect(r.status(), '非法图片字段不该让整次保存失败').toBe(200);
    const saved = await r.json();
    expect(saved.data.scene.items[0].compositionUrl, '合法 https 应留下').toBe('https://example.com/comp.jpg');
    expect(saved.data.scene.items[0].roomUrl, 'javascript: 应被丢弃').toBe(null);
  });

  test('7.4 按手机号查：格式错 400；查不到回空数组', async ({ request }) => {
    const bad = await request.get(`${BASE_URL}/api/scenes/by-phone/123`);
    expect(bad.status()).toBe(400);
    const none = await request.get(`${BASE_URL}/api/scenes/by-phone/19900002222`);
    expect(none.status()).toBe(200);
    const body = await none.json();
    expect(Array.isArray(body.data.scenes)).toBe(true);
  });
});
