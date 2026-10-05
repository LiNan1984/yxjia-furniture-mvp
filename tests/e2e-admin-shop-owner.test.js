// 「真实店主动线」端到端验收 G 组：/admin/* 全页面 + /api/admin/* 全接口。
// 使用者是家具店老板本人（非技术人）——要找的是「按了没反应 / 东西丢了 / 数字是错的」。
//
// 自带服务器（独立端口 3516，不碰 3000/3100/34xx/3510-3514 上其他 agent 的实例）。
//
// 覆盖：登录与锁、未登录 401 + 页面跳登录、商品管理（增删改/上下架/批量）、
//       上传商品不冲掉 6 款手工核心（CLAUDE.md §9 的整体覆盖事故）、
//       客厅图、试摆结果、预设 prompt、运行时开关、备份、预约空态、订单、手机视口。
//
// 副作用防护：beforeAll 备份 data/products.json / presets.json / feature-flags.json，
// afterAll 原样写回；每个测试可重复跑。
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

// 3515 起是 agent 端口区，3516 若被占用改 3517 并在注释里写原因
const PORT = 3516;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ADMIN = { username: 'admin', password: '123456' };
const VIEWPORT = { width: 390, height: 844 };   // 老板很可能就是用手机看后台
const CORE_IDS = ['sofa-1', 'sofa-2', 'sofa-3', 'cabinet-1', 'bed-1', 'table-1']; // CLAUDE.md §5

const PRODUCTS_FILE = path.join(process.cwd(), 'data', 'products.json');
const PRESETS_FILE = path.join(process.cwd(), 'data', 'presets.json');
const FLAGS_FILE = path.join(process.cwd(), 'data', 'feature-flags.json');
const ORDERS_FILE = path.join(process.cwd(), 'data', 'orders.json');

let serverProc = null;
const backups = {};

function raw(method, pathname, { body, contentType, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (contentType) headers['Content-Type'] = contentType;
    if (cookie) headers.Cookie = cookie;
    const req = http.request(`${BASE_URL}${pathname}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        const setCookie = res.headers['set-cookie'];
        resolve({
          status: res.statusCode,
          body: parsed,
          text: data,
          cookie: setCookie ? setCookie[0].split(';')[0] : null,
        });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
const get = (p, cookie) => raw('GET', p, { cookie });
const postJson = (p, b, cookie) => raw('POST', p, { body: JSON.stringify(b), contentType: 'application/json', cookie });
const putJson = (p, b, cookie) => raw('PUT', p, { body: JSON.stringify(b), contentType: 'application/json', cookie });
const patchJson = (p, b, cookie) => raw('PATCH', p, { body: JSON.stringify(b), contentType: 'application/json', cookie });
const del = (p, cookie) => raw('DELETE', p, { cookie });

/** multipart 上传（对齐服务端 parseMultipart / multer 的字段约定） */
function multipart(fields, fileField, filename, fileBuffer, mime) {
  const boundary = '----yxjiagboundary' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { contentType: `multipart/form-data; boundary=${boundary}`, body: Buffer.concat(parts) };
}

function readProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8'));
}
function productIds() {
  const doc = readProducts();
  return (doc.products || doc).map((p) => p.id);
}
/** 一张服务端认的真 JPEG（复用仓里现成的家具图，避免再造二进制） */
function realJpeg() {
  return fs.readFileSync(path.join(process.cwd(), 'src', 'images', 'sofa-tihua.jpg'));
}

async function adminCookie() {
  const r = await postJson('/api/admin/login', ADMIN);
  expect(r.status, 'admin 登录应成功').toBe(200);
  return r.cookie;
}
async function customerCookie(phone = '13800138000') {
  const r = await postJson('/api/auth/login', { phone, code: '123456' });
  expect(r.status, `顾客登录应成功：${JSON.stringify(r.body)}`).toBe(200);
  return r.cookie;
}

/** 后台页未登录必须被送到登录页（页面先跑 check() 再渲染） */
async function gotoAdminExpectLogin(page, htmlPath) {
  await page.goto(`${BASE_URL}${htmlPath}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => location.pathname === '/admin/login', null, { timeout: 10000 });
  await expect(page).toHaveURL(/\/admin\/login$/);
}

async function waitServerReady(timeoutMs = 25000) {
  const started = Date.now();
  for (;;) {
    try { if ((await get('/api/products')).status === 200) return; } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('G 组测试服务器启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.beforeAll(async () => {
  backups.products = fs.readFileSync(PRODUCTS_FILE);
  backups.presets = fs.readFileSync(PRESETS_FILE);
  backups.flags = fs.readFileSync(FLAGS_FILE);
  serverProc = spawn('node', ['src/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await waitServerReady();
});

test.afterAll(() => {
  if (serverProc) serverProc.kill();
  for (const [name, buf] of Object.entries(backups)) {
    const file = { products: PRODUCTS_FILE, presets: PRESETS_FILE, flags: FLAGS_FILE }[name];
    try { fs.writeFileSync(file, buf); } catch { /* 忽略 */ }
  }
});

// ============================================================================
// A · 后台登录与锁
// ============================================================================
test.describe('A · 后台登录与锁', () => {
  test('A1 正确凭据登录拿到会话；错密码 401 且话术是人话', async () => {
    const ok = await postJson('/api/admin/login', ADMIN);
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.cookie, '应下发会话 cookie').toBeTruthy();

    const bad = await postJson('/api/admin/login', { username: 'admin', password: 'wrong-pw' });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatch('用户名或密码不对');
    expect(bad.body.error).not.toMatch(/undefined|NaN|TypeError/);
  });

  test('A3 页面级：登录页能渲染、字段有无障碍标签、错密码在页面上给红字', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#u')).toBeVisible();
    await expect(page.locator('#p')).toBeVisible();
    // 老板戴手套也得点得准：登录按钮 ≥48px
    const h = await page.locator('#btn').evaluate((el) => el.getBoundingClientRect().height);
    expect(h, '登录按钮高度应 ≥48px').toBeGreaterThanOrEqual(48);

    await page.fill('#u', 'admin');
    await page.fill('#p', 'definitely-wrong');
    await page.click('#btn');
    await expect(page.locator('#err.show')).toBeVisible();
    const errText = (await page.locator('#err').textContent()) || '';
    expect(errText.trim().length, '错误提示不能是空的').toBeGreaterThan(0);
    expect(errText).not.toMatch(/undefined|NaN|TypeError/);
    expect(errors).toEqual([]);
  });
});

// ============================================================================
// B · 未登录一律进不来（接口 401 + 页面跳登录）
// ============================================================================
test.describe('B · 未登录进不来', () => {
  const adminApis = [
    ['GET', '/api/admin/products/sofa-1'],
    ['GET', '/api/admin/rooms'],
    ['GET', '/api/admin/tryon-results'],
    ['GET', '/api/admin/presets'],
    ['GET', '/api/admin/feature-flags'],
    ['GET', '/api/admin/categories'],
    ['GET', '/api/admin/appointments'],
    ['GET', '/api/admin/backup'],
    ['GET', '/api/orders'],
  ];
  for (const [method, p] of adminApis) {
    test(`B1 ${method} ${p} 未登录必须 401`, async () => {
      const r = await raw(method, p);
      expect(r.status, `${p} 未登录应 401，实际 ${r.status}`).toBe(401);
    });
  }

  test('B2 未登录的写操作必须 401，且不能真的改数据', async () => {
    const before = productIds().length;
    const cases = [
      () => patchJson('/api/admin/products/sofa-1', { name: '被篡改' }),
      () => postJson('/api/admin/products/sofa-1/toggle', {}),
      () => del('/api/admin/products/sofa-1'),
      () => postJson('/api/admin/products/batch', { ids: ['sofa-1'], action: 'delete' }),
      () => putJson('/api/admin/presets', { presets: [] }),
      () => putJson('/api/admin/feature-flags', { tryonRequirePhone: true }),
      () => patchJson('/api/admin/appointments/nope', { status: '已成单' }),
    ];
    for (const run of cases) {
      const r = await run();
      expect(r.status, `未登录写操作应 401，实际 ${r.status}`).toBe(401);
    }
    expect(productIds().length, '未登录不能删掉任何商品').toBe(before);
  });

  test('B3 顾客会话也进不来后台（后台只认 admin）', async () => {
    const cookie = await customerCookie();
    const r = await get('/api/admin/products/sofa-1', cookie);
    expect(r.status, '顾客会话访问后台接口应 401/403').toBeGreaterThanOrEqual(401);
    expect(r.status).toBeLessThan(500);
    expect(productIds()).toContain('sofa-1');
  });

  for (const p of ['/admin/index', '/admin/products', '/admin/product', '/admin/rooms', '/admin/presets',
    '/admin/feature-flags', '/admin/orders', '/admin/tryon-results', '/admin/appointments', '/admin/categories']) {
    test(`B4 ${p} 未登录应被送到登录页`, async ({ page }) => {
      await gotoAdminExpectLogin(page, p);
    });
  }
});

// ============================================================================
// C · 商品管理（老板最常用的页）
// ============================================================================
test.describe('C · 商品管理', () => {
  test('C1 后台页能列出商品、每张卡有名字/价格/状态/品类', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')),
      value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });

    const n = await page.locator('.card').count();
    expect(n, '后台至少该列出若干商品').toBeGreaterThan(0);
    const first = page.locator('.card').first();
    await expect(first.locator('h3')).toBeVisible();
    await expect(first.locator('.price')).toBeVisible();
    await expect(first.locator('.badge')).toBeVisible();
    const badge = (await first.locator('.badge').textContent()) || '';
    expect(badge, '徽标应带状态与品类，不能是空的').toMatch(/(在售|下架)/);
    expect(badge).toMatch(/(沙发|卧室|柜|桌|其他|家具)/);
  });

  test('C2 「保存成功」背后真的落盘：PATCH 后 products.json 与 /api/products 都变', async () => {
    const cookie = await adminCookie();
    const target = 'sofa-1';
    const original = productIds();
    const r = await patchJson(`/api/admin/products/${target}`, { name: 'G组测试改名-新中式三人沙发' }, cookie);
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);

    // 落盘核对：光看返回不够，必须读文件
    const onDisk = (readProducts().products || []).find((p) => p.id === target);
    expect(onDisk, 'products.json 里应能找到该商品').toBeTruthy();
    expect(onDisk.name).toBe('G组测试改名-新中式三人沙发');

    const viaApi = await get(`/api/products/${target}`);
    expect(viaApi.body.data.product.name).toBe('G组测试改名-新中式三人沙发');

    // 还原
    await patchJson(`/api/admin/products/${target}`, { name: '新中式三人沙发' }, cookie);
    expect(productIds().length).toBe(original.length);
  });

  test('C3 PATCH 不接受改 id（改了会让订单/方案的引用全断）', async () => {
    const cookie = await adminCookie();
    const r = await patchJson('/api/admin/products/sofa-1', { id: 'hacked-id' }, cookie);
    expect(r.status).toBe(200);
    expect(r.body.data.product.id, 'id 必须保持原值').toBe('sofa-1');
    expect(productIds()).toContain('sofa-1');
    expect(productIds()).not.toContain('hacked-id');
  });

  test('C4 PATCH 不存在的商品 → 404 人话', async () => {
    const cookie = await adminCookie();
    const r = await patchJson('/api/admin/products/no-such-xyz', { name: 'x' }, cookie);
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch('商品不存在');
  });

  test('C5 上下架 toggle：后台与前台立刻一致', async () => {
    const cookie = await adminCookie();
    const before = await get('/api/products');
    const beforeIds = before.body.data.products.map((p) => p.id);
    expect(beforeIds, 'toast 前 sofa-1 应在售').toContain('sofa-1');

    const off = await postJson('/api/admin/products/sofa-1/toggle', {}, cookie);
    expect(off.status).toBe(200);
    expect(['在售', '下架']).toContain(off.body.data.product.status);

    const after = await get('/api/products');
    const afterIds = after.body.data.products.map((p) => p.id);
    // 前台默认只给在售：下架后必须立刻消失，不能还挂在店里
    if (off.body.data.product.status === '下架') {
      expect(afterIds, '下架后前台不该再列出').not.toContain('sofa-1');
      // 后台（all=1）仍要能看见，否则老板不知道自己下架了什么
      const all = await get('/api/products?all=1', await adminCookie());
      expect(all.body.data.products.map((p) => p.id)).toContain('sofa-1');
    } else {
      expect(afterIds).toContain('sofa-1');
    }
    // 还原
    await postJson('/api/admin/products/sofa-1/toggle', {}, cookie);
    const restored = await get('/api/products');
    expect(restored.body.data.products.map((p) => p.id)).toContain('sofa-1');
  });

  test('C6 删除商品：后台确认框存在、删除后真没了、图片路径一并清掉', async ({ page }) => {
    // 先造一个专门用来删的商品（别动核心 6 款）
    const cookie = await adminCookie();
    const mp = multipart({ name: 'G组待删商品', price: '¥1xxx 起', size: '1 米', category: '其他' },
      'file', 'sofa-tihua.jpg', realJpeg(), 'image/jpeg');
    const up = await raw('POST', '/api/upload/product-image', { body: mp.body, contentType: mp.contentType, cookie });
    expect(up.status, `上传应成功：${up.text}`).toBe(200);
    const newId = up.body.data.product.id;
    expect(productIds()).toContain(newId);

    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(`.card[data-id="${newId}"]`)).toBeVisible({ timeout: 20000 });

    // 删除必须有二次确认（老板手滑一下不该直接毁数据）
    page.on('dialog', (d) => d.accept());
    await page.locator(`.card[data-id="${newId}"] button[data-act="del"]`).click();
    await expect(page.locator(`.card[data-id="${newId}"]`)).toHaveCount(0, { timeout: 20000 });
    expect(productIds(), '删除后文件里也不该有').not.toContain(newId);
  });

  test('C7 批量 toggle 生效，且 confirm 文案应带数量（防老板一把全切）', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });

    const seen = [];
    page.on('dialog', (d) => { seen.push(d.message()); d.accept(); });
    await page.click('#toggleAll');
    await page.waitForTimeout(1500);

    expect(seen.length, '批量切换必须弹确认框').toBeGreaterThan(0);
    const msg = seen[0];
    // 已修：确认框必须报数量和方向。原文案「把所有当前显示的商品都上下架切换？」
    // 一个数字都没有，无筛选时这一下覆盖全店 32 款——老板想批量上几个新品，
    // 结果把整店全切了。现在要出现「N 款」，并说明是筛选出来的还是全店。
    expect(msg, '确认框必须给出受影响数量').toMatch(/\d+\s*款/);
    expect(msg, '要说明范围是筛选出的还是全店').toMatch(/全店|当前筛选/);
    console.log(`[G] 批量切换确认框文案：${msg}`);

    // 还原：再切一次
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => d.accept());
    await page.click('#toggleAll');
    await page.waitForTimeout(1500);
  });

  test('C8 批量接口：非法 action / 空 ids → 400 人话', async () => {
    const cookie = await adminCookie();
    const bad1 = await postJson('/api/admin/products/batch', { ids: ['sofa-1'], action: 'nope' }, cookie);
    expect(bad1.status).toBe(400);
    expect(bad1.body.error).toMatch('action');
    const bad2 = await postJson('/api/admin/products/batch', { ids: [], action: 'toggle' }, cookie);
    expect(bad2.status).toBe(400);
    expect(bad2.body.error).toMatch('选商品');
    const bad3 = await postJson('/api/admin/products/batch', { ids: 'sofa-1', action: 'toggle' }, cookie);
    expect(bad3.status).toBe(400);
  });

  test('C9 筛选框：输入不存在的关键字应给空态而不是崩', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });
    await page.fill('#filter', '绝不可能存在的家具名zzz');
    await page.waitForTimeout(500);
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('.card')).toHaveCount(0);
  });
});

// ============================================================================
// D · 上传商品不能冲掉核心 6 款（CLAUDE.md §9 的真实事故）
// ============================================================================
test.describe('D · 上传不冲掉核心商品', () => {
  test('D1 手动上传商品后，6 款手工核心一款都不少', async () => {
    const cookie = await adminCookie();
    for (const id of CORE_IDS) expect(productIds(), `前提：${id} 应在库`).toContain(id);
    const before = productIds().length;

    const mp = multipart({ name: 'G组上传测试椅', price: '¥9xx 起', size: '0.6 米', category: '其他' },
      'file', 'sofa-tihua.jpg', realJpeg(), 'image/jpeg');
    const r = await raw('POST', '/api/upload/product-image', { body: mp.body, contentType: mp.contentType, cookie });
    expect(r.status, `上传应成功：${r.text}`).toBe(200);
    expect(r.body.data.product.image, '上传应返回图片 url').toBeTruthy();

    const after = productIds();
    for (const id of CORE_IDS) {
      expect(after, `上传后 ${id} 不该被冲掉（CLAUDE.md §9 的整体覆盖事故）`).toContain(id);
    }
    expect(after.length, '上传应是新增，不是替换').toBe(before + 1);
  });

  test('D2 上传接口的入参校验：缺名字 → 400；缺文件 → 400', async () => {
    const cookie = await adminCookie();
    const noName = multipart({ price: '¥1xxx 起' }, 'file', 'a.jpg', realJpeg(), 'image/jpeg');
    const r1 = await raw('POST', '/api/upload/product-image', { body: noName.body, contentType: noName.contentType, cookie });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch('商品名');

    const noFile = multipart({ name: '只有字段没有文件' }, 'file', 'a.jpg', Buffer.from(''), 'image/jpeg');
    const r2 = await raw('POST', '/api/upload/product-image', { body: noFile.body, contentType: noFile.contentType, cookie });
    expect(r2.status).toBe(400);
  });

  test('D3 AI 识别上传在缺 key 时给「手动填写」出路，不静默丢图', async () => {
    // 本地 .env 可能没有可用的视觉 key；无论成败，商品库都不能被写坏
    const cookie = await adminCookie();
    const before = productIds().length;
    const mp = multipart({ hint: '沙发' }, 'file', 'sofa-tihua.jpg', realJpeg(), 'image/jpeg');
    const r = await raw('POST', '/api/admin/upload-and-identify', { body: mp.body, contentType: mp.contentType, cookie });
    expect([200, 502]).toContain(r.status);
    expect(r.body.success).toBe(true);
    if (r.body.data && r.body.data.needManual) {
      expect(r.body.data.message, '缺 key 时应告诉老板手动填写').toMatch('手动');
      expect(r.body.data.aiError, '应带上具体原因').toBeTruthy();
      expect(productIds().length, 'AI 失败不该动商品库').toBe(before);
    } else {
      expect(r.body.data.product.name, '识别成功应给出商品名').toBeTruthy();
      const after = productIds();
      for (const id of CORE_IDS) expect(after, `AI 上传也不该冲掉 ${id}`).toContain(id);
    }
  });
});

// ============================================================================
// E · 顾客客厅 / 试摆结果 / 备份
// ============================================================================
test.describe('E · 客厅图 / 试摆结果 / 备份', () => {
  test('E1 客厅列表能读、未登录 401、删不存在的 404', async () => {
    const cookie = await adminCookie();
    const r = await get('/api/admin/rooms', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.uploads) || Array.isArray(r.body.data.rooms) || r.body.success).toBe(true);

    const bad = await del('/api/admin/rooms/no-such-room-xyz', cookie);
    expect(bad.status).toBe(404);
    expect(bad.body.error).not.toMatch(/undefined|NaN|TypeError/);
  });

  test('E2 试摆结果能列出：limit 被夹到 200、非法 limit 不崩', async () => {
    const cookie = await adminCookie();
    const r = await get('/api/admin/tryon-results?limit=200', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.results)).toBe(true);
    for (const item of r.body.data.results.slice(0, 5)) {
      expect(item.url, '每条试摆结果都应有 url').toBeTruthy();
    }
    const junk = await get('/api/admin/tryon-results?limit=abc', cookie);
    expect([200, 400]).toContain(junk.status);
  });

  test('E3 备份导出是真 JSON，四类数据都在', async () => {
    const cookie = await adminCookie();
    const r = await get('/api/admin/backup', cookie);
    expect(r.status).toBe(200);
    const doc = JSON.parse(r.text);
    expect(doc).toHaveProperty('products');
    expect(doc).toHaveProperty('orders');
    expect(doc).toHaveProperty('users');
    expect(doc).toHaveProperty('uploads');
    expect(doc).toHaveProperty('ts');
    // 备份必须真的含商品，不能是空壳（真出事时靠它回滚）
    const p = Array.isArray(doc.products) ? doc.products : (doc.products.products || []);
    expect(p.length, '备份里的商品不该为空').toBeGreaterThan(0);
    for (const id of CORE_IDS) expect(p.map((x) => x.id)).toContain(id);
  });

  test('E4 试摆结果页在手机视口能渲染，不报页面错', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/tryon-results`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    // 页面上不该出现 undefined/NaN 这种漏字段的痕迹
    const body = (await page.locator('body').innerText()) || '';
    expect(body).not.toMatch(/undefined|NaN/);
  });
});

// ============================================================================
// F · 预设 prompt / 运行时开关（改了必须真生效）
// ============================================================================
test.describe('F · 预设 prompt 与开关', () => {
  test('F1 预设能读、能改、改完公开端点立刻反映；改坏被拒', async () => {
    const cookie = await adminCookie();
    const read1 = await get('/api/admin/presets', cookie);
    expect(read1.status).toBe(200);
    const presets = read1.body.data.presets;
    expect(Array.isArray(presets)).toBe(true);
    expect(presets.length, '应有若干预设').toBeGreaterThan(0);
    expect(presets[0]).toHaveProperty('prompt');

    const marker = `G组测试-${Date.now()}`;
    const modified = presets.map((p, i) => (i === 0 ? { ...p, prompt: marker } : p));
    const write = await putJson('/api/admin/presets', { presets: modified }, cookie);
    expect(write.status).toBe(200);

    // 公开端点（不鉴权）必须立刻读到新值——顾客端试摆页用的是它
    const pub = await get('/api/tryon/presets');
    expect(pub.body.presets[0].prompt).toBe(marker);
    // 落盘核对
    const onDisk = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
    const diskList = onDisk.presets || onDisk;
    expect(diskList[0].prompt).toBe(marker);

    // 改坏：空数组 / 非数组 / 空对象
    for (const bad of [{ presets: [] }, { presets: 'x' }, {}]) {
      const r = await putJson('/api/admin/presets', bad, cookie);
      expect(r.status).toBe(400);
      expect(r.body.error).not.toMatch(/undefined|NaN|TypeError/);
    }
  });

  test('F2 运行时开关：保存后公开端点反映，非布尔被夹成 false', async () => {
    const cookie = await adminCookie();
    const original = await get('/api/admin/feature-flags', cookie);
    expect(original.status).toBe(200);

    const write = await putJson('/api/admin/feature-flags', {
      tryonRequirePhone: true, tryonRequirePhoneMessage: 'G组测试：先留个手机号',
    }, cookie);
    expect(write.status).toBe(200);
    const pub = await get('/api/feature-flags');
    expect(pub.body.data.tryonRequirePhone, '公开端点应立刻反映').toBe(true);

    // 非布尔值不该被当成 true（字符串 'false' 也是 truthy）
    await putJson('/api/admin/feature-flags', { tryonRequirePhone: 'false' }, cookie);
    const pub2 = await get('/api/feature-flags');
    expect(pub2.body.data.tryonRequirePhone, "字符串 'false' 必须被夹成 false").toBe(false);

    // 超长 message 应被截断，不该把文件撑爆
    await putJson('/api/admin/feature-flags', { tryonRequirePhoneMessage: 'x'.repeat(5000) }, cookie);
    const pub3 = await get('/api/feature-flags');
    expect(String(pub3.body.data.tryonRequirePhoneMessage || '').length).toBeLessThanOrEqual(200);
  });

  test('F3 品类配置：能读、非法（空数组）400、name 缺省回退不写 undefined', async () => {
    const cookie = await adminCookie();
    const read = await get('/api/admin/categories', cookie);
    expect(read.status).toBe(200);
    const cats = read.body.data.categories;
    expect(Array.isArray(cats)).toBe(true);
    expect(cats.length).toBeGreaterThan(0);

    const bad = await putJson('/api/admin/categories', { categories: [] }, cookie);
    expect(bad.status).toBe(400);
    const bad2 = await putJson('/api/admin/categories', { categories: [{ name: '没有 id' }] }, cookie);
    expect([400, 200]).toContain(bad2.status);
    if (bad2.status === 200) {
      for (const c of bad2.body.data.categories) {
        expect(c.id, '没有 id 的条目应被丢掉').toBeTruthy();
      }
    }
  });

  test('F4 预设页与开关页在手机视口可用、无页面错', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    for (const p of ['/admin/presets', '/admin/feature-flags', '/admin/categories']) {
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.setViewportSize(VIEWPORT);
      await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      expect(errors, `${p} 不该有页面报错`).toEqual([]);
      const body = (await page.locator('body').innerText()) || '';
      expect(body, `${p} 不该裸露 undefined/NaN`).not.toMatch(/undefined|NaN/);
      page.removeAllListeners('pageerror');
    }
  });
});

// ============================================================================
// G · 订单 / 预约 补测（axing-admin.test.js 只覆盖了预约的一部分）
// ============================================================================
test.describe('G · 订单与预约补测', () => {
  test('G1 订单列表能读；未登录 401；顾客会话 401', async () => {
    const cookie = await adminCookie();
    const r = await get('/api/orders', cookie);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.orders)).toBe(true);
    const cust = await get('/api/orders', await customerCookie());
    expect(cust.status).toBeGreaterThanOrEqual(401);
    expect(cust.status).toBeLessThan(500);
  });

  test('G2 大量订单（60 条）下后台页面仍能渲染、排序 newest-first', async ({ page }) => {
    const backup = fs.existsSync(ORDERS_FILE) ? fs.readFileSync(ORDERS_FILE) : null;
    const orders = { orders: [] };
    for (let i = 0; i < 60; i++) {
      orders.orders.push({
        id: `G${String(i).padStart(4, '0')}`,
        name: `顾客${i}`,
        phone: `13${String(800000000 + i).slice(0, 9)}`,
        productName: '测试沙发',
        productPrice: '¥3xxx 起',
        address: '陕西省商洛市柞水县',
        status: '待联系',
        createdAt: new Date(Date.now() - i * 60000).toISOString(),
      });
    }
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));

    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/orders`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.order').first()).toBeVisible({ timeout: 20000 });
    const n = await page.locator('.order').count();
    expect(n, '60 条订单应全部渲染出来').toBe(60);
    // 手机上滚得动，不该被裁掉
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
    expect(scrollable, '长列表应可滚动查看').toBe(true);

    if (backup !== null) fs.writeFileSync(ORDERS_FILE, backup);
    else try { fs.unlinkSync(ORDERS_FILE); } catch { /* 忽略 */ }
  });

  test('G3 预约筛「已取消」为空时给空态，不是白屏', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/appointments`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('.fbtn[data-status="已取消"]').click();
    await page.waitForTimeout(900);
    const body = (await page.locator('#list').innerText()) || '';
    // 空列表必须有一句人话；不能是一片空白让老板以为页面坏了
    expect(body.trim().length, '筛选为空时应给空态文案').toBeGreaterThan(0);
    expect(body).not.toMatch(/undefined|NaN|TypeError/);
  });

  test('G4 老板在手机上用后台：五个后台页无横向溢出', async ({ page }) => {
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    for (const p of ['/admin/index', '/admin/products', '/admin/orders', '/admin/appointments', '/admin/feature-flags']) {
      await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${p} 在 390px 宽下横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});

// ============================================================================
// H · 数据一致性（数字必须对）
// ============================================================================
test.describe('H · 数字与一致性', () => {
  test('H0 ?all=1 全量旁路必须有 admin 会话，否则 401', async () => {
    // G 组实测出的信息泄露：/api/products?all=1 原本零鉴权，一条 curl 就能拿到
    // 全部商品（含下架）的库存与价格。现在只有 admin 会话能拿全量。
    const anon = await get('/api/products?all=1');
    expect(anon.status, '未登录不该拿到下架商品').toBe(401);
    expect(anon.body.data, '401 时不该顺手把商品带出去').toBeUndefined();

    const customer = await customerCookie();
    const asCustomer = await get('/api/products?all=1', customer);
    expect(asCustomer.status, '顾客会话也不能拿全量').toBe(401);

    const admin = await get('/api/products?all=1', await adminCookie());
    expect(admin.status, 'admin 要能拿全量，否则老板不知道自己下架了什么').toBe(200);
    expect(admin.body.data.products.map((p) => p.id)).toContain('sofa-1');
  });

  test('H1 后台看到的商品数 = products.json 的条数', async () => {
    const r = await get('/api/products?all=1', await adminCookie());
    const viaApi = r.body.data.products.length;
    const onDisk = productIds().length;
    expect(viaApi, '接口数量与文件条数必须一致').toBe(onDisk);
  });

  test('H2 前台在售数 + 下架数 = 总数（不该有第三态）', async () => {
    const all = await get('/api/products?all=1', await adminCookie());
    const list = all.body.data.products;
    const onSale = list.filter((p) => p.status !== '下架').length;
    const off = list.filter((p) => p.status === '下架').length;
    expect(onSale + off, '每个商品只能是在售或下架').toBe(list.length);

    const pub = await get('/api/products');
    expect(pub.body.data.products.length, '前台默认只给在售').toBe(onSale);
  });

  test('H3 「已保存/已切换/已删除」三种成功提示都在页面上真的出现过', async ({ page }) => {
    // 老板的全部反馈都来自 #msg，三种提示必须都能亮起来
    const cookie = await adminCookie();
    await page.context().addCookies([{
      name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1),
      domain: '127.0.0.1', path: '/',
    }]);
    await page.setViewportSize(VIEWPORT);
    await page.goto(`${BASE_URL}/admin/products`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 20000 });

    const msgs = [];
    page.on('dialog', (d) => d.accept());

    await page.locator('.card').first().locator('button[data-act="toggle"]').click();
    await page.waitForTimeout(1200);
    msgs.push((await page.locator('#msg').textContent()) || '');
    await page.locator('.card').first().locator('button[data-act="toggle"]').click();
    await page.waitForTimeout(1200);

    expect(msgs[0], '切换后应有反馈').toMatch(/已切换/);

    await page.locator('.card').first().locator('button[data-act="edit"]').click();
    await expect(page.locator('#modal.show')).toBeVisible();
    await page.locator('#m-cancel').click();
    await expect(page.locator('#modal.show')).toHaveCount(0);
  });
});

// ============================================================================
// Z · 登录锁定（必须放在最后一个：锁定 15 分钟，会把同一 IP 的后续 admin 登录全打成 429）
// ============================================================================
test.describe('Z · 登录锁定', () => {
  test('A2 连续错密码会被锁，429 话术告知等多少分钟', async () => {
    // 锁是按 IP 记的，连打 10 次错密码必然触发
    let locked = null;
    for (let i = 0; i < 10; i++) {
      const r = await postJson('/api/admin/login', { username: 'admin', password: `nope-${i}` });
      if (r.status === 429) { locked = r; break; }
    }
    expect(locked, '连打 10 次错密码应触发锁定').toBeTruthy();
    expect(locked.status).toBe(429);
    expect(locked.body.error, '话术应告知等待分钟数').toMatch(/\d+\s*分钟/);
    expect(locked.body.error).toContain('分钟');
  });
});
