// v2 迭代测试：AI 商品场景图生产（spec: team/spec/spec-v2.md）
//
// 设计要点（沿用 api-v1.test.js 的双进程 mock 模式）：
// 1. 完全自包含：本文件自己起两个进程——
//    - 本地 mock server（端口 3199）：可编程的 twofishai /v1/images/edits（场景图主路径）
//      + STEP chat/completions + ASR + TTS（P1 导购字段守护），绝不打真 AI API、不花 token
//    - 独立的 yxjia server 实例（端口 3100），环境变量：
//      TWO_FISH_EDITS_URL 指向 mock（依赖 spec S1 改环境变量，未实现前成功路径用例红）
//      TWO_FISH_API_KEY 显式设非空假值（防 .env 真值漏进来）
//      POLLINATIONS_OFF=1（依赖 spec S4 测试开关：twofishai 失败时跳过 Pollinations 直接 throw，
//      未实现前失败路径用例会滑向真网络、以超时/真 502 的别的方式红——TDD 预期内）
// 2. 数据污染防护：beforeAll 备份 data/products.json 与 data/uploads.json 与
//    uploads/compositions/ 目录快照，afterAll 全部还原。
// 3. 断言依据 spec-v2「给测试角色的交接」+「验收标准」。

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
const UPLOADS_META_FILE = path.join(DATA_DIR, 'uploads.json');
const UPLOAD_PRODUCTS_DIR = path.join(REPO, 'uploads', 'products');
const UPLOAD_COMPOSITIONS_DIR = path.join(REPO, 'uploads', 'compositions');
const SOURCE_IMAGE = path.join(UPLOAD_PRODUCTS_DIR, '2d484ab70cf1785a.jpg'); // 已存在的真实商品图

// 1x1 PNG（mock 场景图返回体；spec 交接：S4 不要加最小尺寸拦截，否则 mock 图过不了）
const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// ---------- mock server（可编程） ----------

// 场景图链路 mock：mode 控制 /v1/images/edits 行为
//   ok    → 200 { data: [{ b64_json }] }（走通 twofishai 主路径全链路）
//   error → 500（触发 502 失败路径）
//   slow  → 延迟 delayMs 后 200（触发 409 并发护栏）
const mockScene = { mode: 'ok', delayMs: 0, hit: false, lastBody: null };
// STEP 导购链路 mock（P1 守护用）：lastBody 记录发往 chat/completions 的请求体
const mockAI = { content: null, lastBody: null };
// ASR 固定识别文本
const ASR_TEXT = '有什么沙发推荐';

function startMockServer() {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (req.method === 'POST' && req.url.endsWith('/v1/images/edits')) {
        mockScene.hit = true;
        mockScene.lastBody = raw;
        if (mockScene.mode === 'slow' && mockScene.delayMs > 0) {
          await new Promise((r) => setTimeout(r, mockScene.delayMs));
        }
        if (mockScene.mode === 'error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'mock: upstream unavailable' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: PNG_1PX_B64 }] }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/chat/completions')) {
        mockAI.lastBody = raw;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-qa-mock',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: mockAI.content ?? '这款沙发适合家里有老人的家庭，欢迎到店体验。' },
            finish_reason: 'stop',
          }],
        }));
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/audio/asr/sse')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.end(`data: ${JSON.stringify({ type: 'transcript.text.done', text: ASR_TEXT })}\n\n`);
        return;
      }
      if (req.method === 'POST' && req.url.endsWith('/audio/speech')) {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(Buffer.from('qa-fake-mp3-bytes'));
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
        // Node http 客户端对无 Content-Length 的 DELETE 请求会丢弃 body（不自动 chunked），
        // 显式带上 Content-Length（浏览器 fetch / curl 本来就会带）
        headers: body
          ? { 'Content-Length': Buffer.byteLength(body), ...headers }
          : headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf-8');
          let json = null;
          try { json = JSON.parse(text); } catch (_) { /* 非 JSON（HTML 等） */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json, buffer: buf });
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

function postScene(cookie, productId, body) {
  return request(QA_PORT, 'POST', `/api/admin/products/${productId}/scene-image`, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function deleteScene(cookie, productId, body) {
  return request(QA_PORT, 'DELETE', `/api/admin/products/${productId}/scene-image`, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function readProductsRaw() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
}

function findOnDisk(id) {
  const store = readProductsRaw();
  return (store.products || store).find((x) => x.id === id);
}

function sceneUploadRecords() {
  try {
    const meta = JSON.parse(fs.readFileSync(UPLOADS_META_FILE, 'utf-8'));
    return (meta.uploads || []).filter((u) => u.type === 'scene');
  } catch (_) {
    return [];
  }
}

// 往 products.json 直接追加测试商品（server 每次请求都重读磁盘文件）
function insertProductDirectly(product) {
  const store = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf-8'));
  const list = Array.isArray(store) ? store : store.products;
  list.push(product);
  const out = Array.isArray(store)
    ? list
    : { ...store, products: list };
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(out, null, 2), 'utf-8');
}

// ---------- 全局 setup / teardown ----------

let mockServer;
let serverProc;
let originalProductsText;
let originalUploadsMetaText;
let compositionsSnapshot;

test.beforeAll(async () => {
  // 备份
  originalProductsText = fs.readFileSync(PRODUCTS_FILE, 'utf-8');
  originalUploadsMetaText = fs.existsSync(UPLOADS_META_FILE)
    ? fs.readFileSync(UPLOADS_META_FILE, 'utf-8')
    : null;
  compositionsSnapshot = fs.existsSync(UPLOAD_COMPOSITIONS_DIR)
    ? new Set(fs.readdirSync(UPLOAD_COMPOSITIONS_DIR))
    : new Set();

  // fixture：测试商品图（复制真实商品图到独立文件名，afterAll 清理）
  fs.copyFileSync(SOURCE_IMAGE, path.join(UPLOAD_PRODUCTS_DIR, 'qa-scene-src.jpg'));

  mockServer = await startMockServer();

  serverProc = spawn('node', [path.join(REPO, 'src', 'server.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT: String(QA_PORT),
      // STEP 链路（P1 导购守护）指向 mock
      STEP_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      STEP_API_KEY: 'qa-mock-key-do-not-call-real-api',
      // 场景图链路（spec S1：TWO_FISH_EDITS_URL 环境变量可覆盖）指向 mock
      TWO_FISH_API_KEY: 'sk-fake-qa-do-not-call-real-api',
      TWO_FISH_EDITS_URL: `http://127.0.0.1:${MOCK_PORT}/v1/images/edits`,
      // spec S4 测试开关：twofishai 失败时跳过 Pollinations 直接 throw（防滑向真网络）
      POLLINATIONS_OFF: '1',
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

  // 注入测试商品（在 server 就绪后写入，请求时实时读盘）
  insertProductDirectly({
    id: 'p-qa-scene',
    name: '场景图测试沙发',
    price: '¥1999起',
    status: '在售',
    subtitle: 'qa 场景图链路专用',
    size: '约 2.0 米宽',
    image: '/uploads/products/qa-scene-src.jpg',
    suitableFor: '适合 qa 断言用家庭',
    placementTip: '靠 qa 墙摆，留 qa 过道',
  });
  insertProductDirectly({
    id: 'p-qa-scene-noimg',
    name: '图片丢失测试柜',
    price: '¥999起',
    status: '在售',
    size: '常规尺寸',
    image: '/uploads/products/qa-no-such-scene-image.jpg', // 指向不存在的文件
  });
  insertProductDirectly({
    id: 'p-qa-scene-plain',
    name: '无导购字段测试床',
    price: '¥2999起',
    status: '在售',
    subtitle: '旧商品兜底',
    size: '约 1.8 米宽',
    image: '/uploads/products/qa-scene-src.jpg',
    // 故意不带 suitableFor/placementTip（P1 旧商品兜底）
  });
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

  // 还原 products.json / uploads.json
  if (originalProductsText !== null) {
    fs.writeFileSync(PRODUCTS_FILE, originalProductsText, 'utf-8');
  }
  if (originalUploadsMetaText !== null) {
    fs.writeFileSync(UPLOADS_META_FILE, originalUploadsMetaText, 'utf-8');
  } else if (fs.existsSync(UPLOADS_META_FILE)) {
    fs.unlinkSync(UPLOADS_META_FILE);
  }
  // 清掉测试期间新产生的 fixture 图与合成图
  const qaFixture = path.join(UPLOAD_PRODUCTS_DIR, 'qa-scene-src.jpg');
  if (fs.existsSync(qaFixture)) { try { fs.unlinkSync(qaFixture); } catch (_) {} }
  if (fs.existsSync(UPLOAD_COMPOSITIONS_DIR)) {
    for (const f of fs.readdirSync(UPLOAD_COMPOSITIONS_DIR)) {
      if (!compositionsSnapshot.has(f)) {
        try { fs.unlinkSync(path.join(UPLOAD_COMPOSITIONS_DIR, f)); } catch (_) {}
      }
    }
  }
});

// ============================================================================
// A. 鉴权（spec 验收：未登录调 POST/DELETE scene-image → 401）
// ============================================================================

test.describe('v2 场景图 · 鉴权', () => {
  test('A1 未登录 POST scene-image → 401', async () => {
    const res = await postScene(null, 'p-qa-scene', { styleId: 'daylight' });
    expect(res.status).toBe(401);
  });

  test('A2 未登录 DELETE scene-image → 401', async () => {
    const res = await deleteScene(null, 'p-qa-scene', { styleId: 'daylight' });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// B. 404（商品 id 不存在 / 商品图丢失）
// ============================================================================

test.describe('v2 场景图 · 404', () => {
  test('B1 商品 id 不存在 → 404（业务 404，JSON 而非 API 兜底）', async () => {
    const cookie = await loginAdmin();
    const res = await postScene(cookie, 'p-no-such-qa', { styleId: 'daylight' });
    expect(res.status).toBe(404);
    expect(res.json, '应返回 JSON 而非 HTML').toBeTruthy();
    expect(res.json.success).toBe(false);
    expect(String(res.json.error)).toMatch(/商品不存在|找不到|不存在/);
  });

  test('B2 商品 image 指向不存在文件 → 404 图片丢失', async () => {
    const cookie = await loginAdmin();
    const res = await postScene(cookie, 'p-qa-scene-noimg', { styleId: 'daylight' });
    expect(res.status).toBe(404);
    expect(res.json.success).toBe(false);
    expect(String(res.json.error)).toMatch(/图片丢失/);
  });
});

// ============================================================================
// C. 400（styleId 非法 / 同风格重复且未 force）
// ============================================================================

test.describe('v2 场景图 · 400', () => {
  test('C1 styleId 不在 scene-styles → 400', async () => {
    const cookie = await loginAdmin();
    const res = await postScene(cookie, 'p-qa-scene', { styleId: 'qa-no-such-style' });
    expect(res.status).toBe(400);
    expect(res.json.success).toBe(false);
  });
});

// ============================================================================
// D. 成功路径（twofishai mock 主路径全断言）
// ============================================================================

test.describe('v2 场景图 · 成功路径', () => {
  test('D1 生成成功：sceneImages 落库 + 相对 url + uploads 记录 type=scene + 主图不被覆盖', async () => {
    const cookie = await loginAdmin();
    mockScene.mode = 'ok';
    mockScene.hit = false;
    const sceneCountBefore = sceneUploadRecords().length;

    const res = await postScene(cookie, 'p-qa-scene', { styleId: 'daylight' });
    expect(res.status, `应 200，实际 ${res.status}: ${res.text.slice(0, 200)}`).toBe(200);
    expect(mockScene.hit, '场景图请求应打本地 mock（TWO_FISH_EDITS_URL 覆盖生效），不得打真 API').toBe(true);
    expect(res.json.success).toBe(true);

    const sceneImage = res.json.data.sceneImage;
    expect(sceneImage, '应返回 sceneImage').toBeTruthy();
    expect(sceneImage.styleId).toBe('daylight');
    expect(sceneImage.styleName, 'styleName 应来自 scene-styles.json').toBeTruthy();
    expect(sceneImage.demoType).toBe('ai-composition');
    expect(typeof sceneImage.createdAt).toBe('string');
    expect(sceneImage.url, 'url 应为 /uploads/compositions/ 相对路径（fixImageUrl 生效）')
      .toMatch(/^\/uploads\/compositions\//);

    // 响应里的 product：主图不被覆盖 + sceneImages 已含新条目
    const p = res.json.data.product;
    expect(p.image).toBe('/uploads/products/qa-scene-src.jpg');
    expect(Array.isArray(p.sceneImages)).toBe(true);
    expect(p.sceneImages.some((s) => s.styleId === 'daylight')).toBe(true);

    // 磁盘落库
    const onDisk = findOnDisk('p-qa-scene');
    expect(onDisk).toBeDefined();
    expect(onDisk.image).toBe('/uploads/products/qa-scene-src.jpg');
    expect(Array.isArray(onDisk.sceneImages)).toBe(true);
    const entry = onDisk.sceneImages.find((s) => s.styleId === 'daylight');
    expect(entry).toBeDefined();
    expect(entry.demoType).toBe('ai-composition');

    // uploads.json 出现 type='scene' 记录（且带 productId/styleId）
    const records = sceneUploadRecords();
    expect(records.length).toBe(sceneCountBefore + 1);
    const rec = records[records.length - 1];
    expect(rec.productId).toBe('p-qa-scene');
    expect(rec.styleId).toBe('daylight');

    // 合成图 URL 可访问（本地 fallback 或 /uploads 代理）
    const img = await request(QA_PORT, 'GET', sceneImage.url);
    expect(img.status, '场景图 URL 应可直接访问').toBe(200);
  });

  // 依赖 D1（同商品同风格，force 重生成 = 替换不追加）
  test('D2 force=true 重生成：替换原条目不追加，createdAt 更新', async () => {
    const cookie = await loginAdmin();
    mockScene.mode = 'ok';

    const before = findOnDisk('p-qa-scene').sceneImages;
    const beforeCount = before.length;
    const beforeCreatedAt = before.find((s) => s.styleId === 'daylight').createdAt;

    const res = await postScene(cookie, 'p-qa-scene', { styleId: 'daylight', force: true });
    expect(res.status, `应 200，实际 ${res.status}: ${res.text.slice(0, 200)}`).toBe(200);

    const after = findOnDisk('p-qa-scene').sceneImages;
    expect(after.length, '替换不追加：sceneImages 数量不变').toBe(beforeCount);
    const daylightEntries = after.filter((s) => s.styleId === 'daylight');
    expect(daylightEntries.length, '同 styleId 只有一条').toBe(1);
    expect(daylightEntries[0].createdAt, 'createdAt 应更新').not.toBe(beforeCreatedAt);
  });
});

// C2 必须在 D1/D2 之后执行（依赖 daylight 已生成）：本文件 workers=1 串行，声明顺序即执行顺序。
// 注：Playwright 在失败用例后会重启 worker（beforeAll 备份随之还原），跨用例状态依赖只能靠顺序保证。
test.describe('v2 场景图 · 400（成功路径之后）', () => {
  test('C2 同 styleId 已生成且 force=false → 400 拦截', async () => {
    const cookie = await loginAdmin();
    const res = await postScene(cookie, 'p-qa-scene', { styleId: 'daylight' });
    expect(res.status).toBe(400);
    expect(res.json.success).toBe(false);
    expect(String(res.json.error)).toMatch(/已生成过|已生成|重新生成/);
  });
});

// ============================================================================
// E. 409 并发护栏（spec S6：单飞锁，进行中再请求 → 409）
// ============================================================================

test.describe('v2 场景图 · 409 并发', () => {
  test('E1 生成进行中再请求 → 409，首请求最终成功', async () => {
    const cookie = await loginAdmin();
    mockScene.mode = 'slow';
    mockScene.delayMs = 3000;
    try {
      const first = postScene(cookie, 'p-qa-scene-plain', { styleId: 'warmlight' });
      await new Promise((r) => setTimeout(r, 700)); // 等首请求进入上游调用
      const second = await postScene(cookie, 'p-qa-scene-plain', { styleId: 'night' });
      expect(second.status, '生成期间再点应被护栏拦截').toBe(409);
      expect(second.json.success).toBe(false);
      expect(String(second.json.error)).toMatch(/正在生成|等.*完成|请等/);

      const firstRes = await first;
      expect(firstRes.status, '首请求不应被误伤').toBe(200);
    } finally {
      mockScene.mode = 'ok';
      mockScene.delayMs = 0;
    }
  });
});

// ============================================================================
// F. 502 失败无脏数据（mock 500 + POLLINATIONS_OFF=1，spec 决策 3：无第四级兜底）
// ============================================================================

test.describe('v2 场景图 · 失败路径', () => {
  test('F1 上游 500 → 502，products.json / uploads.json 无脏数据', async () => {
    const cookie = await loginAdmin();
    mockScene.mode = 'error';
    const sceneCountBefore = sceneUploadRecords().length;
    const diskBefore = JSON.stringify(findOnDisk('p-qa-scene-plain'));
    try {
      const res = await postScene(cookie, 'p-qa-scene-plain', { styleId: 'minimal' });
      expect(res.status).toBe(502);
      expect(res.json.success).toBe(false);
      expect(String(res.json.error)).toMatch(/生成失败|再试/);

      // products.json 无脏数据：商品对象与请求前逐字节一致
      expect(JSON.stringify(findOnDisk('p-qa-scene-plain'))).toBe(diskBefore);
      // uploads.json 无新 type='scene' 记录
      expect(sceneUploadRecords().length).toBe(sceneCountBefore);
    } finally {
      mockScene.mode = 'ok';
    }
  });
});

// ============================================================================
// G. GET + DELETE（顾客端画廊数据 + 后台删除条目）
// ============================================================================

test.describe('v2 场景图 · GET / DELETE', () => {
  test('G1 GET /api/products/:id 返回 sceneImages（公开 API，url 相对路径）', async () => {
    const res = await request(QA_PORT, 'GET', '/api/products/p-qa-scene');
    expect(res.status).toBe(200);
    const p = res.json.data.product;
    expect(Array.isArray(p.sceneImages)).toBe(true);
    expect(p.sceneImages.length).toBeGreaterThan(0);
    for (const s of p.sceneImages) {
      expect(s.url).toMatch(/^\/uploads\/compositions\//);
      expect(s.demoType).toBe('ai-composition');
    }
  });

  test('G2 DELETE 后 GET 无该条目；MinIO/本地文件不删（孤儿文件无害）', async () => {
    const cookie = await loginAdmin();
    // 保留一份磁盘文件名用于"不删文件"断言
    const entryBefore = findOnDisk('p-qa-scene').sceneImages.find((s) => s.styleId === 'daylight');
    const filename = entryBefore.url.split('/').pop();
    const filePath = path.join(UPLOAD_COMPOSITIONS_DIR, filename);

    const res = await deleteScene(cookie, 'p-qa-scene', { styleId: 'daylight' });
    expect(res.status).toBe(200);

    const after = findOnDisk('p-qa-scene').sceneImages || [];
    expect(after.some((s) => s.styleId === 'daylight'), 'daylight 条目应被移除').toBe(false);

    const img = await request(QA_PORT, 'GET', entryBefore.url);
    expect(img.status, '删除条目不删文件，URL 应仍可访问').toBe(200);
    expect(fs.existsSync(filePath) || img.status === 200).toBe(true);
  });

  test('G3 无 sceneImages 的旧商品：GET 正常返回、无该字段污染（兼容）', async () => {
    const res = await request(QA_PORT, 'GET', '/api/products/p-qa-scene-noimg');
    expect(res.status).toBe(200);
    const p = res.json.data.product;
    expect(p.id).toBe('p-qa-scene-noimg');
    // 无场景图时字段缺省或为空数组，不允许出现损坏结构
    if (p.sceneImages !== undefined) {
      expect(Array.isArray(p.sceneImages)).toBe(true);
      expect(p.sceneImages.length).toBe(0);
    }
  });
});

// ============================================================================
// H. P1 导购字段守护（语音导购商品库行含 suitableFor/placementTip，旧商品兜底）
// ============================================================================

test.describe('v2 P1 · 导购字段守护', () => {
  const wavHeader = Buffer.alloc(44); // mock ASR 不校验音频内容，头 44 字节占位即可

  test('H1 /api/voice/ask 发往导购模型的 system prompt 含 suitableFor/placementTip 值', async () => {
    const mp = multipartBody({}, 'audio', 'qa-voice.wav', wavHeader, 'audio/wav');
    const res = await request(QA_PORT, 'POST', '/api/voice/ask', {
      headers: { 'Content-Type': mp.contentType, 'Content-Length': mp.body.length },
      body: mp.body,
    });
    expect(res.status, `语音问答应 200，实际 ${res.status}: ${res.text.slice(0, 200)}`).toBe(200);
    expect(res.json.success).toBe(true);

    expect(mockAI.lastBody, '导购请求应打本地 mock 的 chat/completions').toBeTruthy();
    const body = JSON.parse(mockAI.lastBody);
    const system = body.messages.find((m) => m.role === 'system').content;
    expect(system, 'system prompt 应包含注入商品的 suitableFor 值').toContain('适合 qa 断言用家庭');
    expect(system, 'system prompt 应包含注入商品的 placementTip 值').toContain('留 qa 过道');
  });

  test('H2 旧商品（无导购字段）进商品库行不报错、不出现 undefined', async () => {
    const mp = multipartBody({}, 'audio', 'qa-voice.wav', wavHeader, 'audio/wav');
    const res = await request(QA_PORT, 'POST', '/api/voice/ask', {
      headers: { 'Content-Type': mp.contentType, 'Content-Length': mp.body.length },
      body: mp.body,
    });
    expect(res.status).toBe(200);

    const body = JSON.parse(mockAI.lastBody);
    const system = body.messages.find((m) => m.role === 'system').content;
    expect(system, '旧商品名称应出现在商品库行').toContain('无导购字段测试床');
    expect(system, '字段缺失时不允许拼出 undefined/null').not.toMatch(/undefined|null/);
  });
});
