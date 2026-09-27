#!/usr/bin/env node
/**
 * tools/ingest-new.mjs —— 批量入库工具（team/spec/spec-v3.md 决策 6）
 *
 * 老板新拍一批家具图 → 丢进 data/new/沙发、data/new/床 → 跑这个脚本 →
 *   每张图走既有 `POST /api/admin/upload-and-identify`（AI 起名 + 落 products.json）
 *   → 新商品立刻 PATCH `status:"下架"`（待老板后台审价后再上架）
 *
 * 用法：
 *   node tools/ingest-new.mjs                      # 入库 data/new 下所有图
 *   node tools/ingest-new.mjs --dry-run            # 只列名单，不碰网络
 *   node tools/ingest-new.mjs --dir data/new/沙发   # 只入某个子目录
 *   node tools/ingest-new.mjs --base http://127.0.0.1:3300   # 指向别的部署
 *   node tools/ingest-new.mjs --skip 床/未命名.png  # 排除某张（可重复 / 逗号分隔）
 *
 * 环境变量（都不写死在脚本里，仅给 dev 默认值，见 src/server.js:55-56）：
 *   ADMIN_USER       默认 admin
 *   ADMIN_PASSWORD   默认 123456
 *
 * 退出码：0 = 全部成功 / dry-run；1 = 登录失败或某张入库失败（已保留断点，可重跑续传）；2 = 参数/目录错误。
 *
 * 三条硬线（spec-v3 决策 6）：
 *   1) 严格串行：products.json 的追加是「读-改-写」且非原子（src/server.js:2474-2501），
 *      并发上传会互相覆盖 → 本脚本 for-await 一张一张来，绝无 Promise.all。
 *   2) 失败即停：打印是哪一张、什么原因，tools/.ingested.json 已落盘 → 重跑自动跳过已入的。
 *   3) 全程「下架」待审，绝不直接上架。
 *
 * 断点表 tools/.ingested.json：`相对 --dir 的路径 -> {productId, at}`（先写 .tmp 再 rename）。
 *   特例：上传成功但 PATCH 失败时记为 `{productId, at, pendingOffline:true}`——
 *   那种商品没有 status 字段，前台当在售，必须去后台补「下架」。
 *
 * 服务端契约（写脚本时核对过，以 src/server.js 为准）：
 *   - POST   /api/admin/login            body {username, password} → Set-Cookie: yxjia_sid=…（server.js:3228 / 357 / 364）
 *   - POST   /api/admin/upload-and-identify  multipart: file(必填, .single('file')) + hint(可选) →
 *            {success:true,data:{ok:true,product:{id,…},url}}（server.js:2442）
 *   - PATCH  /api/admin/products/:id     body {status:'下架'} → {success:true,data:{product}}（server.js:1585）
 *   - requireAdmin 认 yxjia_sid cookie（server.js:3590）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIR = 'data/new';
const DEFAULT_BASE = 'http://127.0.0.1:3000';
const OFFLINE_STATUS = '下架';

// 断点记录：相对 --dir 的路径 -> {productId, at}
const STATE_FILE = fileURLToPath(new URL('./.ingested.json', import.meta.url));

// 上传允许的图片类型（与 server.js:493-494 UPLOAD_ALLOWED_MIME / UPLOAD_ALLOWED_EXT 对齐）
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

// 子目录名 → AI 命名提示词 + 期望 category。
// hint 是注入 doubao/step 识别 prompt 的自由文本（server.js:2338 `提示："${hint}"。`，
// server 侧没有固定词表），写中文子目录名即可让模型按「沙发/床」分类；
// 分类结果落 server.js:2408 的英文白名单 ['sofa','cabinet','bed','table','other']。
const CATEGORY_BY_SUBDIR = new Map([
  ['沙发', { hint: '沙发', category: 'sofa' }],
  ['sofa', { hint: '沙发', category: 'sofa' }],
  ['沙發', { hint: '沙发', category: 'sofa' }],
  ['床', { hint: '床', category: 'bed' }],
  ['床架', { hint: '床', category: 'bed' }],
  ['卧室', { hint: '床', category: 'bed' }],
  ['bed', { hint: '床', category: 'bed' }],
]);

const KNOWN_SUBDIRS = [...new Set([...CATEGORY_BY_SUBDIR.keys()])].join(' / ');

export function usage() {
  return [
    '批量入库工具：data/new/<品类子目录>/*.jpg → AI 起名入库 → 全部设为「下架」待审',
    '',
    '用法：',
    '  node tools/ingest-new.mjs [--dir data/new] [--base http://127.0.0.1:3000] [--dry-run]',
    '                         [--skip 相对路径] [--help]',
    '',
    '选项：',
    '  --dir <目录>    待入库图片根目录，子目录名=品类（默认 data/new）',
    '  --base <URL>    服务地址（默认 http://127.0.0.1:3000）',
    '  --dry-run       只列计划名单，不登录、不发任何请求',
    '  --skip <路径>   跳过某张图，可重复或逗号分隔（如 --skip 床/未命名.png）',
    '  -h, --help      打印本帮助',
    '',
    `已知子目录（其余跳过并告警）：${KNOWN_SUBDIRS}`,
    '断点记录：tools/.ingested.json（已入库的图会自动跳过，可反复重跑）',
    '环境变量：ADMIN_USER（默认 admin）/ ADMIN_PASSWORD（默认 123456，仅 dev 默认值）',
  ].join('\n');
}

/** 解析命令行参数；非法参数直接退出 2 */
export function parseArgs(argv = process.argv) {
  const opts = {
    dir: DEFAULT_DIR,
    base: DEFAULT_BASE,
    dryRun: false,
    skip: [],
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const takeValue = (name) => {
      if (inline !== null) return inline;
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error(`参数 ${name} 缺值。\n\n${usage()}`);
        process.exit(2);
      }
      i += 1;
      return next;
    };
    switch (key) {
      case '--dir':
        opts.dir = takeValue('--dir');
        break;
      case '--base':
        opts.base = takeValue('--base').replace(/\/+$/, '');
        break;
      case '--dry-run':
        opts.dryRun = inline === null ? true : inline !== 'false' && inline !== '0';
        break;
      case '--skip':
        opts.skip.push(...takeValue('--skip').split(',').map((s) => s.trim()).filter(Boolean));
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        console.error(`不认识的参数：${arg}\n\n${usage()}`);
        process.exit(2);
    }
  }
  return opts;
}

/** 子目录名 → {hint, category}；不认识返回 null */
export function hintForSubdir(name) {
  const hit = CATEGORY_BY_SUBDIR.get(name) || CATEGORY_BY_SUBDIR.get(String(name).toLowerCase());
  return hit ? { ...hit } : null;
}

/**
 * 扫 --dir，产出待入库名单。
 * 只收 .jpg/.jpeg/.png/.webp（.DS_Store 等自然被挡掉），不认识子目录/根目录散图都跳过并告警。
 */
export function planIngest(dir, { skip = [] } = {}) {
  const dirAbs = path.resolve(dir);
  const isSkipped = buildSkipMatcher(skip, dirAbs);
  const items = [];
  const unknownSubdirs = [];
  const rootFiles = [];
  const nonImageFiles = [];
  const skippedByName = [];

  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const mapped = hintForSubdir(entry.name);
      if (!mapped) {
        unknownSubdirs.push(entry.name);
        continue;
      }
      for (const file of fs.readdirSync(path.join(dirAbs, entry.name), { withFileTypes: true })) {
        if (!file.isFile()) continue;
        const rel = `${entry.name}/${file.name}`;
        const ext = path.extname(file.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) {
          nonImageFiles.push(rel);
          continue;
        }
        if (isSkipped(rel)) {
          skippedByName.push(rel);
          continue;
        }
        items.push({
          rel,
          abs: path.join(dirAbs, entry.name, file.name),
          ext,
          hint: mapped.hint,
          category: mapped.category,
        });
      }
    } else if (entry.isFile()) {
      rootFiles.push(entry.name);
    }
  }

  items.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { items, unknownSubdirs, rootFiles, nonImageFiles, skippedByName };
}

/** 读 --skip 名单：支持 相对品类子目录路径（沙发/x.jpg）、裸文件名（x.jpg）、带 --dir 前缀的路径 */
function buildSkipMatcher(skip = [], dirAbs = process.cwd()) {
  const prefix = path.basename(dirAbs);
  const rels = new Set();
  const names = new Set();
  for (const raw of skip) {
    const s = String(raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (!s) continue;
    const parts = s.split('/');
    if (parts.length === 1) names.add(parts[0]);
    else if (parts[0] === prefix) rels.add(parts.slice(1).join('/'));
    else rels.add(s);
  }
  return (rel) => rels.has(rel) || names.has(path.basename(rel));
}

/** 读断点表；文件不存在 / 内容损坏都当空表（宁可重传也不要漏传） */
export function loadIngestedMap(file = STATE_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    console.warn(`读 ${file} 失败（${err.message}），按空表处理`);
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v) out[k] = { productId: v, at: null };
      // pendingOffline:true = 上传成功但 PATCH 失败，商品还挂在"无 status（前台可见）"状态，需人工去后台改下架
      else if (v && typeof v === 'object' && v.productId) out[k] = { ...v, productId: v.productId, at: v.at ?? null };
    }
    return out;
  } catch (err) {
    console.warn(`${file} 不是合法 JSON（${err.message}），按空表处理`);
    return {};
  }
}

/** 写断点表（先写 .tmp 再 rename，避免半截文件把断点打丢） */
export function saveIngestedMap(map, file = STATE_FILE) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(map, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** 通用 JSON 请求；网络层错误也包成可读信息 */
async function requestJsonFull(url, options, what, { auth401 = true } = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new Error(`${what}请求失败（${url}）：${err.message}——服务起来了吗？MinIO/端口对吗？`);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应，后面按原文报 */
  }
  if (!res.ok) {
    const msg = (json && json.error) || text.slice(0, 200) || `HTTP ${res.status}`;
    const hint = res.status === 401 && auth401 ? '（登录态失效，重跑本脚本会自动重新登录）' : '';
    throw new Error(`${what}失败 HTTP ${res.status}：${msg}${hint}`);
  }
  if (!json || json.success !== true) {
    throw new Error(`${what}响应不正常：${(text || '(空)').slice(0, 200)}`);
  }
  return { res, json };
}

async function requestJson(url, options, what) {
  const { json } = await requestJsonFull(url, options, what);
  return json;
}

/** admin 登录，拿回可直接复用的 Cookie 头（脚本自己管 cookie，Node fetch 不存 cookie） */
export async function loginAdmin(base, { user, password }) {
  const { res, json } = await requestJsonFull(
    `${base}/api/admin/login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password }),
    },
    '后台登录',
    { auth401: false }, // 登录请求自己的 401 就是密码错，不需要"登录态失效"提示
  );
  const cookie = cookieFromResponse(res, json);
  if (!cookie) throw new Error('登录成功但没拿到会话（响应里既没有 Set-Cookie 也没有 data.token）');
  return cookie;
}

/**
 * 从登录响应里取 Cookie 头。
 * 优先用服务端真实下发的 Set-Cookie（server.js:364：`yxjia_sid=<token>; Path=/; HttpOnly…`），
 * 拿不到再退回 data.token 自己拼（cookie 名见 server.js:357 SESSION_COOKIE）。
 */
function cookieFromResponse(res, json) {
  let setCookies = [];
  try {
    setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  } catch {
    setCookies = [];
  }
  if (!setCookies.length) {
    const raw = res.headers.get('set-cookie');
    if (raw) setCookies = [raw];
  }
  for (const c of setCookies) {
    const pair = String(c).split(';')[0].trim();
    if (pair) return pair;
  }
  const token = json?.data?.token;
  return token ? `yxjia_sid=${token}` : null;
}

/** 上传一张图 + AI 识别（严格一张一请求，串行由调用方保证） */
export async function uploadAndIdentify(base, cookie, item) {
  const buffer = fs.readFileSync(item.abs);
  const mime = MIME_BY_EXT[item.ext] || 'application/octet-stream';
  const original = path.basename(item.abs);
  // undici 的 multipart 编码对非 ASCII 文件名会按 latin-1 落，busboy 解出来是乱码
  // （实测 "未命名.png" → "æºåå.png"）。server 侧只用 originalname 取扩展名
  // （safeImageExt, server.js:544）并马上重命名成 hex，所以非 ASCII 名换成同扩展名的
  // ASCII 名，避免乱码进日志/落库；扩展名始终保留（multer 认它）。
  const sendName = /^[\x20-\x7e]+$/.test(original) ? original : `furniture${item.ext}`;
  const form = new FormData();
  // 字段名必须是 file（server.js:2442 multer().single('file')），hint 是可选提示（server.js:2453）
  form.append('file', new Blob([buffer], { type: mime }), sendName);
  form.append('hint', item.hint);
  const json = await requestJson(
    `${base}/api/admin/upload-and-identify`,
    {
      method: 'POST',
      headers: { Cookie: cookie },
      // 不要手动设 Content-Type：fetch 会带 multipart boundary
      body: form,
    },
    `上传识别 ${item.rel}`,
  );
  const data = json.data || {};
  // server.js:2464-2472：AI 没认出来时也是 HTTP 200，ok:false，没有 product.id
  if (!data.ok || !data.product || !data.product.id) {
    throw new Error(`AI 识别失败：${data.aiError || data.message || '没拿到商品 id'}（图片可能已存进 MinIO，去后台手动填）`);
  }
  return { product: data.product, url: data.url };
}

/** 把新商品设为「下架」待审 */
export async function setProductStatus(base, cookie, id, status = OFFLINE_STATUS) {
  const json = await requestJson(
    `${base}/api/admin/products/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ status }),
    },
    `设置状态 ${id}`,
  );
  return json.data?.product || null;
}

function printSkips(plan) {
  if (plan.unknownSubdirs.length) {
    console.warn(`跳过未知子目录（只认 ${KNOWN_SUBDIRS}）：${plan.unknownSubdirs.join('、')}`);
  }
  if (plan.rootFiles.length) {
    console.warn(`跳过根目录下的散图（放进品类子目录才会入库）：${plan.rootFiles.join('、')}`);
  }
  if (plan.nonImageFiles.length) {
    console.warn(`跳过非图片文件：${plan.nonImageFiles.join('、')}`);
  }
  if (plan.skippedByName.length) {
    console.warn(`--skip 指定跳过：${plan.skippedByName.join('、')}`);
  }
}

export async function main(argv = process.argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(usage());
    return 0;
  }

  let stat;
  try {
    stat = fs.statSync(path.resolve(opts.dir));
  } catch {
    console.error(`目录不存在：${opts.dir}（用 --dir 指定）`);
    return 2;
  }
  if (!stat.isDirectory()) {
    console.error(`不是目录：${opts.dir}`);
    return 2;
  }

  let plan;
  try {
    plan = planIngest(path.resolve(opts.dir), { skip: opts.skip });
  } catch (err) {
    console.error(`扫描 ${opts.dir} 失败：${err.message}`);
    return 2;
  }

  const ingested = loadIngestedMap();
  const pending = plan.items.filter((it) => !ingested[it.rel]);
  const alreadyIngested = plan.items.length - pending.length;

  printSkips(plan);

  const summaryExtra = plan.skippedByName.length
    ? `（另有 ${plan.skippedByName.length} 张被 --skip 排除）`
    : '';

  if (opts.dryRun) {
    // 硬线：dry-run 不登录、不发任何请求、不写任何文件
    console.log(`[dry-run] 不会发任何请求。目录：${opts.dir}`);
    pending.forEach((it, i) => {
      console.log(`[${i + 1}/${pending.length}] ${opts.dir}/${it.rel} → 品类 ${it.hint}（category=${it.category}）`);
    });
    console.log(
      `[dry-run] 共 ${plan.items.length} 张候选图，其中 ${pending.length} 张待入库、` +
        `${alreadyIngested} 张已在 tools/.ingested.json 里（会跳过）${summaryExtra}。`,
    );
    return 0;
  }

  if (!pending.length) {
    console.log(`没有待入库的新图（${plan.items.length} 张候选全部已入库）。断点表：tools/.ingested.json`);
    return 0;
  }

  const user = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || '123456'; // dev 默认值，与 server.js:56 一致
  let cookie;
  try {
    console.log(`登录后台 ${opts.base}（用户 ${user}）…`);
    cookie = await loginAdmin(opts.base, { user, password });
    console.log('登录成功。\n');
  } catch (err) {
    console.error(`✗ ${err.message}`);
    console.error('  检查 ADMIN_USER / ADMIN_PASSWORD；连错 5 次 IP 会被锁 15 分钟（server.js:3205-3226）。');
    return 1;
  }

  console.log(`开始串行入库 ${pending.length} 张（一张一张来，避免 products.json 读-改-写互相覆盖）…\n`);
  let done = 0;
  for (let i = 0; i < pending.length; i += 1) {
    const item = pending[i];
    const label = `${opts.dir}/${item.rel}`;
    process.stdout.write(`[${i + 1}/${pending.length}] ${label} → 上传…`);
    let product = null;
    try {
      ({ product } = await uploadAndIdentify(opts.base, cookie, item));
      process.stdout.write(` → 识别为「${product.name || '未命名'}」`);
      const after = await setProductStatus(opts.base, cookie, product.id, OFFLINE_STATUS);
      if (after && after.status !== OFFLINE_STATUS) {
        console.warn(`\n  注意：PATCH 后 status=${after.status}，不是「${OFFLINE_STATUS}」`);
      }
      if (product.category && product.category !== item.category) {
        console.warn(`\n  注意：${item.rel} 在「${item.hint}」目录里，AI 却识别成 category=${product.category}`);
      }
      // 断点落盘（每张一写）：中途 crash / Ctrl-C 也不丢已入账的
      ingested[item.rel] = { productId: product.id, at: new Date().toISOString() };
      saveIngestedMap(ingested);
      done += 1;
      console.log(` → 已下架待审 (id=${product.id})`);
    } catch (err) {
      console.log('');
      // 上传已经成功、只是 PATCH 挂了：商品此刻在 products.json 里且**没有 status 字段**
      // （server.js:1566 把"无 status"当在售 → 前台可见）。必须记进断点表，否则重跑会
      // 再传一遍变成第二件商品；同时喊老板去后台补「下架」。
      if (product && product.id && !ingested[item.rel]) {
        ingested[item.rel] = {
          productId: product.id,
          at: new Date().toISOString(),
          pendingOffline: true,
        };
        saveIngestedMap(ingested);
        console.error(`  ⚠ ${product.id} 已入库但没改成「${OFFLINE_STATUS}」，现在前台是**可见/在售**状态！`);
        console.error('     已记进断点表（重跑不会重复上传），请去后台 /admin/products 手动改成「下架」。');
      }
      console.error(`\n✗ 入库中断在：${label}`);
      console.error(`  原因：${err.message}`);
      console.error(`  已完成 ${done}/${pending.length} 张；断点表已保留（tools/.ingested.json），`);
      console.error('  处理完这张图后重跑同一条命令即可从下一张续传。');
      console.error('  （若上传请求其实已成功只是响应丢了，重跑前先去后台确认一下有没有重复商品）');
      return 1;
    }
  }

  console.log(
    `\n完成：${done} 张已入库并设为「${OFFLINE_STATUS}」，等老板在后台审价后改「在售」。` +
      `（候选 ${plan.items.length} 张，此前已入库 ${alreadyIngested} 张）${summaryExtra}`,
  );
  return 0;
}

// 直接执行才跑（被 import 时不启动，方便测试）
const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`\n✗ ${err && err.message ? err.message : err}`);
      process.exitCode = 1;
    });
}
