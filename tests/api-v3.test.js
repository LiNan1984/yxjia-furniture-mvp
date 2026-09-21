// v3 迭代测试：三处 server.js 逻辑修改的防回归覆盖
//
//   修复① 试摆「光线/风格预设」接进最终 prompt
//          （resolveTryonPreset / buildFinalTryonPrompt，src/server.js ~268/281 行）
//          —— 真调合成会打 AI + 触发匿名限流（3 次/IP/24h），所以这里只做：
//             a) 数据源契约：GET /api/tryon/presets
//             b) 把两个纯函数从 src/server.js 原文抽出来单测（不跑服务、不打 AI）
//             c) 静态检查三个路由处理器里确实调了 buildFinalTryonPrompt
//
//   修复② 订单查询加鉴权（脱敏 / 403 / 订单号分支）—— 纯本地逻辑，全量覆盖
//          （getSessionUserPhone / maskOrderForPublic / ordersForCaller，
//           GET /api/orders/:phone、GET /api/orders/by-phone/:phone）
//
//   修复③ POST /api/whole-home/recommend 从 uploads.json 的 wholeHomeAnalyzes[]
//          按 id 找记录（修了此前必 404 的 bug）—— 只测错误分支 + 已有的真实记录
//          （recommend 本身是 Phase 1 规则生成，不调 AI；/analyze 才需要图 + AI，不测）
//
// 数据污染防护：beforeAll 备份 data/orders.json 与 data/users.json，afterAll 原样还原；
// 手机号用 138000000xx 段（不会撞真实用户），登录会自动注册用户，所以 users.json 也要还原。

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3000';
const REPO = process.cwd();
const SERVER_FILE = path.join(REPO, 'src', 'server.js');
const ORDERS_FILE = path.join(REPO, 'data', 'orders.json');
const USERS_FILE = path.join(REPO, 'data', 'users.json');
const UPLOADS_FILE = path.join(REPO, 'data', 'uploads.json');
const PRESETS_FILE = path.join(REPO, 'data', 'presets.json');
const SCENE_STYLES_FILE = path.join(REPO, 'data', 'scene-styles.json');

// ---------- 测试数据（明显不会撞真实的号段） ----------
const PHONE_A = '13800000001';
const PHONE_B = '13800000002';

// 名字/地址都取可断言脱敏的长文本（张*、前4位+****）
const RAW_NAME_A = '王大河';
const RAW_ADDR_A = '陕西省商洛市柞水县乾佑街道农机路河西12号';
const RAW_NOTE_A = '麻烦周末送到，到了打电话';
const RAW_NAME_B = '李晓梅';
const RAW_ADDR_B = '陕西省西安市雁塔区高新路88号';

// ---------- 跨测试共享状态 ----------
let productId = null;
let orderIdA = null;
let orderIdB = null;
let orderIdC = null; // 边界样本：单字称呼 + 4 字以内地址
let ordersBackup = null;
let usersBackup = null;

// ---------- 工具 ----------

// 从 data/*.json 读数组（兼容 { presets: [] } / { styles: [] } / 裸数组三种形态）
function readList(file, key) {
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  return Array.isArray(data) ? data : (data[key] || []);
}

// 从 src/server.js 原文里抽出指定顶层函数（以列 0 的 `}` 收尾），
// 配上 loadPresets / loadSceneStyles 两个桩即可在测试进程里单独求值。
// 好处：测的是线上真实代码，改动这两个函数会直接让测试红。
function extractServerFunctions(names) {
  const src = fs.readFileSync(SERVER_FILE, 'utf-8');
  const bodies = names.map((name) => {
    const re = new RegExp(`^function ${name}\\([\\s\\S]*?^\\}`, 'm');
    const hit = src.match(re);
    expect(hit, `src/server.js 里应能找到 function ${name}()`).toBeTruthy();
    return hit[0];
  });
  const factory = new Function(
    'loadPresets',
    'loadSceneStyles',
    `${bodies.join('\n\n')}\nreturn { ${names.join(', ')} };`
  );
  return factory(
    () => readList(PRESETS_FILE, 'presets'),
    () => readList(SCENE_STYLES_FILE, 'styles')
  );
}

async function createOrder(request, body) {
  const res = await request.post(`${BASE}/api/orders`, { data: body });
  expect(res.status(), '造单应成功').toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
  return json.data.order;
}

// 登录（验证码 MVP 固定 123456）；返回带 cookie 的独立 context
async function loginAs(browser, phone) {
  const ctx = await browser.newContext();
  const res = await ctx.request.post(`${BASE}/api/auth/login`, {
    data: { phone, code: '123456' },
  });
  expect(res.status(), '登录应成功').toBe(200);
  const json = await res.json();
  expect(json.success).toBe(true);
  return ctx;
}

test.describe('v3 · 修复① 试摆光线/风格预设', () => {
  test('GET /api/tryon/presets 返回 5 个预设（resolveTryonPreset 的数据源）', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tryon/presets`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const presets = json.presets;
    expect(Array.isArray(presets)).toBe(true);
    expect(presets).toHaveLength(5);

    const ids = presets.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['default', 'sunlight', 'night', 'minimal', 'family']));

    for (const p of presets) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.prompt).toBe('string'); // prompt 允许为空串（「自然摆放」）
    }

    // 至少 4 个预设带非空描述 —— 否则"预设接进 prompt"就是空转
    const withDesc = presets.filter((p) => p.prompt.trim() !== '');
    expect(withDesc.length).toBeGreaterThanOrEqual(4);
  });

  test('「自然摆放」prompt 为空串（未选预设时行为与改造前一致）', async ({ request }) => {
    const res = await request.get(`${BASE}/api/tryon/presets`);
    const presets = (await res.json()).presets;
    const def = presets.find((p) => p.id === 'default');
    expect(def).toBeTruthy();
    expect(def.prompt.trim()).toBe('');
  });

  test('resolveTryonPreset：按 id / 中文名命中，空描述与未知 id 返回 null', async () => {
    const { resolveTryonPreset } = extractServerFunctions(['resolveTryonPreset']);

    // 空 / 非字符串 → null（不拼任何预设描述）
    expect(resolveTryonPreset('')).toBeNull();
    expect(resolveTryonPreset('   ')).toBeNull();
    expect(resolveTryonPreset(undefined)).toBeNull();
    expect(resolveTryonPreset(null)).toBeNull();
    expect(resolveTryonPreset(123)).toBeNull();

    // data/presets.json 命中（id 与中文名两条路都要通）
    const byId = resolveTryonPreset('sunlight');
    expect(byId).not.toBeNull();
    expect(byId.id).toBe('sunlight');
    expect(byId.name).toBe('暖光氛围');
    expect(byId.prompt).toContain('暖阳光');
    const byName = resolveTryonPreset('暖光氛围');
    expect(byName).not.toBeNull();
    expect(byName.id).toBe('sunlight');

    // v2 场景卡兜底（data/scene-styles.json，id 形如 daylight）
    const fromScene = resolveTryonPreset('daylight');
    expect(fromScene).not.toBeNull();
    expect(fromScene.id).toBe('daylight');

    // 未知预设 / 空描述预设 → null（调用方行为与改造前一致）
    expect(resolveTryonPreset('不存在的预设-xyz')).toBeNull();
    expect(resolveTryonPreset('default')).toBeNull();
  });

  test('buildFinalTryonPrompt：默认指令 + 预设描述 + 用户要求按序拼接', async () => {
    // buildFinalTryonPrompt 内部会调 resolveTryonPreset，所以两个要一起抽出来
    const { buildFinalTryonPrompt } = extractServerFunctions([
      'resolveTryonPreset',
      'buildFinalTryonPrompt',
    ]);
    const DEF = '把沙发摆进客厅，保持光线不变。';

    // 只选预设
    const onlyPreset = buildFinalTryonPrompt(DEF, 'sunlight', '');
    expect(onlyPreset.finalPrompt.startsWith(DEF)).toBe(true);
    expect(onlyPreset.finalPrompt).toContain('光线/风格预设「暖光氛围」');
    expect(onlyPreset.finalPrompt).toContain('强调午后暖阳光');
    expect(onlyPreset.preset).not.toBeNull();
    expect(onlyPreset.preset.id).toBe('sunlight');

    // 预设 + 自定义 prompt
    const both = buildFinalTryonPrompt(DEF, 'night', '沙发朝南摆');
    expect(both.finalPrompt).toContain('光线/风格预设「夜晚温馨」');
    expect(both.finalPrompt).toContain('用户额外要求：沙发朝南摆');
    expect(both.finalPrompt.indexOf('光线/风格预设')).toBeLessThan(
      both.finalPrompt.indexOf('用户额外要求')
    );

    // 预设为空 → 等于改造前（只有默认 + 自定义），preset 回 null
    const noPreset = buildFinalTryonPrompt(DEF, '', '沙发朝南摆');
    expect(noPreset.finalPrompt).toBe(`${DEF} 用户额外要求：沙发朝南摆`);
    expect(noPreset.preset).toBeNull();

    // 什么都没有 → 只剩默认指令（无尾随空格）
    expect(buildFinalTryonPrompt(DEF, '', '').finalPrompt).toBe(DEF);
    expect(buildFinalTryonPrompt(DEF, 'default', '').finalPrompt).toBe(DEF);
    expect(buildFinalTryonPrompt('', '', '').finalPrompt).toBe('');
  });

  test('三个试摆路由处理器都调用了 buildFinalTryonPrompt', () => {
    const src = fs.readFileSync(SERVER_FILE, 'utf-8');
    for (const route of ['/api/tryon/ai-anon', '/api/tryon/ai-custom', '/api/tryon/ai-history']) {
      const start = src.indexOf(`app.post('${route}'`);
      expect(start, `应存在路由 ${route}`).toBeGreaterThan(-1);
      const nextApp = src.indexOf('\napp.', start + 1);
      const body = src.slice(start, nextApp === -1 ? undefined : nextApp);
      expect(body, `${route} 应把预设拼进 prompt`).toContain('buildFinalTryonPrompt(');
    }
  });
});

test.describe('v3 · 修复② 订单查询鉴权', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ browser }) => {
    // 备份数据，afterAll 还原
    ordersBackup = fs.existsSync(ORDERS_FILE) ? fs.readFileSync(ORDERS_FILE) : null;
    usersBackup = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE) : null;

    // 取一个真实在售商品 id，保证造单不被商品校验挡住（顺带用它造单）
    const ctx = await browser.newContext();
    const res = await ctx.request.get(`${BASE}/api/products`);
    expect(res.status()).toBe(200);
    const products = (await res.json()).data.products;
    expect(products.length).toBeGreaterThan(0);
    productId = products[0].id;

    orderIdA = (await createOrder(ctx.request, {
      productId,
      name: RAW_NAME_A,
      phone: PHONE_A,
      address: RAW_ADDR_A,
      note: RAW_NOTE_A,
    })).id;
    orderIdB = (await createOrder(ctx.request, {
      productId,
      name: RAW_NAME_B,
      phone: PHONE_B,
      address: RAW_ADDR_B,
      note: '',
    })).id;
    // 边界样本：单字称呼 + 4 字以内地址
    orderIdC = (await createOrder(ctx.request, {
      productId,
      name: '李',
      phone: PHONE_A,
      address: '街口',
      note: '备注C',
    })).id;

    await ctx.close();
    expect(orderIdA.startsWith('O')).toBe(true);
  });

  test.afterAll(() => {
    const restore = (file, backup) => {
      if (backup === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, backup);
      }
    };
    restore(ORDERS_FILE, ordersBackup);
    restore(USERS_FILE, usersBackup);
  });

  test('未登录 GET /api/orders/by-phone/:phone → 200 且姓名/地址脱敏、备注清空', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orders/by-phone/${PHONE_A}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const orders = json.data.orders;
    const orderA = orders.find((o) => o.id === orderIdA);
    expect(orderA, '应能查到订单 A').toBeTruthy();

    // 姓名打码：不等于原文、含 *、保留首字
    expect(orderA.name).not.toBe(RAW_NAME_A);
    expect(orderA.name).toContain('*');
    expect(orderA.name).toBe('王**');
    // 地址：前 4 位 + ****
    expect(orderA.address).not.toBe(RAW_ADDR_A);
    expect(orderA.address).toBe(`${RAW_ADDR_A.slice(0, 4)}****`);
    // 备注整条去掉
    expect(orderA.note).toBe('');
    // 其他字段不动（手机号本来就在 URL 里，商品信息要留着）
    expect(orderA.phone).toBe(PHONE_A);
    expect(orderA.productId).toBe(productId);
    expect(orderA.status).toBeTruthy();

    // 边界：单字称呼 → 单个 *；4 字以内地址 → ****
    const orderC = orders.find((o) => o.id === orderIdC);
    expect(orderC).toBeTruthy();
    expect(orderC.name).toBe('*');
    expect(orderC.address).toBe('****');
    expect(orderC.note).toBe('');
  });

  test('未登录 GET /api/orders/:phone 同样脱敏', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orders/${PHONE_B}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const orderB = json.data.orders.find((o) => o.id === orderIdB);
    expect(orderB).toBeTruthy();
    expect(orderB.name).toBe('李**');
    expect(orderB.address).toBe(`${RAW_ADDR_B.slice(0, 4)}****`);
    expect(orderB.note).toBe('');
  });

  test('登录用户查自己的手机号 → 全量（姓名/地址/备注都是原文）', async ({ browser }) => {
    const ctx = await loginAs(browser, PHONE_A);
    const res = await ctx.request.get(`${BASE}/api/orders/by-phone/${PHONE_A}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const orderA = json.data.orders.find((o) => o.id === orderIdA);
    expect(orderA).toBeTruthy();
    expect(orderA.name).toBe(RAW_NAME_A);
    expect(orderA.address).toBe(RAW_ADDR_A);
    expect(orderA.note).toBe(RAW_NOTE_A);
    await ctx.close();
  });

  test('登录用户查别人的手机号 → 403（两个路由都要拦）', async ({ browser }) => {
    const ctx = await loginAs(browser, PHONE_A);

    const byPhone = await ctx.request.get(`${BASE}/api/orders/by-phone/${PHONE_B}`);
    expect(byPhone.status()).toBe(403);
    const json1 = await byPhone.json();
    expect(json1.success).toBe(false);
    expect(json1.error).toContain('只能查询自己手机号下的订单');

    const byParam = await ctx.request.get(`${BASE}/api/orders/${PHONE_B}`);
    expect(byParam.status()).toBe(403);
    const json2 = await byParam.json();
    expect(json2.success).toBe(false);
    expect(json2.error).toContain('只能查询自己手机号下的订单');

    await ctx.close();
  });

  test('登录用户 A 查自己 → /api/orders/:phone 分支也是全量', async ({ browser }) => {
    const ctx = await loginAs(browser, PHONE_A);
    const res = await ctx.request.get(`${BASE}/api/orders/${PHONE_A}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const orderA = json.data.orders.find((o) => o.id === orderIdA);
    expect(orderA.name).toBe(RAW_NAME_A);
    expect(orderA.address).toBe(RAW_ADDR_A);
    await ctx.close();
  });

  test('未登录按订单号（O 开头）能查到 —— 下单成功页可用', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orders/${orderIdA}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const orders = json.data.orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe(orderIdA);
    // 未登录仍是脱敏版（成功页不泄露他人姓名/地址）
    expect(orders[0].name).toBe('王**');
    expect(orders[0].address).toBe(`${RAW_ADDR_A.slice(0, 4)}****`);
    expect(orders[0].note).toBe('');
  });

  test('登录用户 B 按订单号查 A 的订单 → 查不到（过滤成空）', async ({ browser }) => {
    const ctx = await loginAs(browser, PHONE_B);
    const res = await ctx.request.get(`${BASE}/api/orders/${orderIdA}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    const orders = json.data.orders;
    expect(orders.find((o) => o.id === orderIdA)).toBeFalsy();

    // 但 B 查自己的订单号仍看得到（全量）
    const own = await ctx.request.get(`${BASE}/api/orders/${orderIdB}`);
    expect(own.status()).toBe(200);
    const ownJson = await own.json();
    const ownOrder = ownJson.data.orders.find((o) => o.id === orderIdB);
    expect(ownOrder).toBeTruthy();
    expect(ownOrder.name).toBe(RAW_NAME_B);
    await ctx.close();
  });

  // 历史缺口（已修复）：GET /api/orders/ 尾斜杠被 Express 非严格路由归一化，命中的是
  // app.get('/api/orders')（admin/orders.html 用的全量列表）。此前未挂 requireAdmin，
  // 匿名可拿全量订单原文（姓名/地址/备注不脱敏），且绕过 /api/orders/:phone 的脱敏。
  // 修复：给 /api/orders 加 requireAdmin，匿名一律 401；admin 后台同源带 cookie 不受影响。
  test('边界：GET /api/orders/ 命中需 admin 的 /api/orders → 匿名 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orders/`);
    expect(res.status()).toBe(401);
  });

  test('边界：不存在的手机号 → 200 空列表（不泄露存在性）', async ({ request }) => {
    const res = await request.get(`${BASE}/api/orders/by-phone/13800000999`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.data.orders).toHaveLength(0);
  });

  test('边界：脱敏不写回 orders.json（原始数据保持完整）', () => {
    const raw = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
    const saved = (raw.orders || raw).find((o) => o.id === orderIdA);
    expect(saved).toBeTruthy();
    expect(saved.name).toBe(RAW_NAME_A);
    expect(saved.address).toBe(RAW_ADDR_A);
    expect(saved.note).toBe(RAW_NOTE_A);
  });
});

test.describe('v3 · 修复③ /api/whole-home/recommend', () => {
  test('缺 analyzeId → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { styleId: 'shangluo-nuanju' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('analyzeId');
  });

  test('缺 styleId → 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { analyzeId: 'whan-does-not-exist' },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('styleId');
  });

  test('假 analyzeId → 404「找不到该全屋分析记录」', async ({ request }) => {
    const res = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { analyzeId: 'whan-does-not-exist-xyz', styleId: 'shangluo-nuanju' },
    });
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('找不到该全屋分析记录');
  });

  test('假 styleId → 404「找不到风格卡」', async ({ request }) => {
    // 用真实存在的 analyzeId（uploads.json 的 wholeHomeAnalyzes[]），这样 404 只能来自风格卡分支
    const analyzes = readList(UPLOADS_FILE, 'wholeHomeAnalyzes');
    test.skip(analyzes.length === 0, 'data/uploads.json 里没有 wholeHomeAnalyzes 记录，跳过');
    const realAnalyzeId = analyzes[0].id;

    const res = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { analyzeId: realAnalyzeId, styleId: 'no-such-style-xyz' },
    });
    expect(res.status()).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('找不到风格卡');
  });

  test('真实 analyzeId + 真实 styleId → 200（修了此前必 404 的 bug；不调 AI）', async ({ request }) => {
    const analyzes = readList(UPLOADS_FILE, 'wholeHomeAnalyzes');
    test.skip(analyzes.length === 0, 'data/uploads.json 里没有 wholeHomeAnalyzes 记录，跳过');
    const record = analyzes[0];

    const stylesRes = await request.get(`${BASE}/api/whole-home/styles`);
    expect(stylesRes.status()).toBe(200);
    const styles = (await stylesRes.json()).data.styles;
    expect(styles.length).toBeGreaterThan(0);
    const style = styles[0];

    const res = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { analyzeId: record.id, styleId: style.id, budget: '10-12万' },
    });
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const plan = json.data.plan;
    expect(plan.analyzeId).toBe(record.id);
    expect(plan.style.id).toBe(style.id);
    expect(plan.budget).toBe('10-12万');
    expect(Array.isArray(plan.rooms)).toBe(true);
    expect(plan.rooms.length).toBeGreaterThan(0);
    expect(plan.rooms[0].roomType).toBeTruthy();
    expect(plan.deliveryPlan).toBeTruthy();
    expect(plan.deliveryPlan.batch1.items.length + plan.deliveryPlan.batch2.items.length)
      .toBeGreaterThan(0);
    // 预算缺省时回显面议
    const noBudget = await request.post(`${BASE}/api/whole-home/recommend`, {
      data: { analyzeId: record.id, styleId: style.id },
    });
    expect(noBudget.status()).toBe(200);
    const plan2 = (await noBudget.json()).data.plan;
    expect(plan2.budget).toBeTruthy();
  });
});
