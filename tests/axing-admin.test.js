// 阿杏店主可见性验收（对应 PM 批判 §2.3「店主看不到任何预约和方案」+ §2.11「方案不存试摆图/房间图」）
// 自带服务器（独立端口 3420，不碰 3000/3100 上的实例），覆盖：
// /api/admin/appointments 读/改/过滤/排序 + 鉴权、/api/scenes 补图字段、/admin/appointments 后台页面
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

// 3100 是 axing.test.js、3410-3415 是并行 agent 的端口，3420 若也被占请换 3421 并在注释里写原因
const PORT = 3420;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APPOINTMENTS_FILE = path.join(process.cwd(), 'data', 'appointments.json');
const SCENES_FILE = path.join(process.cwd(), 'data', 'scenes.json');
const ADMIN = { username: 'admin', password: '123456' };

let serverProc = null;

function raw(method, pathname, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const req = http.request(`${BASE_URL}${pathname}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, body: parsed, cookie: setCookie ? setCookie[0].split(';')[0] : null });
      });
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const get = (p, cookie) => raw('GET', p, { cookie });
const post = (p, b, cookie) => raw('POST', p, { body: b, cookie });
const patch = (p, b, cookie) => raw('PATCH', p, { body: b, cookie });

// 用 data/users.json 里已存在的号码登录，避免测试往 users.json 里塞新用户
const CUSTOMER_PHONE = '13800138000';
async function adminCookie() {
  const r = await post('/api/admin/login', ADMIN);
  expect(r.status, 'admin 登录应成功').toBe(200);
  return r.cookie;
}
async function customerCookie() {
  const r = await post('/api/auth/login', { phone: CUSTOMER_PHONE, code: '123456' });
  expect(r.status, '顾客登录应成功').toBe(200);
  return r.cookie;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function plusDays(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function createAppointment(over = {}) {
  const r = await post('/api/appointments', {
    name: '王阿姨',
    phone: CUSTOMER_PHONE,
    date: today(),
    slot: '上午 9:00-12:00',
    productIds: ['sofa-2'],
    note: '想看看转角沙发',
    ...over,
  });
  expect(r.status, `创建预约应成功：${JSON.stringify(r.body)}`).toBe(200);
  return r.body.data.appointment;
}

async function waitServerReady(timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('后台测试服务器启动超时');
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
  for (const f of [APPOINTMENTS_FILE, SCENES_FILE]) {
    try { fs.writeFileSync(f, JSON.stringify(f.includes('scenes') ? { scenes: [] } : { appointments: [] }, null, 2), 'utf-8'); } catch { /* 忽略 */ }
  }
});

test.describe('店主可见 · /api/admin/appointments', () => {
  test('创建预约后，店主带 admin 会话能读到称呼/手机/日期/时段/想看的家具', async () => {
    const appt = await createAppointment({ name: '李阿姨', note: '想要耐脏的布沙发' });
    const cookie = await adminCookie();
    const r = await get('/api/admin/appointments', cookie);
    expect(r.status).toBe(200);
    const hit = (r.body.data.appointments || []).find((a) => a.id === appt.id);
    expect(hit, 'admin 列表应包含刚创建的预约').toBeTruthy();
    expect(hit.name).toBe('李阿姨');
    expect(hit.phone).toBe(CUSTOMER_PHONE);
    expect(hit.date).toBe(appt.date);
    expect(hit.slot).toBe('上午 9:00-12:00');
    expect(hit.productNames).toContain('轻奢 L 形转角沙发');
    expect(hit.status).toBe('待到店');
  });

  test('未登录 / 顾客会话访问 admin 接口都被挡住', async () => {
    const anon = await get('/api/admin/appointments');
    expect([401, 403], `未登录应 401/403，实际 ${anon.status}`).toContain(anon.status);

    const cookie = await customerCookie();
    const asCustomer = await get('/api/admin/appointments', cookie);
    expect([401, 403], `顾客会话应 401/403，实际 ${asCustomer.status}`).toContain(asCustomer.status);

    // PATCH 同样要挡住（顾客不能替老板改状态）
    const appt = await createAppointment({ name: '赵阿姨' });
    const patchAsCustomer = await patch(`/api/admin/appointments/${appt.id}`, { status: '已成单' }, cookie);
    expect([401, 403]).toContain(patchAsCustomer.status);
  });

  test('PATCH 改状态：生效 / 非法值 400 / id 不存在 404', async () => {
    const appt = await createAppointment({ name: '孙阿姨' });
    const cookie = await adminCookie();

    const done = await patch(`/api/admin/appointments/${appt.id}`, { status: '已成单' }, cookie);
    expect(done.status).toBe(200);
    expect(done.body.data.appointment.status).toBe('已成单');

    const after = await get('/api/admin/appointments', cookie);
    const hit = (after.body.data.appointments || []).find((a) => a.id === appt.id);
    expect(hit.status).toBe('已成单');

    const bad = await patch(`/api/admin/appointments/${appt.id}`, { status: '随便写' }, cookie);
    expect(bad.status).toBe(400);
    const empty = await patch(`/api/admin/appointments/${appt.id}`, {}, cookie);
    expect(empty.status).toBe(400);

    const missing = await patch('/api/admin/appointments/NO-SUCH-ID', { status: '已到店' }, cookie);
    expect(missing.status).toBe(404);
  });

  test('?status= 过滤只返回对应状态', async () => {
    const cookie = await adminCookie();
    const kept = await createAppointment({ name: '周阿姨', date: plusDays(2), slot: '下午 12:00-18:00' });
    const dropped = await createAppointment({ name: '吴阿姨', date: plusDays(2), slot: '下午 12:00-18:00' });
    await patch(`/api/admin/appointments/${dropped.id}`, { status: '已取消' }, cookie);

    const r = await get('/api/admin/appointments?status=待到店', cookie);
    expect(r.status).toBe(200);
    const list = r.body.data.appointments || [];
    expect(list.every((a) => a.status === '待到店')).toBe(true);
    expect(list.some((a) => a.id === kept.id)).toBe(true);
    expect(list.some((a) => a.id === dropped.id)).toBe(false);

    const cancelled = await get('/api/admin/appointments?status=已取消', cookie);
    expect((cancelled.body.data.appointments || []).every((a) => a.status === '已取消')).toBe(true);
    expect((cancelled.body.data.appointments || []).some((a) => a.id === dropped.id)).toBe(true);

    // 未知状态值必须报错而不是静默返回全量（避免老板以为筛过了）
    const bad = await get('/api/admin/appointments?status=全部', cookie);
    expect(bad.status).toBe(400);
  });

  test('排序：三条不同日期的预约按 date 升序返回', async () => {
    const cookie = await adminCookie();
    const late = await createAppointment({ name: '远日期-郑阿姨', date: plusDays(12) });
    const soon = await createAppointment({ name: '近日期-钱阿姨', date: plusDays(1) });
    const mid = await createAppointment({ name: '中日期-冯阿姨', date: plusDays(5) });

    const r = await get('/api/admin/appointments', cookie);
    const list = r.body.data.appointments || [];
    const idx = { soon: list.findIndex((a) => a.id === soon.id), mid: list.findIndex((a) => a.id === mid.id), late: list.findIndex((a) => a.id === late.id) };
    expect(idx.soon).toBeGreaterThanOrEqual(0);
    expect(idx.soon).toBeLessThan(idx.mid);
    expect(idx.mid).toBeLessThan(idx.late);

    // 同一天里的相对顺序：按提交时间倒序（后约的放前面）
    const same1 = await createAppointment({ name: '同日-甲', date: plusDays(20) });
    await new Promise((r2) => setTimeout(r2, 20));
    const same2 = await createAppointment({ name: '同日-乙', date: plusDays(20) });
    const again = await get('/api/admin/appointments', cookie);
    const l2 = again.body.data.appointments || [];
    expect(l2.findIndex((a) => a.id === same2.id)).toBeLessThan(l2.findIndex((a) => a.id === same1.id));
  });

  test('原有顾客侧接口（POST / GET by-phone）行为不变', async () => {
    const appt = await createAppointment({ name: '校验回归-许阿姨' });
    const q = await get(`/api/appointments/by-phone/${CUSTOMER_PHONE}`);
    expect(q.status).toBe(200);
    expect((q.body.data.appointments || []).some((a) => a.id === appt.id)).toBe(true);

    const base = { name: '校验回归-许阿姨', phone: CUSTOMER_PHONE, date: today(), slot: '上午 9:00-12:00' };
    expect((await post('/api/appointments', { ...base, name: '' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, phone: '123' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, date: '2020-01-01' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, slot: '凌晨' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, productIds: ['no-such-id'] })).status).toBe(404);
  });
});

test.describe('方案补图 · /api/scenes 接受 compositionUrl / roomUrl', () => {
  const PHONE = '13800138000';
  const COMP = `http://127.0.0.1:9000/yxjia-uploads/compositions/comp-test-${Date.now()}.jpg`;
  const ROOM = `http://127.0.0.1:9000/yxjia-uploads/rooms/room-test-${Date.now()}.jpg`;

  test('带试摆图/房间图能存下并按手机号读回', async () => {
    const r = await post('/api/scenes', {
      name: '带图的方案', phone: PHONE,
      items: [{ productId: 'sofa-2', color: 'ivory', compositionUrl: COMP, roomUrl: ROOM }],
    });
    expect(r.status).toBe(200);
    expect(r.body.data.scene.items[0].compositionUrl).toBe(COMP);
    expect(r.body.data.scene.items[0].roomUrl).toBe(ROOM);

    const q = await get(`/api/scenes/by-phone/${PHONE}`);
    const hit = (q.body.data.scenes || []).find((s) => s.id === r.body.data.scene.id);
    expect(hit.items[0].compositionUrl).toBe(COMP);
    expect(hit.items[0].roomUrl).toBe(ROOM);
  });

  test('非字符串 / 超长 / 非 http 的图片字段被忽略且不打断保存', async () => {
    const long = 'http://127.0.0.1:9000/' + 'x'.repeat(1001);
    const r = await post('/api/scenes', {
      name: '脏数据方案', phone: PHONE,
      items: [{
        productId: 'sofa-2',
        compositionUrl: 12345,
        roomUrl: long,
      }],
    });
    expect(r.status, '坏图片 URL 不应让保存失败').toBe(200);
    expect(r.body.data.scene.items[0].compositionUrl).toBeNull();
    expect(r.body.data.scene.items[0].roomUrl).toBeNull();

    const bad = await post('/api/scenes', {
      phone: PHONE,
      items: [{ productId: 'sofa-2', roomUrl: 'javascript:alert(1)' }],
    });
    expect(bad.status).toBe(200);
    expect(bad.body.data.scene.items[0].roomUrl).toBeNull();
  });

  test('老式请求（不带图片字段）照旧成功，向后兼容', async () => {
    const r = await post('/api/scenes', {
      name: '老式方案', phone: PHONE,
      items: [{ productId: 'sofa-2', color: 'ivory', materialId: 'fabric' }],
    });
    expect(r.status).toBe(200);
    expect(r.body.data.scene.items[0].compositionUrl).toBeNull();
    expect(r.body.data.scene.items[0].roomUrl).toBeNull();
    expect(r.body.data.scene.items[0].productName).toBeTruthy();

    expect((await post('/api/scenes', { phone: PHONE, items: [] })).status).toBe(400);
    expect((await post('/api/scenes', { phone: PHONE, items: [{ productId: 'nope' }] })).status).toBe(404);
  });
});

test.describe('后台页面 · /admin/appointments', () => {
  test('未登录直接被送到登录页', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(`${BASE_URL}/admin/appointments`);
    await p.waitForURL('**/admin/login', { timeout: 8000 });
    expect(p.url()).toContain('/admin/login');
    await ctx.close();
  });

  test('登录后渲染预约卡：tel: 一键拨号 + 点状态按钮界面即更新 + 无页面报错', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    // page.request 与 page 共用 cookie，登录态会带到页面请求上
    const login = await page.request.post(`${BASE_URL}/api/admin/login`, { data: ADMIN });
    expect(login.status()).toBe(200);

    const uniqueName = `页面测试-${Date.now() % 100000}`;
    const created = await createAppointment({ name: uniqueName, phone: '13300111000', note: '客厅 3 米 6' });

    await page.goto(`${BASE_URL}/admin/appointments`);
    const card = page.locator('.appt', { hasText: uniqueName });
    await expect(card).toBeVisible({ timeout: 8000 });

    // 手机号完整显示 + tel: 一键拨号（老板第一动作就是打电话）
    await expect(card.locator('.phone')).toHaveText('13300111000');
    const tel = card.locator('a[href^="tel:"]').first();
    await expect(tel).toBeVisible();
    expect(await tel.getAttribute('href')).toContain('13300111000');
    const box = await tel.boundingBox();
    expect(box.height, '拨号按钮命中区要够大').toBeGreaterThanOrEqual(48);

    // 日期分组 + 想看的家具
    await expect(card).toContainText('轻奢 L 形转角沙发');
    await expect(card).toContainText('备注：客厅 3 米 6');
    await expect(card).toContainText(`预约号 ${created.id}`);
    await expect(page.locator('.group-head').first()).toContainText('上午');

    // 点「已成单」→ PATCH 成功 → DOM 刷新
    await card.locator('.sbtn', { hasText: '已成单' }).click();
    await expect(card).toHaveAttribute('data-status', '已成单', { timeout: 8000 });
    await expect(card.locator('.status')).toHaveText('已成单');
    await expect(card.locator('.sbtn.on')).toHaveText('已成单');

    // 状态筛选：切到「已成单」仍能看到这条
    await page.locator('.fbtn', { hasText: '已成单' }).first().click();
    await expect(page.locator('.appt', { hasText: uniqueName })).toBeVisible({ timeout: 8000 });

    expect(errors, `页面报错：${errors.join(' | ')}`).toEqual([]);
  });
});
