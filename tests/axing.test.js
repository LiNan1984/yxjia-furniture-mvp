// 阿杏 AI 家居助手（/axing）验收测试
// 自带服务器（独立端口 3100，不碰 3000 上的实例），覆盖：
// 新页面路由、/api/appointments、/api/scenes、单页壳各 view 挂载、three.js 舞台
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APPOINTMENTS_FILE = path.join(process.cwd(), 'data', 'appointments.json');
const SCENES_FILE = path.join(process.cwd(), 'data', 'scenes.json');

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

function post(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body || {}));
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function waitServerReady(timeoutMs = 15000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await get('/api/products');
      if (r.status === 200) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('阿杏测试服务器启动超时');
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

test.describe('阿杏 · 页面与静态资源', () => {
  test('GET /axing 返回单页壳（含阿杏人设 + importmap + view 容器）', async () => {
    const res = await get('/axing');
    expect(res.status).toBe(200);
    const html = res.body;
    expect(html).toContain('阿杏');
    expect(html).toContain('type="importmap"');
    for (const id of ['view-home', 'view-voice', 'view-upload', 'view-products', 'view-tryon', 'view-3d', 'view-material', 'view-booking', 'view-plans', 'view-me']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test('three.js vendor 资源可访问', async () => {
    for (const p of ['/vendor/three/three.module.js', '/vendor/three/three.core.js', '/vendor/three/addons/controls/OrbitControls.js', '/axing/js/app.js', '/axing/css/axing.css']) {
      const res = await get(p);
      expect(res.status, p).toBe(200);
    }
  });
});

test.describe('阿杏 · /api/appointments', () => {
  test('创建预约成功并可按手机号查询', async () => {
    const res = await post('/api/appointments', {
      name: '王阿姨', phone: '13800138000', date: today(), slot: '上午 9:00-12:00',
      productIds: ['sofa-2'], note: '想看看转角沙发',
    });
    expect(res.status).toBe(200);
    const { appointment } = res.body.data;
    expect(appointment.id).toMatch(/^A/);
    expect(appointment.productNames.length).toBe(1);

    const q = await get('/api/appointments/by-phone/13800138000');
    expect(q.status).toBe(200);
    expect(q.body.data.appointments.some((a) => a.id === appointment.id)).toBe(true);
  });

  test('参数校验：称呼/手机号/日期/时段/商品', async () => {
    const base = { name: '王阿姨', phone: '13800138000', date: today(), slot: '上午 9:00-12:00' };
    expect((await post('/api/appointments', { ...base, name: '' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, phone: '123' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, date: '2020-01-01' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, slot: '凌晨' })).status).toBe(400);
    expect((await post('/api/appointments', { ...base, productIds: ['no-such-id'] })).status).toBe(404);
  });
});

test.describe('阿杏 · /api/scenes', () => {
  test('保存方案成功并可按手机号查询', async () => {
    const res = await post('/api/scenes', {
      name: '奶油风客厅', phone: '13800138000',
      items: [{ productId: 'sofa-2', color: 'ivory', materialId: 'fabric', dims: { width: 3.2, depth: 1.8, height: 0.85 } }],
    });
    expect(res.status).toBe(200);
    const { scene } = res.body.data;
    expect(scene.items[0].productName).toBeTruthy();

    const q = await get('/api/scenes/by-phone/13800138000');
    expect(q.status).toBe(200);
    expect(q.body.data.scenes.some((s) => s.id === scene.id)).toBe(true);
  });

  test('参数校验：空方案 / 不存在的商品', async () => {
    expect((await post('/api/scenes', { phone: '13800138000', items: [] })).status).toBe(400);
    expect((await post('/api/scenes', { phone: '13800138000', items: [{ productId: 'nope' }] })).status).toBe(404);
  });
});

test.describe('阿杏 · 单页壳浏览器冒烟', () => {
  test('各 view 可挂载、three.js 舞台可创建、无页面报错', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE_URL}/axing`, { waitUntil: 'networkidle' });

    // 首页：阿杏问候 + 人设文案
    await expect(page.locator('#view-home')).toContainText('阿杏', { timeout: 8000 });
    await expect(page.locator('#view-home')).toContainText('提前把家具搬进你家的 AI 助手', { timeout: 8000 });

    const views = ['view-products', 'view-upload', 'view-tryon', 'view-voice', 'view-3d', 'view-material', 'view-booking', 'view-plans', 'view-me'];
    for (const v of views) {
      await page.evaluate((id) => window.AXING.go(id), v);
      await page.waitForTimeout(700);
      const nonEmpty = await page.evaluate((id) => {
        const el = document.getElementById(id);
        return el && el.children.length > 0;
      }, v);
      expect(nonEmpty, `${v} 应渲染出内容`).toBe(true);
    }

    // 商品列表应出真实商品卡
    await page.evaluate(() => window.AXING.go('view-products'));
    await expect(page.locator('#view-products .p-card').first()).toBeVisible({ timeout: 8000 });

    // 3D：WebGL 可用则出 canvas，否则图片兜底文案
    await page.evaluate(() => window.AXING.go('view-3d'));
    await page.waitForTimeout(1500);
    const stage3d = await page.evaluate(() => {
      const stage = document.querySelector('#view-3d .stage');
      const canvas = stage && stage.querySelector('canvas');
      return { hasCanvas: Boolean(canvas), w: canvas ? canvas.width : 0, text: stage ? stage.textContent : '' };
    });
    expect(stage3d.hasCanvas || /看不了|到店/.test(stage3d.text)).toBe(true);
    if (stage3d.hasCanvas) expect(stage3d.w).toBeGreaterThan(0);

    expect(errors, `页面报错：${errors.join(' | ')}`).toEqual([]);
  });
});
