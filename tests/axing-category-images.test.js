// ============================================================================
// 品类示例房间图必须真实存在 · 回归测试
// ============================================================================
// 不变式：`/api/categories` 里每个 `defaultRoom` 指的文件都得在 src/images 里真的存在。
//
//    实测踩过的坑（prod 2026-10-06）：bed 品类的 defaultRoom 是
//    `/images/default-room-bed.jpg`，而**这个文件从不存在**（src/images 里只有
//    default-room.jpg / default-room-real.png，真正的卧室图是 bed-double.jpg）。
//    根因是 server.js 的硬编码兜底表把坏值写进了 data/categories.json，而 rsync
//    从不同步 data/ → 坏值一旦落盘就永不自愈。后果：/api/categories 返 404 地址，
//    前端探测失败只能把「用默认图体验」禁用，卧室品类失去「没照片也能试」的路径。
//
// ⚠️ 这条同时守 server.js 的兜底表和 data/categories.json 两份来源——不管坏值从
//    哪来都会红。
//
// 端口：3534（独立 spawn，不复用 playwright.config.js 的 3000）
// 单独跑：./node_modules/.bin/playwright test tests/axing-category-images.test.js --reporter=line
// ============================================================================
import { test, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const PORT = 3534;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGES_DIR = path.join(process.cwd(), 'src', 'images');

let serverProc;

async function waitServerReady(timeoutMs = 20000) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE_URL}/api/products`);
      if (r.ok) return;
    } catch { /* 还没起来 */ }
    if (Date.now() - started > timeoutMs) throw new Error('品类图测试服务器启动超时');
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
});

test('品类示例房间图：/api/categories 里每个 defaultRoom 都得是真实存在的图', async () => {
  const res = await fetch(`${BASE_URL}/api/categories`);
  expect(res.ok, `/api/categories 返回 ${res.status}`).toBe(true);
  const body = await res.json();
  const cats = (body && body.data && body.data.categories) || body.categories || [];
  expect(cats.length, '一个品类都没有').toBeGreaterThan(0);

  const missing = [];
  for (const c of cats) {
    const url = c.defaultRoom;
    if (!url) continue;                       // 没配默认图是允许的（前端会引导上传）
    // 只校验站内静态图；外链/上传目录不在这里管
    if (!url.startsWith('/images/')) continue;
    const file = path.join(IMAGES_DIR, path.basename(url));
    if (!fs.existsSync(file)) {
      missing.push(`${c.id}(${c.name}) → ${url}`);
    }
  }
  expect(missing, `这些品类的默认图指向不存在的文件：${missing.join(' ; ')}`).toEqual([]);
});

test('server.js 的硬编码兜底表不能引用不存在的图（fresh install / data 丢失时会被写进 categories.json）', async () => {
  // 直接扫源码，不启服务：rsync 不同步 data/，兜底表的坏值会固化到生产且永不自愈
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'server.js'), 'utf8');
  const refs = [...src.matchAll(/\/images\/([A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp))/g)].map((m) => m[1]);
  expect(refs.length, 'server.js 里没扫到任何 /images 引用').toBeGreaterThan(0);

  const unique = [...new Set(refs)];
  const missing = unique.filter((f) => !fs.existsSync(path.join(IMAGES_DIR, f)));
  expect(missing, `server.js 引用了不存在的图片：${missing.join(', ')}`).toEqual([]);
});
