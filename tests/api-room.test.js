// v3 品类地基 / 卧室板块测试（新文件名，绝不覆盖既有的 api-v3.test.js——那是上一轮 presets/订单回归）
//   1) GET /api/categories 契约（sofa/bed 启用，柜/桌/其他停用，带 room/noun/defaultRoom）
//   2) 品类感知试摆 prompt：sofa 逐字等于原串（零回归）、bed→卧室/床（把床搬回家）——测线上真实函数
//   3) admin PATCH 商品 category 生效，并 try/finally 还原（不脏数据）
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3000';
const REPO = process.cwd();
const SERVER_FILE = path.join(REPO, 'src', 'server.js');
const CATEGORIES_FILE = path.join(REPO, 'data', 'categories.json');

// 沙发默认 prompt 的原始写死串（通用化改造前）——sofa 分支必须逐字等于它
const ORIG_SOFA_PROMPT = '把第二张图里的「轻奢 L 形转角沙发」自然摆放到第一张图的客厅场景，保持客厅光线、墙面、地板、家具风格不变。沙发按透视与光影融入，整体看起来像实拍照片，高清、温馨。';

function readJSON(f) { return JSON.parse(fs.readFileSync(f, 'utf-8')); }

// 从 src/server.js 抽出品类相关函数，注入真实 readJSON / CATEGORIES_FILE / CATEGORY_IDS 后求值。
// 测的是线上真实代码：改这些函数会直接让测试红。
function extractCategoryFns() {
  const src = fs.readFileSync(SERVER_FILE, 'utf-8');
  const names = ['loadCategories', 'categoryForProduct', 'tryonCategoryContext', 'buildTryonDefaultPrompt'];
  const bodies = names.map((n) => {
    const hit = src.match(new RegExp(`^function ${n}\\([\\s\\S]*?^\\}`, 'm'));
    expect(hit, `src/server.js 应能找到 function ${n}()`).toBeTruthy();
    return hit[0];
  });
  const CATEGORY_IDS = ['sofa', 'cabinet', 'bed', 'table', 'other'];
  const factory = new Function('readJSON', 'CATEGORIES_FILE', 'CATEGORY_IDS',
    `${bodies.join('\n\n')}\nreturn { ${names.join(', ')} };`);
  return factory(readJSON, CATEGORIES_FILE, CATEGORY_IDS);
}

test('GET /api/categories：sofa/bed 启用、柜/桌/其他停用，带 room/noun/defaultRoom', async ({ request }) => {
  const res = await request.get(`${BASE}/api/categories`);
  expect(res.status()).toBe(200);
  const cats = (await res.json()).data.categories;
  const byId = Object.fromEntries(cats.map(c => [c.id, c]));
  expect(byId.sofa.enabled).toBe(true);
  expect([byId.sofa.room, byId.sofa.noun]).toEqual(['客厅', '沙发']);
  expect(byId.bed.enabled).toBe(true);
  expect([byId.bed.room, byId.bed.noun]).toEqual(['卧室', '床']);
  expect(String(byId.bed.defaultRoom)).toContain('default-room-bed');
  expect(byId.cabinet.enabled).toBe(false);
  expect(byId.table.enabled).toBe(false);
});

test('categoryForProduct + buildTryonDefaultPrompt：sofa 零回归，bed→卧室/床', async () => {
  const { buildTryonDefaultPrompt, categoryForProduct } = extractCategoryFns();
  expect(categoryForProduct({ id: 'bed-1' })).toBe('bed');
  expect(categoryForProduct({ id: 'cabinet-1' })).toBe('cabinet');
  expect(categoryForProduct({ id: 'p-abc' })).toBe('sofa'); // AI 沙发前缀兜底
  const sofa = buildTryonDefaultPrompt({ id: 'sofa-2', name: '轻奢 L 形转角沙发' });
  expect(sofa).toBe(ORIG_SOFA_PROMPT); // 逐字相等：沙发路径零回归
  const bed = buildTryonDefaultPrompt({ id: 'bed-9', name: '实木双人床' });
  expect(bed).toContain('卧室');
  expect(bed).toContain('床');
  expect(bed).not.toContain('客厅');
});

test('admin PATCH 商品 category 生效并还原', async ({ request }) => {
  const login = await request.post(`${BASE}/api/admin/login`, { data: { username: 'admin', password: '123456' } });
  expect(login.status()).toBe(200);

  const TARGET = 'sofa-2';
  const before = await (await request.get(`${BASE}/api/admin/products/${TARGET}`)).json();
  const original = before.data.category;
  expect(['sofa', 'cabinet', 'bed', 'table', 'other']).toContain(original);
  const probe = original === 'cabinet' ? 'other' : 'cabinet';
  try {
    const patch = await request.patch(`${BASE}/api/admin/products/${TARGET}`, { data: { category: probe } });
    expect(patch.status()).toBe(200);
    const after = await (await request.get(`${BASE}/api/admin/products/${TARGET}`)).json();
    expect(after.data.category).toBe(probe);
  } finally {
    await request.patch(`${BASE}/api/admin/products/${TARGET}`, { data: { category: original } });
    const restored = await (await request.get(`${BASE}/api/admin/products/${TARGET}`)).json();
    expect(restored.data.category).toBe(original); // 还原校验
  }
});
