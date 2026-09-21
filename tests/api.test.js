import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { Runner } from '@openai/agents';
import { ScriptedModel, assistantMessage, functionCall } from '@openai/agents/testing';
import {
  listOnSaleProducts,
  searchProducts,
  getStoreInfo,
  createShoppingGuideAgent,
  runShoppingGuideChat,
  streamShoppingGuideChat,
} from '../src/chat-guide-agent.js';

const BASE_URL = 'http://127.0.0.1:3000';
const DATA_DIR = path.join(process.cwd(), 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

const REQUIRED_PRODUCT_IDS = ['sofa-1', 'sofa-2', 'sofa-3', 'cabinet-1', 'bed-1', 'table-1'];

function makeRequest(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test.afterAll(() => {
  // 跑完测试后清空 orders.json
  fs.writeFileSync(ORDERS_FILE, JSON.stringify({ orders: [] }, null, 2), 'utf-8');
});

test.describe('Server - Basic endpoints (port 3000)', () => {
  test('GET / serves the index HTML page', async () => {
    const res = await makeRequest('GET', '/');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('银杏家具');
  });

  test('GET / serves on port 3000', async () => {
    const res = await makeRequest('GET', '/');
    expect(res.status).toBe(200);
  });

  test('GET /product.html serves the product page', async () => {
    const res = await makeRequest('GET', '/product.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /checkout.html serves the checkout page', async () => {
    const res = await makeRequest('GET', '/checkout.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /order.html serves the order page', async () => {
    const res = await makeRequest('GET', '/order.html');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });
});

test.describe('Product detail route /product/:id', () => {
  test('GET /product/sofa-1 returns HTML page', async () => {
    const res = await makeRequest('GET', '/product/sofa-1');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('银杏家具');
  });

  test('GET /product/bed-1 returns HTML page', async () => {
    const res = await makeRequest('GET', '/product/bed-1');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
  });

  test('GET /product/non-existent still serves page (page loads, content via JS)', async () => {
    const res = await makeRequest('GET', '/product/non-existent-id');
    expect(res.status).toBe(200);
  });
});

test.describe('Products API', () => {
  test('GET /api/products returns products in ApiResponse shape', async () => {
    const res = await makeRequest('GET', '/api/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('products');
    expect(Array.isArray(res.body.data.products)).toBe(true);
  });

  test('Products include exactly the six required types', async () => {
    const res = await makeRequest('GET', '/api/products');
    const ids = res.body.data.products.map(p => p.id);
    for (const id of REQUIRED_PRODUCT_IDS) {
      expect(ids).toContain(id);
    }
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(6);
  });

  test('Products include sofa-1, sofa-2, sofa-3 (three sofas)', async () => {
    const res = await makeRequest('GET', '/api/products');
    const sofas = res.body.data.products.filter(p => p.id.startsWith('sofa-'));
    expect(sofas.length).toBe(3);
  });

  test('Products include table-1 (dining table), no wardrobe', async () => {
    const res = await makeRequest('GET', '/api/products');
    const ids = res.body.data.products.map(p => p.id);
    expect(ids).toContain('table-1');
    expect(ids).not.toContain('wardrobe');
  });

  test('Each product has required fields', async () => {
    const res = await makeRequest('GET', '/api/products');
    const product = res.body.data.products[0];
    expect(product).toHaveProperty('id');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('price');
    expect(product).toHaveProperty('size');
  });

  test('Price fields use ¥-band format (¥Xxxx 起)', async () => {
    const res = await makeRequest('GET', '/api/products');
    const hasBand = res.body.data.products.some(p =>
      typeof p.price === 'string' && /^¥\d+xxx/.test(p.price)
    );
    expect(hasBand).toBe(true);
  });

  test('GET /api/products/sofa-1 returns single product', async () => {
    const res = await makeRequest('GET', '/api/products/sofa-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.product.id).toBe('sofa-1');
  });

  test('GET /api/products/:id returns 404 for unknown product', async () => {
    const res = await makeRequest('GET', '/api/products/wardrobe-xyz');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('Products data file exists and is valid JSON', async () => {
    expect(fs.existsSync(PRODUCTS_FILE)).toBe(true);
    const data = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    expect(data).toHaveProperty('products');
  });
});

test.describe('Orders API', () => {
  test('GET /api/orders requires admin → 匿名 401（防全量订单泄露）', async () => {
    // 修复：/api/orders 是后台全量列表，加 requireAdmin；匿名或 /api/orders/ 尾斜杠一律 401
    const res = await makeRequest('GET', '/api/orders');
    expect(res.status).toBe(401);
  });

  test('POST /api/orders creates a new order', async () => {
    const newOrder = {
      name: '张三',
      phone: '13800138000',
      productId: 'sofa-1',
      address: '来店自提',
      spec: '3.4米·米灰',
      quantity: 1
    };
    const res = await makeRequest('POST', '/api/orders', newOrder);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const order = res.body.data.order;
    expect(order.name).toBe('张三');
    expect(order.phone).toBe('13800138000');
    expect(order.productId).toBe('sofa-1');
    expect(order.address).toBe('来店自提');
    expect(order).toHaveProperty('id');
    expect(order).toHaveProperty('status');
    expect(order).toHaveProperty('createdAt');
  });

  test('POST /api/orders requires name', async () => {
    const res = await makeRequest('POST', '/api/orders', { phone: '13800138000', productId: 'sofa-1' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders requires phone', async () => {
    const res = await makeRequest('POST', '/api/orders', { name: '李四', productId: 'sofa-1' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders requires productId', async () => {
    const res = await makeRequest('POST', '/api/orders', { name: '王五', phone: '13800138000' });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders validates phone format (11 digits, 1[3-9] prefix)', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '测试', phone: 'invalid', productId: 'sofa-1'
    });
    expect(res.status).toBe(400);
  });

  test('POST /api/orders validates product exists', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '测试', phone: '13800138000', productId: 'unknown-xyz'
    });
    expect(res.status).toBe(404);
  });

  test('GET /api/orders/:phone filters by phone number', async () => {
    const phone = '13900139001';
    await makeRequest('POST', '/api/orders', {
      name: '按手机查', phone, productId: 'sofa-2'
    });
    await makeRequest('POST', '/api/orders', {
      name: '其他', phone: '13700137000', productId: 'bed-1'
    });
    const res = await makeRequest('GET', `/api/orders/${phone}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.orders.length).toBeGreaterThan(0);
    res.body.data.orders.forEach(o => expect(o.phone).toBe(phone));
  });

  test('GET /api/orders/:phone returns empty list for unknown phone', async () => {
    const res = await makeRequest('GET', '/api/orders/10000000000');
    expect(res.status).toBe(200);
    expect(res.body.data.orders).toEqual([]);
  });

  test('Order persists to orders.json file', async () => {
    const beforeData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    const beforeCount = beforeData.orders ? beforeData.orders.length : 0;
    const create = await makeRequest('POST', '/api/orders', {
      name: '持久化测试', phone: '13700137002', productId: 'cabinet-1'
    });
    const afterData = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    expect(afterData.orders.length).toBe(beforeCount + 1);
    const found = afterData.orders.find(o => o.id === create.body.data.order.id);
    expect(found).toBeDefined();
  });

  test('Empty POST body returns 400', async () => {
    const res = await makeRequest('POST', '/api/orders', {});
    expect(res.status).toBe(400);
  });

  test('Invalid JSON returns 400', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        method: 'POST',
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/orders',
        headers: { 'Content-Type': 'application/json' }
      }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => resolve({ status: response.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write('{invalid');
      req.end();
    });
    expect(res.status).toBe(400);
  });

  test('Phone accepts 13359140982 (store phone)', async () => {
    const res = await makeRequest('POST', '/api/orders', {
      name: '店主自测', phone: '13359140982', productId: 'sofa-1'
    });
    expect(res.status).toBe(200);
    expect(res.body.data.order.phone).toBe('13359140982');
  });
});

test.describe('TryOn (AI composition) API', () => {
  test('POST /api/tryon returns simulated composition', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'sofa-1',
      roomPhoto: 'data:image/jpeg;base64,fake'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('compositionUrl');
    expect(typeof res.body.data.compositionUrl).toBe('string');
    expect(res.body.data).toHaveProperty('product');
    expect(res.body.data).toHaveProperty('message');
  });

  test('POST /api/tryon requires productId', async () => {
    const res = await makeRequest('POST', '/api/tryon', { roomPhoto: 'data:fake' });
    expect(res.status).toBe(400);
  });

  test('POST /api/tryon validates product exists', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'unknown-product-xyz', roomPhoto: 'data:fake'
    });
    expect(res.status).toBe(404);
  });

  test('POST /api/tryon compositionUrl points to static image', async () => {
    const res = await makeRequest('POST', '/api/tryon', {
      productId: 'sofa-2', roomPhoto: 'data:fake'
    });
    expect(res.body.data.compositionUrl).toMatch(/^\/images\//);
  });
});

test.describe('Whole-home history API (我的家)', () => {
  const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  let usersBackup = null;

  // 带 Cookie 的请求（登录态），返回 { status, body, setCookie }
  function requestCookie(method, urlPath, { body = null, cookie = '' } = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, BASE_URL);
      const headers = { 'Content-Type': 'application/json' };
      if (cookie) headers.Cookie = cookie;
      const req = http.request({
        method, hostname: url.hostname, port: url.port,
        path: url.pathname + url.search, headers,
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch (e) { parsed = data; }
          resolve({ status: res.statusCode, body: parsed, setCookie: res.headers['set-cookie'] || [] });
        });
      });
      req.on('error', reject);
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async function loginCookie(phone) {
    const res = await requestCookie('POST', '/api/auth/login', { body: { phone, code: '123456' } });
    return (res.setCookie[0] || '').split(';')[0];
  }

  // 登录会在 users.json 自动注册测试号，跑完还原，避免污染
  test.beforeEach(() => {
    usersBackup = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf-8') : null;
  });
  test.afterEach(() => {
    if (usersBackup !== null) fs.writeFileSync(USERS_FILE, usersBackup, 'utf-8');
  });

  test('GET /api/whole-home/history rejects invalid phone → 400', async () => {
    const res = await makeRequest('GET', '/api/whole-home/history?phone=invalid');
    expect(res.status).toBe(400);
  });

  test('logged-in querying another phone → 403（只能看自己）', async () => {
    const cookie = await loginCookie('13800138000');
    const res = await requestCookie('GET', '/api/whole-home/history?phone=13911112222', { cookie });
    expect(res.status).toBe(403);
  });

  test('logged-in own phone, no analyses → 200 + empty array', async () => {
    const phone = '13800138000';
    const cookie = await loginCookie(phone);
    const res = await requestCookie('GET', `/api/whole-home/history?phone=${phone}`, { cookie });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.analyses)).toBe(true);
  });

  test('logged-in own phone, seeded analysis → 200 + 照片+推荐 shape', async () => {
    const phone = '13800138000';
    const uploadsBackup = fs.existsSync(UPLOADS_FILE) ? fs.readFileSync(UPLOADS_FILE, 'utf-8') : null;
    try {
      const container = uploadsBackup ? JSON.parse(uploadsBackup) : { uploads: [], wholeHomeAnalyzes: [] };
      if (!Array.isArray(container.wholeHomeAnalyzes)) container.wholeHomeAnalyzes = [];
      const seedId = 'whan-test-' + Date.now();
      container.wholeHomeAnalyzes.unshift({
        id: seedId,
        type: 'whole-home-analyze',
        phone,
        userStyle: '', style: '现代简约', overallStyle: '现代简约',
        budgetSuggestion: '¥1万 - ¥6万',
        rooms: [{ roomType: '客厅', sizeEstimate: '约20㎡', lightingDirection: '南', mainColor: '米白', suggestedItems: ['沙发', '茶几'], originalUrl: 'http://127.0.0.1:9000/yxjia-uploads/rooms/test.jpg', index: 1 }],
        roomImageUrls: ['http://127.0.0.1:9000/yxjia-uploads/rooms/test.jpg'],
        ip: '127.0.0.1', uploadedBy: 'user:' + phone,
        createdAt: new Date().toISOString(),
      });
      fs.writeFileSync(UPLOADS_FILE, JSON.stringify(container, null, 2), 'utf-8');

      const cookie = await loginCookie(phone);
      const res = await requestCookie('GET', `/api/whole-home/history?phone=${phone}`, { cookie });
      expect(res.status).toBe(200);
      const list = res.body.data.analyses;
      expect(Array.isArray(list)).toBe(true);
      const hit = list.find(a => a.id === seedId);
      expect(hit).toBeTruthy();
      expect(Array.isArray(hit.roomImageUrls)).toBe(true);
      expect(hit.roomImageUrls.length).toBeGreaterThan(0);
      expect(hit.overallStyle).toBe('现代简约');
      expect(hit.budgetSuggestion).toBe('¥1万 - ¥6万');
      expect(Array.isArray(hit.rooms)).toBe(true);
      expect(hit.rooms[0].suggestedItems).toContain('沙发');
    } finally {
      if (uploadsBackup !== null) fs.writeFileSync(UPLOADS_FILE, uploadsBackup, 'utf-8');
    }
  });
});

test.describe('Static assets', () => {
  test('GET /images/ returns directory or 404 cleanly (no server crash)', async () => {
    const res = await makeRequest('GET', '/images/');
    expect([200, 301, 403, 404]).toContain(res.status);
  });

  test('GET /images path is supported (static middleware)', async () => {
    const res = await makeRequest('GET', '/images/non-existent.jpg');
    expect([200, 404]).toContain(res.status);
  });
});

test.describe('AI chat shopping guide', () => {
  test('GET /chat-guide serves chat UI with ynet stream markdown', async () => {
    const res = await makeRequest('GET', '/chat-guide');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('导购');
    expect(res.body).toContain('chatInput');
    expect(res.body).toContain('sendBtn');
    expect(res.body).toContain('/api/chat/guide/stream');
    expect(res.body).toContain('/vendor/ynet-markdown-render-h5/index.js');
    expect(res.body).toContain('MarkdownNative');
    expect(res.body).toContain('MarkdownRenderView');
    expect(res.body).toContain('parseStream');
    expect(res.body).toContain('parseMarkdown');
    expect(res.body).toContain('#3a2818');
    expect(res.body).toContain('#faf6ef');
  });

  test('GET ynet markdown vendor ESM is served', async () => {
    const res = await makeRequest('GET', '/vendor/ynet-markdown-render-h5/index.js');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('string');
    expect(res.body).toContain('MarkdownNative');
    expect(res.body).toContain('./parser.js');
  });

  test('Homepage links to /chat-guide', async () => {
    const res = await makeRequest('GET', '/');
    expect(res.status).toBe(200);
    expect(res.body).toContain('/chat-guide');
    expect(res.body).toContain('AI 导购');
  });

  test('Catalog tools read live on-sale products.json', async () => {
    const disk = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    const diskOnSale = (disk.products || []).filter((p) => !p.status || p.status === '在售');
    const listed = listOnSaleProducts();

    expect(listed.length).toBe(diskOnSale.length);
    expect(listed.length).toBeGreaterThan(0);

    for (const p of listed) {
      const raw = diskOnSale.find((x) => x.id === p.id);
      expect(raw).toBeDefined();
      expect(p.name).toBe(raw.name);
      expect(p.price).toBe(raw.price);
      expect(p.status).toBe('在售');
    }

    const sofaHits = searchProducts({ query: '沙发' });
    expect(sofaHits.length).toBeGreaterThan(0);
    expect(sofaHits.every((p) => listed.some((x) => x.id === p.id))).toBe(true);

    const store = getStoreInfo();
    expect(store.phone).toBe(disk.store.phone);
    expect(store.address).toContain('柞水');
    expect(store.hours).toBeTruthy();
  });

  test('Agents SDK run with ScriptedModel executes catalog tool', async () => {
    const onSale = listOnSaleProducts();
    expect(onSale.length).toBeGreaterThan(0);
    const sample = onSale[0];

    const md = [
      '## 推荐',
      '',
      `| 商品 | 价格 | 编号 |`,
      `| --- | --- | --- |`,
      `| ${sample.name} | ${sample.price} | ${sample.id} |`,
    ].join('\n');

    const model = new ScriptedModel([
      [functionCall('list_on_sale_products', {}, { callId: 'call_guide_1' })],
      [assistantMessage(md)],
    ]);

    const agent = createShoppingGuideAgent({ model });
    const runner = new Runner({ tracingDisabled: true });
    const result = await runner.run(agent, '有什么沙发推荐？多少钱？');

    expect(typeof result.finalOutput).toBe('string');
    expect(result.finalOutput).toContain(sample.name);
    expect(result.finalOutput).toContain(sample.price);
    expect(result.finalOutput).toContain(sample.id);
    expect(result.finalOutput).toContain('##');
    expect(model.calls.length).toBe(2);

    const secondInput = model.lastCall?.request?.input;
    expect(Array.isArray(secondInput)).toBe(true);
    const toolResult = secondInput.find((item) => item.type === 'function_call_result');
    expect(toolResult).toBeDefined();
    const payload = JSON.stringify(toolResult);
    expect(payload).toContain(sample.id);
    expect(payload).toContain(sample.name);
    expect(payload).toContain(sample.price);
    model.assertComplete();
  });

  test('runShoppingGuideChat returns markdown reply via injectable model', async () => {
    const onSale = listOnSaleProducts();
    const sample = onSale[0];
    const model = new ScriptedModel([
      [functionCall('search_products', { query: '沙发' }, { callId: 'call_search_1' })],
      [
        assistantMessage(
          `## 推荐\n\n- **${sample.name}**：${sample.price}`
        ),
      ],
    ]);

    const out = await runShoppingGuideChat({
      message: '推荐一款沙发',
      history: [{ role: 'user', content: '你好' }, { role: 'assistant', content: '您好，请问想看什么？' }],
      model,
    });

    expect(out.reply).toBeTruthy();
    expect(out.reply.length).toBeGreaterThan(0);
    expect(out.reply).toContain(sample.name);
    expect(out.reply).toContain(sample.price);
    expect(out.reply).toContain('##');
  });

  test('streamShoppingGuideChat yields markdown deltas via injectable model', async () => {
    const onSale = listOnSaleProducts();
    const sample = onSale[0];
    const model = new ScriptedModel([
      [functionCall('list_on_sale_products', {}, { callId: 'call_stream_1' })],
      [
        assistantMessage(
          `## 在售\n\n| 商品 | 价格 |\n| --- | --- |\n| ${sample.name} | ${sample.price} |`
        ),
      ],
    ]);

    let assembled = '';
    let doneReply = '';
    for await (const ev of streamShoppingGuideChat({
      message: '有什么沙发？',
      model,
    })) {
      if (ev.type === 'delta') assembled += ev.text;
      if (ev.type === 'done') doneReply = ev.reply;
    }

    expect(doneReply).toContain(sample.name);
    expect(doneReply).toContain('|');
    expect(doneReply).toContain('##');
    expect(assembled.length + doneReply.length).toBeGreaterThan(0);
  });

  test('POST /api/chat/guide rejects empty message', async () => {
    const res = await makeRequest('POST', '/api/chat/guide', { message: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  test('POST /api/chat/guide rejects oversized message', async () => {
    const res = await makeRequest('POST', '/api/chat/guide', {
      message: '沙发'.repeat(300),
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(String(res.body.error)).toMatch(/太长|缩短/);
  });

  test('POST /api/chat/guide returns ApiResponse (live key, fake provider, or clear missing-key)', async () => {
    const res = await makeRequest('POST', '/api/chat/guide', {
      message: '有什么沙发推荐？大概什么价格？',
      history: [],
    });

    expect(res.body).toBeTruthy();
    expect(typeof res.body.success).toBe('boolean');

    if (res.body.success) {
      expect(res.status).toBe(200);
      expect(res.body.data).toBeTruthy();
      expect(typeof res.body.data.reply).toBe('string');
      expect(res.body.data.reply.trim().length).toBeGreaterThan(0);
      expect(res.body.data.reply).toMatch(/##|\||-/);
    } else {
      // 无 OPENAI_API_KEY 且未开 CHAT_GUIDE_FAKE_MODEL 时允许明确失败
      expect([503, 500]).toContain(res.status);
      expect(String(res.body.error || '')).toMatch(/OPENAI_API_KEY|导购/);
    }
  });

  test('GET /api/chat/guide/status reports provider readiness', async () => {
    const res = await makeRequest('GET', '/api/chat/guide/status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
    expect(typeof res.body.data.live).toBe('boolean');
    expect(res.body.data.model).toBeTruthy();
  });

  test('POST /api/chat/guide/stream returns SSE markdown events when model available', async () => {
    const raw = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        message: '有什么沙发推荐？大概多少钱？请根据店里在售商品回答。',
        history: [],
      });
      const req = http.request(
        {
          method: 'POST',
          hostname: '127.0.0.1',
          port: 3000,
          path: '/api/chat/guide/stream',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              contentType: res.headers['content-type'] || '',
              body: data,
            })
          );
        }
      );
      req.setTimeout(100000);
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (raw.contentType.includes('text/event-stream')) {
      expect(raw.status).toBe(200);
      expect(raw.body).toContain('data:');
      expect(raw.body).toMatch(/"type":"status"/);
      expect(raw.body).toMatch(/"type":"(delta|done)"/);

      const events = raw.body
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('data:'))
        .map((l) => {
          try {
            return JSON.parse(l.replace(/^data:\s*/, ''));
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const statusEv = events.find((e) => e.type === 'status');
      expect(statusEv).toBeTruthy();
      expect(statusEv.streaming).toBe(true);

      const deltas = events.filter((e) => e.type === 'delta');
      const doneEv = events.find((e) => e.type === 'done');
      expect(doneEv).toBeTruthy();
      expect(doneEv.reply).toBeTruthy();
      expect(doneEv.reply.trim().length).toBeGreaterThan(0);

      // 真流式：至少 1 个 delta；假模型也可能整段一条 delta
      expect(deltas.length).toBeGreaterThanOrEqual(1);

      const onSale = listOnSaleProducts();
      // 真模型应通过工具接地；允许名称或价格命中
      const grounded = onSale.some(
        (p) => doneEv.reply.includes(p.name) || doneEv.reply.includes(p.price)
      );
      expect(grounded).toBe(true);
    } else {
      // JSON error path when no model configured on the running server
      const parsed = JSON.parse(raw.body);
      expect(parsed.success).toBe(false);
      expect([400, 429, 503, 500]).toContain(raw.status);
    }
  });
});