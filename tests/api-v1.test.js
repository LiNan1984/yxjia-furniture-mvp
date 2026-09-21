// v1 迭代测试：商品文案/卖点自动生成（spec: team/spec/spec-v1.md）
//
// 设计要点：
// 1. 完全自包含：本文件自己起两个进程——
//    - 本地 mock STEP server（端口 3199），可编程返回固定 JSON，绝不打真 AI API、不花 token
//    - 独立的 yxjia server 实例（端口 3100），环境变量 STEP_BASE_URL 指向 mock、
//      STEP_API_KEY 用假 key（dotenv 不覆盖已存在的环境变量，所以 spawn env 优先于 .env）
// 2. 数据污染防护：beforeAll 备份 data/products.json 与 uploads/products/ 目录快照，
//    afterAll 全部还原。
// 3. 断言依据 spec-v1「给测试角色的交接」+「验收标准」。

import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const QA_PORT = 3100;
const MOCK_PORT = 3199;
const BASE_URL = `http://127.0.0.1:${QA_PORT}`;
const REPO = process.cwd();
const DATA_DIR = path.join(REPO, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const UPLOAD_PRODUCTS_DIR = path.join(REPO, 'uploads', 'products');
const SOURCE_IMAGE = path.join(UPLOAD_PRODUCTS_DIR, '2d484ab70cf1785a.jpg'); // 已存在的真实商品图

// ---------- mock STEP server（可编程） ----------

// 测试往 mockAI.content 里塞 AI 应答文本；mockAI.hit 记录是否被调用过
const mockAI = { content: null, hit: false, lastBody: null };

function startMockServer() {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        mockAI.hit = true;
        mockAI.lastBody = raw;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-qa-mock',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: mockAI.content ?? '{}' },
            finish_reason: 'stop',
          }],
        }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'mock: not found' }));
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

// ---------- HTTP 小工具 ----------

function request(port, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, `http://127.0.0.1:${port}`);
    const req = http.request(
      {
        method,
        hostname: '127.0.0.1',
        port,
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf-8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { /* 非 JSON（HTML 等） */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function multipartBody(fields, fileField, filename, fileBuffer, mime) {
  const boundary = '----yxjiaqaboundary' + Math.random().toString(16).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
    ));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  };
}

async function loginAdmin() {
  const res = await request(QA_PORT, 'POST', '/api/admin/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '123456' }),
  });
  expect(res.status, 'admin 登录应成功（admin/123456）').toBe(200);
  const setCookie = res.headers['set-cookie'] || [];
  const sid = setCookie.find((c) => c.startsWith('yxjia_sid='));
  expect(sid, '登录应下发 yxjia_sid cookie').toBeTruthy();
  return sid.split(';')[0];
}

// 上传一张图走识别链路，返回响应
async function uploadAndIdentify(cookie, mockContent, hint = '') {
  mockAI.content = mockContent;
  mockAI.hit = false;
  const img = fs.readFileSync(SOURCE_IMAGE);
  const mp = multipartBody({ hint }, 'file', 'qa-furniture.jpg', img, 'image/jpeg');
  return request(QA_PORT, 'POST', '/api/admin/upload-and-identify', {
    headers: {
      'Content-Type': mp.contentType,
      'Content-Length': mp.body.length,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: mp.body,
  });
}

// ---------- mock 应答素材 ----------

const FULL_MOCK = {
  name: '浅灰色弧形科技布沙发',
  price: '¥2999起',
  category: 'sofa',
  subtitle: '科技布高弹海绵填充',
  color: '#9aa0a6',
  emoji: '🛋️',
  sellingPoints: [
    '科技布不怕小孩画，湿布一擦就净',
    '坐深 60 厘米，老人起身不费劲',
    '弧形扶手不磕碰',
  ],
  suitableFor: '适合客厅开间 3.5 米以上的家庭',
  placementTip: '靠墙摆，沙发前留 60 厘米过道好走路',
  size: '约 2.6 米宽 × 1.0 米深',
};

const HONEST_MOCK = {
  ...FULL_MOCK,
  price: '¥Xxxx起',            // 占位符样式价格（编造）
  size: '2.62 米宽 × 0.98 米深', // 无"约"字的编造精确尺寸
};

// ---------- 全局 setup / teardown ----------

let mockServer;
let serverProc;
let originalProductsText;
let uploadDirSnapshot;

test.beforeAll(async () => {
  // 备份
  originalProductsText = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
  uploadDirSnapshot = fs.existsSync(UPLOAD_PRODUCTS_DIR)
    ? new Set(fs.readdirSync(UPLOAD_PRODUCTS_DIR))
    : new Set();

  mockServer = await startMockServer();

  serverProc = spawn('node', [path.join(REPO, 'src', 'server.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(QA_PORT),
      STEP_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      STEP_API_KEY: 'qa-mock-key-do-not-call-real-api',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', (d) => process.stderr.write(`[qa:3100] ${d}`));

  // 等服务就绪
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const res = await request(QA_PORT, 'GET', '/api/feature-flags');
      ready = res.status === 200;
    } catch (_) { /* not yet */ }
    if (!ready) await new Promise((r) => setTimeout(r, 300));
  }
  expect(ready, '独立 server(3100) 20 秒内应就绪').toBe(true);
});

test.afterAll(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((resolve) => {
      const t = setTimeout(() => { try { serverProc.kill('SIGKILL'); } catch (_) {} resolve(); }, 3000);
      serverProc.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
  if (mockServer) await new Promise((r) => mockServer.close(r));

  // 还原 products.json
  if (originalProductsText !== null) {
    fs.writeFileSync(PRODUCTS_FILE, originalProductsText, 'utf-8');
  }
  // 清掉测试期间新产生的商品图
  if (fs.existsSync(UPLOAD_PRODUCTS_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_PRODUCTS_DIR)) {
      if (!uploadDirSnapshot.has(f)) {
        try { fs.unlinkSync(path.join(UPLOAD_PRODUCTS_DIR, f)); } catch (_) {}
      }
    }
  }
});

// 直接往 products.json 追加一个测试商品（server 每次请求都重读磁盘文件）
function insertProductDirectly(product) {
  const store = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const list = Array.isArray(store) ? store : store.products;
  list.push(product);
  if (Array.isArray(store)) {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } else {
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify({ ...store, products: list }, null, 2), 'utf-8');
  }
}

// ============================================================================
// A. POST /api/admin/upload-and-identify（mock STEP 链路）
// ============================================================================

test.describe('v1 AI 文案 · upload-and-identify', () => {
  test('A1 mock 完整 JSON → 新字段落库 + highlights 无"AI 识别于" + category 落库', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify(FULL_MOCK));

    expect(res.status).toBe(200);
    expect(mockAI.hit, '识别请求应打本地 mock（STEP_BASE_URL 覆盖生效），不得打真 API').toBe(true);
    expect(res.json.success).toBe(true);
    expect(res.json.data.ok).toBe(true);

    const p = res.json.data.product;
    // 四件套新字段
    expect(Array.isArray(p.sellingPoints)).toBe(true);
    expect(p.sellingPoints.length).toBe(3);
    expect(typeof p.suitableFor).toBe('string');
    expect(p.suitableFor.length).toBeGreaterThan(0);
    expect(typeof p.placementTip).toBe('string');
    expect(p.placementTip.length).toBeGreaterThan(0);
    expect(p.size).toMatch(/约/, '可判断尺寸时必须带"约"字');
    // spec：highlights 改为 sellingPoints 前 3 条，且无机器噪音
    expect(p.highlights).not.toContainEqual(expect.stringMatching(/^AI 识别于/));
    // category 必须落库（现状：识别返回 category 但写入时丢失 → 红）
    expect(p.category).toBe('sofa');

    // 落库断言（products.json 磁盘上也有）
    const store = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    const onDisk = (store.products || store).find((x) => x.id === p.id);
    expect(onDisk).toBeDefined();
    expect(onDisk.category).toBe('sofa');
    expect(onDisk.sellingPoints.length).toBe(3);
    expect(onDisk.highlights).not.toContainEqual(expect.stringMatching(/^AI 识别于/));
  });

  test('A2 诚实性·价格：mock 编造 "¥Xxxx起" → 后端替换为 "到店询价"', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify(HONEST_MOCK));
    expect(res.status).toBe(200);
    const p = res.json.data.product;
    expect(p.price).toBe('到店询价');
    expect(JSON.stringify(p)).not.toContain('Xxxx');
  });

  test('A3 诚实性·尺寸：mock 返回无"约"字的编造尺寸 → 后端替换为 "可到店量尺"', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify(HONEST_MOCK));
    expect(res.status).toBe(200);
    const p = res.json.data.product;
    expect(p.size).toBe('可到店量尺');
  });

  test('A4 描述诚实性：description 不含"AI 识别/AI 生成"字样', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify(FULL_MOCK));
    expect(res.status).toBe(200);
    const p = res.json.data.product;
    expect(typeof p.description).toBe('string');
    expect(p.description).not.toContain('AI 识别');
    expect(p.description).not.toContain('AI 生成');
    expect(p.description.length).toBeGreaterThan(0);
  });

  test('A5 健壮性：mock 只返回 name（缺字段）→ 不 500，字段回落', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify({ name: '极简橡木边柜' }));
    expect(res.status, '缺字段不允许 500').toBe(200);
    expect(res.json.success).toBe(true);
    const p = res.json.data.product;
    expect(p.name).toBe('极简橡木边柜');
    expect(Array.isArray(p.sellingPoints), 'sellingPoints 缺失应回落为数组').toBe(true);
    expect(p.size).toBe('可到店量尺', '缺 size 应回落"可到店量尺"');
    expect(p.suitableFor === undefined || typeof p.suitableFor === 'string').toBe(true);
  });

  test('A6 健壮性：sellingPoints 非数组（字符串）→ 不 500，回落数组', async () => {
    const cookie = await loginAdmin();
    const res = await uploadAndIdentify(cookie, JSON.stringify({
      ...FULL_MOCK,
      subtitle: '胡桃木实木边柜',
      sellingPoints: '高端大气上档次', // AI 输出不规范
    }));
    expect(res.status, 'sellingPoints 非数组不允许 500').toBe(200);
    expect(res.json.success).toBe(true);
    const p = res.json.data.product;
    expect(Array.isArray(p.sellingPoints)).toBe(true);
    // 回落：[subtitle]（spec 规定）
    expect(p.sellingPoints).toContain('胡桃木实木边柜');
  });

  test('A7 健壮性：markdown 包裹的 JSON 仍解析成功', async () => {
    const cookie = await loginAdmin();
    const wrapped = '好的，识别结果如下：\n```json\n' + JSON.stringify(FULL_MOCK, null, 2) + '\n```';
    const res = await uploadAndIdentify(cookie, wrapped);
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.data.product.name).toBe(FULL_MOCK.name);
  });

  test('A8 未登录调 upload-and-identify 应 401（CLAUDE.md 鉴权表：admin）', async () => {
    const res = await uploadAndIdentify(null, JSON.stringify(FULL_MOCK));
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// B. POST /api/admin/products/:id/regenerate-copy（新端点）
// ============================================================================

test.describe('v1 AI 文案 · regenerate-copy', () => {
  test('B0 未登录应 401', async () => {
    const res = await request(QA_PORT, 'POST', '/api/admin/products/p-qa-regen/regenerate-copy', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('B1 商品 id 不存在 → 404（业务 404，不是 API 404 兜底）', async () => {
    const cookie = await loginAdmin();
    const res = await request(QA_PORT, 'POST', '/api/admin/products/p-no-such-qa/regenerate-copy', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(res.json, '应返回 JSON 而非 HTML').toBeTruthy();
    expect(res.json.success).toBe(false);
    expect(String(res.json.error)).not.toContain('API 不存在');
    expect(String(res.json.error)).toMatch(/商品不存在|找不到|不存在/);
  });

  test('B2 商品图片文件缺失 → 404 "图片丢失，请重新上传"', async () => {
    insertProductDirectly({
      id: 'p-qa-noimg',
      name: '图片丢失测试沙发',
      price: '¥1999起',
      status: '在售',
      size: '常规尺寸',
      image: '/uploads/products/qa-no-such-image__deleted.jpg',
      description: 'AI 识别：旧文案',
      highlights: ['AI 识别于 2026/1/1 00:00:00'],
    });
    const cookie = await loginAdmin();
    const res = await request(QA_PORT, 'POST', '/api/admin/products/p-qa-noimg/regenerate-copy', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(res.json.success).toBe(false);
    expect(String(res.json.error)).toMatch(/图片丢失/);
  });

  test('B3 成功路径：四件套补齐，name/price/status 不被覆盖', async () => {
    // 准备：一张真实存在的图 + 一个"老板改过字段"的旧商品
    const srcName = 'qa-copy-source.jpg';
    fs.copyFileSync(SOURCE_IMAGE, path.join(UPLOAD_PRODUCTS_DIR, srcName));
    insertProductDirectly({
      id: 'p-qa-regen',
      name: '老板手改的名字',
      price: '¥1999起',
      status: '下架',
      subtitle: '旧副标题',
      size: '常规尺寸',
      image: `/uploads/products/${srcName}`,
      description: 'AI 识别：旧文案',
      highlights: ['AI 识别于 2026/1/1 00:00:00'],
    });

    // mock 返回的 name/price 与老板改过的不同 → 若被覆盖即为失败
    mockAI.content = JSON.stringify({
      ...FULL_MOCK,
      name: 'AI 起的新名字（不应覆盖）',
      price: '¥8888起（不应覆盖）',
    });

    const cookie = await loginAdmin();
    const res = await request(QA_PORT, 'POST', '/api/admin/products/p-qa-regen/regenerate-copy', {
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);

    const p = res.json.data.product;
    // 老板改过的字段保留
    expect(p.name).toBe('老板手改的名字');
    expect(p.price).toBe('¥1999起');
    expect(p.status).toBe('下架');
    // 四件套补齐
    expect(Array.isArray(p.sellingPoints)).toBe(true);
    expect(p.sellingPoints.length).toBe(3);
    expect(typeof p.suitableFor).toBe('string');
    expect(p.suitableFor.length).toBeGreaterThan(0);
    expect(typeof p.placementTip).toBe('string');
    expect(p.placementTip.length).toBeGreaterThan(0);
    expect(p.size).toMatch(/约/);
    // 文案更新
    expect(p.description).not.toContain('AI 识别');
    expect(p.highlights).not.toContainEqual(expect.stringMatching(/^AI 识别于/));

    // 磁盘落库
    const store = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
    const onDisk = (store.products || store).find((x) => x.id === 'p-qa-regen');
    expect(onDisk.sellingPoints.length).toBe(3);
    expect(onDisk.name).toBe('老板手改的名字');
  });
});

// ============================================================================
// C. GET /api/products 读取时过滤 "AI 识别于" 机器噪音
// ============================================================================

test.describe('v1 AI 文案 · GET /api/products 过滤', () => {
  test('C1 返回的商品 highlights 不含 "AI 识别于…"（旧数据读取时兜底过滤）', async () => {
    // 注入一条带机器噪音的旧商品，保证断言不依赖仓库当前数据状态
    insertProductDirectly({
      id: 'p-qa-legacy',
      name: '带机器噪音的旧沙发',
      price: '¥2899起',
      status: '在售',
      size: '常规尺寸',
      image: '/uploads/products/qa-legacy.jpg',
      description: 'AI 识别：旧文案',
      highlights: ['粗纺布艺软包材质', 'AI 识别于 2026/1/1 00:00:00'],
    });

    const res = await request(QA_PORT, 'GET', '/api/products');
    expect(res.status).toBe(200);
    const legacy = res.json.data.products.find((p) => p.id === 'p-qa-legacy');
    expect(legacy, '刚注入的商品应出现在列表').toBeDefined();
    expect(legacy.highlights).toContain('粗纺布艺软包材质');
    for (const p of res.json.data.products) {
      for (const h of p.highlights || []) {
        expect(h).not.toMatch(/^AI 识别于/);
      }
    }
  });
});
