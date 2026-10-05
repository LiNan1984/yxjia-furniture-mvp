import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Client as Minio } from 'minio';
import { WebSocket, WebSocketServer } from 'ws';
import {
  runShoppingGuideChat,
  streamShoppingGuideChat,
  configureOpenAIFromEnv,
  getChatProviderInfo,
  listOnSaleProducts,
  getStoreInfo,
} from './chat-guide-agent.js';
import { pushOrderToWechat } from './serverchan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const SELF_BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');
const GENERATIONS_FILE = path.join(DATA_DIR, 'generations.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const FEATURE_FLAGS_FILE = path.join(DATA_DIR, 'feature-flags.json');
const WHOLE_HOME_STYLES_FILE = path.join(DATA_DIR, 'whole-home-styles.json');
const SCENE_STYLES_FILE = path.join(DATA_DIR, 'scene-styles.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const PUBLIC_DIR = __dirname;
const IMAGES_DIR = path.join(ROOT, 'public', 'images');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

// 上传子目录（按类型归档，文件路径遵循 uploads/{type}/{uuid}.{ext}）
const UPLOAD_DIRS = {
  products: path.join(UPLOADS_DIR, 'products'),
  rooms: path.join(UPLOADS_DIR, 'rooms'),
  compositions: path.join(UPLOADS_DIR, 'compositions'),
  'default-rooms': path.join(UPLOADS_DIR, 'default-rooms'),
};

// TwoFish / gpt-image-2 端点（必须从环境变量读，不能在源码里硬编码）
// 启动时自动加载 .env（用 dotenv，但避免强依赖——失败时退回环境变量）
try { await import('dotenv').then(m=>m.config()).catch(()=>{}); } catch(_) {}
const TWO_FISH_API_KEY = process.env.TWO_FISH_API_KEY;
if (!TWO_FISH_API_KEY) console.warn('[warn] TWO_FISH_API_KEY 未设置：/api/tryon/ai-* 会进入兜底分支');
// 允许环境变量覆盖（测试指向本地 mock；生产默认两鱼官方端点）
const TWO_FISH_EDITS_URL = process.env.TWO_FISH_EDITS_URL || 'https://twofishai.com/v1/images/edits';

// 后台账号（生产环境必须从环境变量覆盖）
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// 验证码 MVP：固定 123456（生产请接真短信）
const FIXED_VERIFY_CODE = '123456';

// Server酱订单推送（新订单 → 老板微信）。密钥走 env 不落 data/；ORDER_PUSH=0 可整体关
const SERVERCHAN_SENDKEY = process.env.SERVERCHAN_SENDKEY || '';
const SERVERCHAN_API_BASE = process.env.SERVERCHAN_API_BASE || 'https://sctapi.ftqq.com';
const ORDER_PUSH_ENABLED = process.env.ORDER_PUSH !== '0';
if (SERVERCHAN_SENDKEY && ORDER_PUSH_ENABLED) console.info('[serverchan] 订单推送已开启（新订单 → 微信）');

// ---------- MinIO 对象存储 ----------
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '127.0.0.1';
const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || `http://${MINIO_ENDPOINT}:${MINIO_PORT}`;
const BUCKET = process.env.MINIO_BUCKET || 'yxjia-uploads';

// MinIO 凭证必须从环境变量读（生产部署有 .env）
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY;
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY;
if (!MINIO_ACCESS_KEY || !MINIO_SECRET_KEY) {
  console.warn('[warn] MINIO_ACCESS_KEY / MINIO_SECRET_KEY 未设置：上传将失败');
}

const minioClient = new Minio({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: false,
  accessKey: MINIO_ACCESS_KEY || 'minio',
  secretKey: MINIO_SECRET_KEY || 'minio',
});

// 把 bucket 设为 public read（一次性、幂等：失败也只警告，不影响 fallback）
async function ensureBucketPublic() {
  try {
    const exists = await minioClient.bucketExists(BUCKET);
    if (!exists) {
      await minioClient.makeBucket(BUCKET, 'us-east-1');
    }
    const policy = {
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      }],
    };
    await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
  } catch (err) {
    console.warn(`[minio] ensureBucketPublic failed: ${err.message} (将走本地 fallback)`);
  }
}

/** @typedef {{success: true, data?: any} | {success: false, error: string}} ApiResponse */

function ensureDirs() {
  Object.values(UPLOAD_DIRS).forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
  for (const file of [USERS_FILE, UPLOADS_FILE]) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ users: [], uploads: [] }, null, 2), 'utf-8');
    }
  }
  if (!fs.existsSync(PRESETS_FILE)) {
    const defaults = {
      presets: [
        { id: 'default', name: '自然摆放', prompt: '' },
        { id: 'sunlight', name: '暖光氛围', prompt: '强调午后暖阳光洒入室内，家具表面有温柔金色光斑，氛围温暖' },
        { id: 'night', name: '夜晚温馨', prompt: '夜晚场景，室内开暖色灯光，家具在柔和光线下显得安稳温馨' },
        { id: 'minimal', name: '极简留白', prompt: '空间保持极简风，家具居中突出，周围大量留白，背景干净整洁' },
        { id: 'family', name: '家庭生活', prompt: '有生活气息的家庭环境，家具自然摆放，地面有地毯，真实住家的样子' },
      ],
    };
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
  }
  if (!fs.existsSync(SCENE_STYLES_FILE)) {
    // v2 场景图工厂风格卡（与试摆 presets.json 独立，品类中性，scene 字段按 category 在拼 prompt 时覆盖）
    const sceneDefaults = {
      styles: [
        { id: 'daylight', name: '明亮家居', scene: '客厅', prompt: '白天自然光，窗外光线柔和，家具摆在采光好的位置，画面干净通透' },
        { id: 'warmlight', name: '暖光氛围', scene: '客厅', prompt: '傍晚暖黄灯光，家具表面有温暖光斑，氛围温馨' },
        { id: 'night', name: '夜晚温馨', scene: '客厅', prompt: '夜晚室内，暖色台灯照明，家具在柔和灯光下显得安稳' },
        { id: 'minimal', name: '极简留白', scene: '客厅', prompt: '极简风格空间，大量留白，家具居中突出，背景干净' },
        { id: 'family', name: '家庭生活', scene: '客厅', prompt: '有生活气息的家庭环境，茶几上有茶杯书本，地面有地毯，真实住家的样子' },
      ],
    };
    fs.writeFileSync(SCENE_STYLES_FILE, JSON.stringify(sceneDefaults, null, 2), 'utf-8');
  }
  if (!fs.existsSync(CATEGORIES_FILE)) {
    // v3 品类/板块配置：英文 id 对齐 upload-and-identify 白名单；room/noun 驱动试摆默认 prompt；defaultRoom 前端默认图
    const categoryDefaults = {
      categories: [
        { id: 'sofa', name: '沙发', room: '客厅', noun: '沙发', defaultRoom: '/images/default-room.jpg', badge: '主推', sort: 1, enabled: true },
        { id: 'bed', name: '卧室 · 床', room: '卧室', noun: '床', defaultRoom: '/images/default-room-bed.jpg', sort: 2, enabled: true },
        { id: 'cabinet', name: '柜类', room: '客厅', noun: '柜子', defaultRoom: '/images/default-room.jpg', sort: 3, enabled: false },
        { id: 'table', name: '桌几', room: '餐厅', noun: '桌子', defaultRoom: '/images/default-room.jpg', sort: 4, enabled: false },
        { id: 'other', name: '其他', room: '客厅', noun: '家具', defaultRoom: '/images/default-room.jpg', sort: 9, enabled: false },
      ],
    };
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(categoryDefaults, null, 2), 'utf-8');
  }
  if (!fs.existsSync(FEATURE_FLAGS_FILE)) {
    // 默认配置：试摆必须填手机号（无后端验证，仅前端 + 开关文件）
    fs.writeFileSync(FEATURE_FLAGS_FILE, JSON.stringify({
      tryonRequirePhone: true,
      tryonRequirePhoneMessage: '请先填手机号再试摆，方便店员联系您看效果',
    }, null, 2), 'utf-8');
  }
}
ensureDirs();

function readJSON(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8');
  return JSON.parse(content);
}

function writeJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
}

function generateId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isValidPhone(phone) {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

function loadStore() {
  return readJSON(PRODUCTS_FILE);
}

function getProducts() {
  const data = loadStore();
  const list = Array.isArray(data) ? data : data.products;
  return list.map(normalizeProduct);
}

function findProduct(id) {
  return getProducts().find(p => p.id === id);
}

function normalizeProduct(p) {
  if (!p) return p;
  const out = { ...p };
  if (out.image) out.image = fixImageUrl(out.image);
  if (Array.isArray(out.images)) out.images = out.images.map(fixImageUrl);
  // v2 场景图条目里的 url 同样剥成相对路径，避免顾客端拿到 127.0.0.1:9000 绝对地址
  if (Array.isArray(out.sceneImages)) {
    out.sceneImages = out.sceneImages
      .filter(s => s && typeof s === 'object')
      .map(s => ({ ...s, url: fixImageUrl(s.url) }));
  }
  // 读取时顺手剥掉 highlights 里的机器噪音（旧商品的 "AI 识别于 …"，无需数据迁移）
  if (Array.isArray(out.highlights)) {
    out.highlights = out.highlights.filter(h => !/^AI 识别于/.test(String(h || '')));
  }
  return out;
}

function loadContainer(file, defaultKey) {
  try {
    return readJSON(file);
  } catch (err) {
    return { [defaultKey]: [] };
  }
}

function saveContainer(file, container) {
  writeJSON(file, container);
}

function loadOrdersContainer() {
  return loadContainer(ORDERS_FILE, 'orders');
}

function saveOrdersContainer(container) {
  saveContainer(ORDERS_FILE, container);
}

function loadUsersContainer() {
  return loadContainer(USERS_FILE, 'users');
}

function saveUsersContainer(container) {
  saveContainer(USERS_FILE, container);
}

function loadUploadsContainer() {
  return loadContainer(UPLOADS_FILE, 'uploads');
}

function saveUploadsContainer(container) {
  saveContainer(UPLOADS_FILE, container);
}

// ---------- 生成历史「表」 data/generations.json（gitignore 排除，含手机号/提示词）----------
// 每次试摆落一条：最终 prompt、状态、失败原因、全链路 trace（各上游步 + 耗时 + 返回）。
// 支撑「每个登录用户看到自己历史生成图 + 当时提示词」并能逐条 trace 成功/失败/兜底原因。
function loadGenerationsContainer() {
  return loadContainer(GENERATIONS_FILE, 'generations');
}

function saveGenerationsContainer(container) {
  saveContainer(GENERATIONS_FILE, container);
}

const GENERATIONS_CAP = 3000; // 防无限增长，只保留最近 3000 条
// rec: { userPhone, kind, endpoint, productId, productName, preset, prompt,
//        status, demoType, compositionUrl, error, trace, totalMs, meta }
function recordGeneration(rec) {
  try {
    const c = loadGenerationsContainer();
    if (!Array.isArray(c.generations)) c.generations = [];
    const row = { id: generateId('gen'), createdAt: new Date().toISOString(), ...rec };
    c.generations.unshift(row);
    if (c.generations.length > GENERATIONS_CAP) c.generations.length = GENERATIONS_CAP;
    saveGenerationsContainer(c);
    return row.id;
  } catch (err) {
    console.warn('[generations] recordGeneration failed: ' + err.message);
    return null;
  }
}

// 生成记录状态：success=真合成(ai-composition/step/pollinations)；fallback=命中缓存/侧边/仅商品图兜底；failed=无图
function genStatus(demoType, hasUrl) {
  if (!hasUrl) return 'failed';
  return ['ai-composition', 'step-image', 'pollinations'].includes(demoType) ? 'success' : 'fallback';
}

function loadPresets() {
  try {
    const data = readJSON(PRESETS_FILE);
    return Array.isArray(data) ? data : (data.presets || []);
  } catch (err) {
    return [];
  }
}

function savePresets(presets) {
  writeJSON(PRESETS_FILE, { presets });
}

// v2 场景图风格卡（data/scene-styles.json，与试摆 presets 互相独立）
function loadSceneStyles() {
  try {
    const data = readJSON(SCENE_STYLES_FILE);
    const list = Array.isArray(data) ? data : (data.styles || []);
    return list.slice();
  } catch (err) {
    return [];
  }
}

function findSceneStyle(id) {
  return loadSceneStyles().find(s => s.id === id);
}

// ---------- 品类 / 板块配置（v3 多品类地基）----------
// data/categories.json：首页"板块"渲染 + 试摆品类化的唯一数据源。英文 id 对齐 upload-and-identify 白名单。
const CATEGORY_IDS = ['sofa', 'cabinet', 'bed', 'table', 'other'];

function loadCategories() {
  try {
    const data = readJSON(CATEGORIES_FILE);
    const list = Array.isArray(data) ? data : (data.categories || []);
    return list
      .filter(Boolean)
      .slice()
      .sort((a, b) => (a.sort || 999) - (b.sort || 999));
  } catch (err) {
    return [];
  }
}

// 写回 data/categories.json（容器形态 { categories: [...] }，与 loadCategories 对应）
function saveCategories(categories) {
  writeJSON(CATEGORIES_FILE, { categories });
}

// 商品品类归一：优先商品自带 category（英文 id）；缺省按 id 前缀猜；再缺省 'sofa'（旧商品向后兼容）
function categoryForProduct(product) {
  const cat = String(product?.category || '').toLowerCase();
  if (CATEGORY_IDS.includes(cat)) return cat;
  const prefix = String(product?.id || '').toLowerCase().split('-')[0];
  if (CATEGORY_IDS.includes(prefix)) return prefix;
  return 'sofa';
}

// 品类上下文：房间名 / 名词 / 默认房间图。驱动试摆默认 prompt（后端）与默认图（前端）。
function tryonCategoryContext(product) {
  const id = categoryForProduct(product);
  const cat = loadCategories().find(c => c.id === id) || {};
  const room = cat.room || (id === 'bed' ? '卧室' : id === 'table' ? '餐厅' : '客厅');
  const noun = cat.noun || (id === 'bed' ? '床' : id === 'table' ? '桌子' : id === 'cabinet' ? '柜子' : '沙发');
  const defaultRoom = cat.defaultRoom || '/images/default-room.jpg';
  return { id, room, noun, defaultRoom };
}

// 品类感知的试摆默认摆放指令。sofa 分支与原写死串逐字一致（零回归），bed/table 自动换房间/名词。
function buildTryonDefaultPrompt(product) {
  const { room, noun } = tryonCategoryContext(product);
  return `把第二张图里的「${product.name}」自然摆放到第一张图的${room}场景，保持${room}光线、墙面、地板、家具风格不变。${noun}按透视与光影融入，整体看起来像实拍照片，高清、温馨。`;
}

// ---------- 试摆「光线/风格预设」解析 ----------
// 前端会把它选中的 preset 一起发过来（可能是 id 也可能是中文名），以前后端只读 prompt，
// 预设描述从未参与合成。这里把预设描述拼进最终 prompt 送给 callTryonAI。
// 数据源：data/presets.json（GET /api/tryon/presets 公开的那 5 个）优先；
// 找不到再退回 v2 场景卡 data/scene-styles.json（id 形如 daylight / warmlight）。
// preset 为空、或预设描述本身为空（如「自然摆放」prompt 为 ''）时返回 null，
// 调用方行为与改造前完全一致（只靠默认 prompt + 用户自定义 prompt）。
function resolveTryonPreset(presetRaw) {
  const raw = typeof presetRaw === 'string' ? presetRaw.trim() : '';
  if (!raw) return null;
  let hit = loadPresets().find(p => p && (p.id === raw || p.name === raw));
  if (!hit) hit = loadSceneStyles().find(s => s && (s.id === raw || s.name === raw));
  if (!hit) return null;
  const desc = String(hit.prompt || '').trim();
  if (!desc) return null; // 「自然摆放」这类空描述预设：等于没选
  return { id: hit.id || raw, name: hit.name || raw, prompt: desc };
}

// 组装最终合成 prompt：默认摆放指令 + 预设光线/风格描述 + 用户自定义要求
// 返回 { finalPrompt, preset }，preset 为命中到的预设（未命中为 null，便于回显/排查）
function buildFinalTryonPrompt(defaultPrompt, presetRaw, customPrompt) {
  const parts = [String(defaultPrompt || '').trim()].filter(Boolean);
  const preset = resolveTryonPreset(presetRaw);
  if (preset) parts.push(`光线/风格预设「${preset.name}」：${preset.prompt}`);
  const custom = typeof customPrompt === 'string' ? customPrompt.trim() : '';
  if (custom) parts.push(`用户额外要求：${custom}`);
  return { finalPrompt: parts.join(' '), preset: preset || null };
}

// 风格卡场景按商品品类覆盖：床→卧室、桌/台→餐厅，其余用风格卡自带 scene（默认客厅）
function sceneRoomForProduct(product, style) {
  const category = String(product?.category || '').toLowerCase();
  if (category === 'bed') return '卧室';
  if (category === 'table') return '餐厅';
  return style?.scene || '客厅';
}

// 读取功能开关（前端根据这个决定是否强制手机号、是否显示某按钮等）
function loadFeatureFlags() {
  try {
    return readJSON(FEATURE_FLAGS_FILE);
  } catch (err) {
    return { tryonRequirePhone: false };
  }
}

// 读取全屋定制风格卡（商洛本地化 6 款，按 priority 升序）
function loadWholeHomeStyles() {
  try {
    const data = readJSON(WHOLE_HOME_STYLES_FILE);
    const list = Array.isArray(data) ? data : (data.styles || []);
    return list
      .slice()
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
  } catch (err) {
    console.warn('[whole-home] loadWholeHomeStyles failed: ' + err.message);
    return [];
  }
}

function findWholeHomeStyle(id) {
  return loadWholeHomeStyles().find(s => s.id === id);
}

function ok(res, data, status = 200) {
  /** @type {ApiResponse} */
  const body = { success: true, data };
  res.status(status).json(body);
}

function fail(res, status, message) {
  /** @type {ApiResponse} */
  const body = { success: false, error: message };
  res.status(status).json(body);
}

function validateOrder(body) {
  if (!body || typeof body !== 'object') return '请求体无效';
  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') return '称呼必填';
  if (!isValidPhone(body.phone)) return '手机号格式不对';
  if (!body.productId || typeof body.productId !== 'string') return '商品必填';
  if (!findProduct(body.productId)) return '商品不存在';
  return null;
}

// ---------- Session (cookie 简易实现) ----------

const SESSIONS = new Map(); // token -> { userId | 'admin', createdAt }
const SESSION_COOKIE = 'yxjia_sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function makeToken() {
  return crypto.randomBytes(24).toString('hex');
}

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function getSession(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(p => p.startsWith(`${SESSION_COOKIE}=`));
  if (!match) return null;
  const token = match.split('=')[1];
  const session = SESSIONS.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    SESSIONS.delete(token);
    return null;
  }
  return { token, ...session };
}

function attachSession(userId) {
  const token = makeToken();
  SESSIONS.set(token, { userId, createdAt: Date.now() });
  return token;
}

// ---------- 限流 Map 防内存膨胀 ----------
// 各 IP 限流 Map（chatGuideHits / voiceHits / anonTryonHits / wholeHomeHits / voiceRtConnLog）
// 的 key 会随来访 IP 无限增长。超过阈值时统一清掉已过期项，避免长时间运行把内存吃满。
const HITS_MAP_MAX_KEYS = 5000;

function pruneHitsMap(map, windowMs, maxKeys = HITS_MAP_MAX_KEYS) {
  if (map.size <= maxKeys) return;
  const cutoff = Date.now() - windowMs;
  for (const [key, arr] of map) {
    const kept = (arr || []).filter((t) => t >= cutoff);
    if (kept.length) map.set(key, kept);
    else map.delete(key);
  }
}

// 计数型 Map（如 voiceRtPerIp 的并发数）只清理归零的 key
function pruneCounterMap(map, maxKeys = HITS_MAP_MAX_KEYS) {
  if (map.size <= maxKeys) return;
  for (const [key, n] of map) {
    if (!n) map.delete(key);
  }
}

// ---------- 简易 multipart 解析（不依赖 multer / busboy） ----------
// 仅处理表单字段 + 单个文件表单（够 MVP 用）。

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const ctype = req.headers['content-type'] || '';
    const m = ctype.match(/^multipart\/form-data;\s*boundary=(.+)$/);
    if (!m) return reject(new Error('not multipart'));
    const boundary = '--' + m[1];
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const parts = [];
        let pos = 0;
        let iter = 0;
        while (pos < buf.length) {
          iter++;
          if (iter > 50) break;
          const start = buf.indexOf(boundary, pos);
          if (start === -1) break;
          const end = buf.indexOf(boundary, start + boundary.length);
          if (end === -1) break;
          const section = buf.slice(start + boundary.length, end);
          // section: \r\n<header>\r\n\r\n<body>\r\n
          const headerEnd = section.indexOf('\r\n\r\n');
          if (headerEnd === -1) {
            // 没有 header，正负零推进到结束 boundary（避免死循环）
            pos = end + boundary.length;
            continue;
          }
          const headerBuf = section.slice(0, headerEnd).toString('utf-8');
          let body = section.slice(headerEnd + 4, section.length - 2); // strip trailing \r\n
          const cdMatch = headerBuf.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
          if (!cdMatch) {
            pos = end + boundary.length;
            continue;
          }
          const name = cdMatch[1];
          const filename = cdMatch[2] || '';
          const ctMatch = headerBuf.match(/Content-Type:\s*([^\r\n]+)/i);
          const contentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
          if (filename) {
            parts.push({ name, filename, contentType, data: body, isFile: true });
          } else {
            parts.push({ name, value: body.toString('utf-8'), isFile: false });
          }
          // 关键：下一个 boundary 就是当前 section 的 END boundary，
          // 下一次循环需在 end 上重新查找 才能找到后面的 boundary
          pos = end;
        }
        resolve(parts);
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function getMultipartField(parts, name) {
  const p = parts.find(x => x.name === name && !x.isFile);
  return p ? p.value : '';
}

function getMultipartFile(parts, name) {
  return parts.find(x => x.name === name && x.isFile);
}

// ---------- 上传文件校验（类型白名单 + 大小上限） ----------
// parseMultipart 路径没有 multer 的 limits，只能自己拦：
//   - 大小上限 15MB（与 multer 路径一致）
//   - 只允许 jpg/jpeg/png/webp；明确拒绝 svg / html（存储型 XSS：浏览器打开 /uploads/*.svg 会执行脚本）
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
const UPLOAD_ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const UPLOAD_ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

// 返回空串 / null 表示通过，否则返回中文错误信息
// 兼容两种 file 结构：parseMultipart 的 {data, filename, contentType} 和 multer 的 {buffer, originalname, mimetype}
function checkUploadFile(file) {
  const buf = file ? (file.data || file.buffer) : null;
  if (!buf || buf.length === 0) return '请选择要上传的文件';
  if (buf.length > UPLOAD_MAX_BYTES) return '图片不能超过 15MB，请压缩后重传';
  const name = file.filename || file.originalname || '';
  const mime = String(file.contentType || file.mimetype || '').toLowerCase().split(';')[0].trim();
  const ext = path.extname(name).toLowerCase();
  // 扩展名黑名单优先：svg / html 一律拒（即使 mime 写的是 image/jpeg）
  if (['.svg', '.html', '.htm', '.xhtml', '.xml', '.js'].includes(ext)) {
    return '只支持 jpg / png / webp 图片';
  }
  const mimeOk = UPLOAD_ALLOWED_MIME.has(mime)
    // 部分客户端只会发 application/octet-stream，此时要求扩展名也在白名单里
    || (mime === 'application/octet-stream' && UPLOAD_ALLOWED_EXT.includes(ext));
  if (!mimeOk) return '只支持 jpg / png / webp 图片';
  // 魔术字节兜底：拒掉把 svg / html 伪装成图片的内容
  const head = buf.slice(0, 128).toString('utf-8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    return '只支持 jpg / png / webp 图片';
  }
  return null;
}

function saveUpload(file, type) {
  // 文件路径遵循 uploads/{type}/{uuid}.{ext}
  const dir = UPLOAD_DIRS[type];
  if (!dir) throw new Error(`unsupported upload type: ${type}`);
  // 兜底：扩展名只保留白名单内的，避免 .svg/.html 之类被原样落盘
  let ext = (path.extname(file.filename || '') || mimeToExt(file.contentType) || '.bin').toLowerCase();
  if (!UPLOAD_ALLOWED_EXT.includes(ext)) ext = mimeToExt(file.contentType) || '.jpg';
  const uuid = crypto.randomBytes(8).toString('hex');
  const filename = `${uuid}${ext}`;
  // MinIO 优先；不可用时回写本地磁盘（保持 /uploads/* 旧 URL 可用）
  return saveImage(file.data, type, filename, file.contentType || 'image/jpeg');
}

function mimeToExt(mime) {
  if (!mime) return '';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return '';
}

// 落盘扩展名 clamp：只允许白名单内的（.jpg/.jpeg/.png/.webp），其余一律回落 .jpg
// 防双扩展名（a.svg.jpg / a.jpg.svg）和大小写（.PNG / .Svg）绕过
function safeImageExt(originalname, mimetype) {
  const ext = path.extname(String(originalname || '')).toLowerCase();
  if (UPLOAD_ALLOWED_EXT.includes(ext)) return ext;
  const fromMime = mimeToExt(String(mimetype || '').toLowerCase());
  return fromMime || '.jpg';
}

// MinIO 写入：成功返回公开 URL，失败抛错
async function uploadToMinio(buffer, objectName, contentType = 'image/jpeg') {
  await minioClient.putObject(BUCKET, objectName, buffer, buffer.length, {
    'Content-Type': contentType,
  });
  return `${MINIO_PUBLIC_URL}/${BUCKET}/${objectName}`;
}

// 修正存储中的 MinIO 公开 URL：去掉 host 和 bucket 名，让浏览器走相对路径（由 /uploads/* 中间件代理）
function fixImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // 形如 http://127.0.0.1:9000/yxjia-uploads/products/xxx.png → /uploads/products/xxx.png
  const i = url.indexOf(`/${BUCKET}/`);
  if (i !== -1) return '/uploads/' + url.slice(i + BUCKET.length + 2);
  return url;
}

// 统一存储入口：MinIO 优先，失败 fallback 到本地
async function saveImage(buffer, type, filename, contentType = 'image/jpeg') {
  const objectName = `${type}/${filename}`;
  try {
    const url = await uploadToMinio(buffer, objectName, contentType);
    return { filename, objectName, url: fixImageUrl(url), storage: 'minio' };
  } catch (err) {
    console.warn(`[minio] putObject ${objectName} 失败，回退本地: ${err.message}`);
    const dir = UPLOAD_DIRS[type];
    if (!dir) throw new Error(`unsupported upload type: ${type}`);
    const fullPath = path.join(dir, filename);
    fs.writeFileSync(fullPath, buffer);
    return { filename, fullPath, url: `/uploads/${type}/${filename}`, storage: 'local' };
  }
}

// ---------- TwoFish / gpt-image-2 调用 ----------
//   设计要点：
//   1) 优先调 twofishai /v1/images/edits（gpt-image-2 写真合成）
//   2) 上游失败时回退到 uploads/compositions/ 里**为该 productId 生成过**的合成图
//      （通过 uploads.json 的 type=composition 记录的 productId 字段匹配，避免「按哈希乱拿」导致选错商品）
//   3) 还找不到则用商品自己上传的原图做 demo，再不行就抛错

// 找 uploads/compositions/ 中标记为该 productId 的历史合成图
function pickCachedCompositionForProduct(productId) {
  try {
    const dir = UPLOAD_DIRS.compositions;
    if (!fs.existsSync(dir)) return null;
    // 读 uploads.json 拿到 filename → productId 映射
    let productIdByFilename = new Map();
    try {
      const uploads = loadUploadsContainer().uploads;
      for (const u of uploads) {
        if (u.type === 'composition' && u.filename && u.productId) {
          productIdByFilename.set(u.filename, u.productId);
        }
      }
    } catch (_) { /* 文件读不到就当空 map */ }
    const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg)$/i.test(f));
    // 优先匹配 productId 的；多个就随机选一张
    const matching = files.filter(f => productIdByFilename.get(f) === productId);
    if (matching.length > 0) {
      const picked = matching[Math.floor(Math.random() * matching.length)];
      return { buffer: Buffer.from(fs.readFileSync(path.join(dir, picked))), source: 'cached-composition' };
    }
    return null;
  } catch (err) {
    console.warn('[fallback] pickCachedCompositionForProduct failed: ' + err.message);
    return null;
  }
}

// 拿商品自己上传的原图（products.json 的 image 字段）。失败返回 null
async function fetchProductImage(productId) {
  const product = findProduct(productId);
  if (!product || !product.image) return null;
  try {
    const productUrl = new URL(product.image, SELF_BASE);
    const r = await fetch(productUrl);
    if (!r.ok) return null;
    const arr = new Uint8Array(await r.arrayBuffer());
    return Buffer.from(arr);
  } catch (_) {
    return null;
  }
}

// 把客户客厅 + 新沙发做 side-by-side 对比预览（AI 不可用时使用）
// 不做覆盖式合成（那会得到"两张沙发"），而是把两个真实图并排放，附加文字标签
async function composeRoomAndProduct(roomBuffer, productBuffer) {
  const { default: sharp } = await import('sharp');
  const targetH = 720;
  const [roomScaled, productScaled] = await Promise.all([
    sharp(roomBuffer).resize({ height: targetH, withoutEnlargement: true }).png().toBuffer(),
    sharp(productBuffer).resize({ height: targetH, withoutEnlargement: true }).png().toBuffer(),
  ]);
  const roomMeta = await sharp(roomScaled).metadata();
  const productMeta = await sharp(productScaled).metadata();

  const gap = 16;
  const labelH = 56;
  const totalW = roomMeta.width + productMeta.width + gap;
  const totalH = targetH + labelH;

  const leftLabel = `<svg xmlns="http://www.w3.org/2000/svg" width="${roomMeta.width}" height="${labelH}">
    <rect width="100%" height="100%" fill="#3a2818"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="PingFang SC,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#faf6ef">您的客厅（原图）</text>
  </svg>`;
  const rightLabel = `<svg xmlns="http://www.w3.org/2000/svg" width="${productMeta.width}" height="${labelH}">
    <rect width="100%" height="100%" fill="#3a2818"/>
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="PingFang SC,Helvetica,sans-serif" font-size="22" font-weight="700" fill="#faf6ef">新沙发预览</text>
  </svg>`;

  return await sharp({
    create: { width: totalW, height: totalH, channels: 3, background: { r: 250, g: 246, b: 239 } },
  })
    .composite([
      { input: roomScaled, left: 0, top: 0 },
      { input: productScaled, left: roomMeta.width + gap, top: 0 },
      { input: Buffer.from(leftLabel), left: 0, top: targetH },
      { input: Buffer.from(rightLabel), left: roomMeta.width + gap, top: targetH },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// twofishai edits 只收小图：手机上传的客厅照动辄 3–8MB / 3000–4000px，
// 原样发会被拒（HTTP 400 invalid_image_file）。长边压到 1024 + JPEG q85，同时卡住尺寸和体积。
async function shrinkForAI(buf) {
  const { default: sharp } = await import('sharp');
  return sharp(buf)
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

// callTryonAI 返回结构化结果：{ buffer, demoType }
// demoType:
//   'ai-composition'      TWO_FISH 真合成成功
//   'step-image'          阶跃 step-image-edit-2 真合成（兜底；官方 2026-10-10 停服）
//   'pollinations'        Pollinations.ai 真实图生图（公共免 key 兜底）
//   'cached-composition'  命中 uploads.json 里该 productId 的历史合成图
//   'side-by-side'        side-by-side 客厅+商品 预览
//   'product-image'       仅商品图
async function callTryonAI({ productId, roomBuffer, sofaBuffer, productImagePath, prompt, trace }) {
  const T = Array.isArray(trace) ? trace : [];
  const _log = (step, info) => T.push({ at: new Date().toISOString(), step, ...info });
  _log('input', { ok: true, roomBytes: roomBuffer ? roomBuffer.length : 0, sofaBytes: sofaBuffer ? sofaBuffer.length : 0 });
  // 1) TWO_FISH / gpt-image-2（主路径，账号池已恢复）
  if (TWO_FISH_API_KEY) {
    const _t = Date.now();
    try {
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', prompt || buildTryonPrompt(productId));
      form.append('size', '1024x1024');
      const sofaBuf = sofaBuffer || await fetchProductImage(productId);
      const [roomSmall, sofaSmall] = await Promise.all([shrinkForAI(roomBuffer), shrinkForAI(sofaBuf)]);
      form.append('image[]', new Blob([roomSmall], { type: 'image/jpeg' }), 'room.jpg');
      form.append('image[]', new Blob([sofaSmall], { type: 'image/jpeg' }), 'sofa.jpg');

      const resp = await fetch(TWO_FISH_EDITS_URL, {
        method: 'POST',
        headers: { 'x-api-key': TWO_FISH_API_KEY },
        body: form,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`TwoFish API ${resp.status}: ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const item = data?.data?.[0];
      if (!item) throw new Error('TwoFish returned empty data');
      let buf;
      if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
      else if (item.url) {
        const imgResp = await fetch(item.url);
        buf = Buffer.from(new Uint8Array(await imgResp.arrayBuffer()));
      }
      if (buf && buf.length > 0) {
        _log('twofishai:edits', { ok: true, ms: Date.now() - _t, bytes: buf.length });
        return { buffer: buf, demoType: 'ai-composition', trace: T };
      }
      throw new Error('TwoFish response unrecognized shape');
    } catch (err) {
      console.warn(`[ai] twofishai failed: ${err.message}`);
      _log('twofishai:edits', { ok: false, ms: Date.now() - _t, body: err.message });
    }
  } else {
    _log('twofishai:edits', { ok: false, skipped: true, body: 'TWO_FISH_API_KEY 未设置' });
  }
  // 2) 阶跃 step-image-edit-2 兜底（Pro 套餐 Step Plan 路径；官方 2026-10-10 停服，失效后自动滑向下一级）
  if (STEP_API_KEY && roomBuffer && (sofaBuffer || productImagePath)) {
    const _t = Date.now();
    try {
      const sofaBuf = sofaBuffer || await fetchProductImage(productId);
      const buf = await callStepImageEdit({ roomBuffer, sofaBuffer: sofaBuf, prompt, productId });
      if (buf && buf.length > 0) {
        _log('step-image', { ok: true, ms: Date.now() - _t, bytes: buf.length });
        return { buffer: buf, demoType: 'step-image', trace: T };
      }
      _log('step-image', { ok: false, ms: Date.now() - _t, body: 'empty buffer' });
    } catch (e) {
      console.warn('[ai] step-image-edit-2 failed: ' + e.message);
      _log('step-image', { ok: false, ms: Date.now() - _t, body: e.message });
    }
  }

  // 3) Pollinations 兜底（两鱼、阶跃都失败时启用）
  if (roomBuffer) {
    const _t = Date.now();
    try {
      const buf = await callPollinations({ productId, roomBuffer, prompt });
      if (buf) {
        _log('pollinations', { ok: true, ms: Date.now() - _t, bytes: buf.length });
        return { buffer: buf, demoType: 'ai-composition', trace: T };
      }
      _log('pollinations', { ok: false, ms: Date.now() - _t, body: 'empty buffer' });
    } catch (e) {
      console.warn('[ai] gpt-image-2 via Pollinations failed: ' + e.message);
      _log('pollinations', { ok: false, ms: Date.now() - _t, body: e.message });
    }
  }

  // 4) 该 productId 的历史合成图
  const cached = pickCachedCompositionForProduct(productId);
  if (cached) {
    _log('cached-composition', { ok: true, note: `productId=${productId} 命中历史合成图` });
    return { buffer: cached.buffer, demoType: 'cached-composition', trace: T };
  }

  // 5) side-by-side 预览
  const productImg = await fetchProductImage(productId);
  if (productImg && roomBuffer) {
    const _t = Date.now();
    try {
      const sideBySide = await composeRoomAndProduct(roomBuffer, productImg);
      _log('side-by-side', { ok: true, ms: Date.now() - _t });
      return { buffer: sideBySide, demoType: 'side-by-side', trace: T };
    } catch (e) {
      console.warn('[fallback] composeRoomAndProduct failed: ' + e.message);
      _log('side-by-side', { ok: false, ms: Date.now() - _t, body: e.message });
    }
  }
  // 6) 仅商品图
  if (productImg) {
    _log('product-image', { ok: true, note: '仅返回商品原图' });
    return { buffer: productImg, demoType: 'product-image', trace: T };
  }
  _log('fatal', { ok: false, body: 'AI upstream failed and no fallback image available' });
  throw new Error('AI upstream failed and no fallback image available');
}

// 调阶跃 step-image-edit-2 当合成兜底（Step Plan 路径，Pro 套餐内）
// 阶跃 edits 只收单张输入图：先用 sharp 把沙发按比例预贴到客厅中下部，
// 再让模型「真实融合」——输出与输入同尺寸，正好得到一张客厅合成图。
// 官方公告 2026-10-10 停服；停服后本函数必然抛错，链路自动滑向 Pollinations。
async function callStepImageEdit({ roomBuffer, sofaBuffer, prompt, productId }) {
  const product = findProduct(productId);
  const { default: sharp } = await import('sharp');

  // 1) 压客厅到 1024 宽，沙发缩到约 42% 宽贴在中下部（留给模型的融合提示）
  const roomJpeg = await sharp(roomBuffer)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  const roomMeta = await sharp(roomJpeg).metadata();
  const sofaW = Math.round(roomMeta.width * 0.42);
  const sofaJpeg = await sharp(sofaBuffer)
    .resize({ width: sofaW })
    .jpeg({ quality: 85 })
    .toBuffer();
  const sofaMeta = await sharp(sofaJpeg).metadata();
  const left = Math.round((roomMeta.width - sofaW) / 2);
  const top = Math.max(0, Math.round(roomMeta.height * 0.55) - Math.round(sofaMeta.height / 2));
  const merged = await sharp(roomJpeg)
    .composite([{ input: sofaJpeg, left, top }])
    .jpeg({ quality: 90 })
    .toBuffer();

  // 2) prompt：中文（阶跃中文原生），要求融合贴图并清掉原沙发痕迹
  const descBits = product ? [product.name, product.subtitle, product.color].filter(Boolean) : [];
  const desc = descBits.length ? `图中贴入的是：${descBits.join('，')}。` : '';
  const finalPrompt = `${desc}把贴在客厅里的这款沙发与场景真实融合：保持客厅的墙面、地板、光照、镜头视角完全不变，替换掉原本的沙发，贴合透视和阴影，去除贴图边缘痕迹，写实摄影质感，无 AI 痕迹。${prompt ? `风格要求：${prompt}。` : ''}`;

  // 3) 调 Step Plan 图像编辑接口（multipart，同 OpenAI /v1/images/edits 形状）
  const form = new FormData();
  form.append('model', process.env.STEP_IMAGE_MODEL || 'step-image-edit-2');
  form.append('prompt', finalPrompt.slice(0, 512));
  form.append('image', new Blob([merged], { type: 'image/jpeg' }), 'room.jpg');
  form.append('response_format', 'b64_json');
  form.append('steps', '8');
  form.append('cfg_scale', '1.0');
  const resp = await fetch(`${STEP_BASE_URL}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STEP_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`step edits ${resp.status}: ${text.slice(0, 120)}`);
  }
  const data = await resp.json();
  const item = data?.data?.[0];
  if (!item || (item.finish_reason && item.finish_reason !== 'success')) {
    throw new Error(`step edits finish_reason=${item?.finish_reason || 'empty'}`);
  }
  if (!item.b64_json) throw new Error('step edits returned no b64_json');
  const buf = Buffer.from(item.b64_json, 'base64');
  if (buf.length < 1000) throw new Error('step edits returned too-small image');
  console.log(`[step][image-edit] ok model=${process.env.STEP_IMAGE_MODEL || 'step-image-edit-2'} product=${productId || '?'} bytes=${buf.length}`);
  return buf;
}

// 调 Pollinations.ai 当 gpt-image-2 后端（两鱼 503 时实际生成图的地方）
// 上传客户客厅图到 tmpfiles.org（1 小时自动过期），用 image= 喂给 Pollinations
async function callPollinations({ productId, roomBuffer, prompt }) {
  const product = findProduct(productId);
  if (!product) return null;

  // 1) 压缩客厅图后上传 tmpfiles.org
  const { default: sharp } = await import('sharp');
  const roomJpeg = await sharp(roomBuffer).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
  const fd = new FormData();
  fd.append('file', new Blob([roomJpeg], { type: 'image/jpeg' }), 'room.jpg');
  const uploadResp = await fetch('https://tmpfiles.org/api/v1/upload', { method: 'POST', body: fd });
  if (!uploadResp.ok) throw new Error(`tmpfiles upload ${uploadResp.status}`);
  const uploadData = await uploadResp.json();
  const roomUrl = uploadData?.data?.url;
  if (!roomUrl) throw new Error('tmpfiles returned no url');

  // 2) 拼 prompt：保留房间 + 替换沙发 + 商品特点
  const descBits = [product.name, product.subtitle, product.description, product.color].filter(Boolean);
  const desc = descBits.join('，');
  const finalPrompt = prompt
    ? `keep the room, walls, floor, lighting, camera angle unchanged. Replace the existing sofa with this product: ${desc}. ${prompt}`
    : `keep the room, walls, floor, lighting, camera angle unchanged. Replace the existing sofa with this product: ${desc}. Realistic photograph, no AI artifacts.`;

  // 3) 调 Pollinations，model 名写 gpt-image-2（实际跑 Flux 引擎，但接口语义一致）
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1024&height=1024&model=gpt-image-2&image=${encodeURIComponent(roomUrl)}&nologo=true&seed=42&enhance=true`;
  const genResp = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!genResp.ok) throw new Error(`pollinations ${genResp.status}`);
  const arr = new Uint8Array(await genResp.arrayBuffer());
  if (arr.length < 1000) throw new Error('pollinations returned too-small image');
  return Buffer.from(arr);
}

function buildTryonPrompt(productId) {
  // 动态 prompt：基于商品自身属性（名称/副标题/描述/颜色/材质/亮点）拼成，
  // 显式要求 AI「替换」原沙发而不是叠加新沙发，避免出现"两张沙发"
  const product = findProduct(productId);
  if (!product) {
    return '请把第二张图中的沙发自然摆放到第一张图的客厅，替换原沙发。';
  }
  const lines = [
    `【任务】把第二张图里的「${product.name}」摆进第一张图的客厅，**替换掉**客厅中现有的沙发及抱枕。`,
  ];
  const descBits = [];
  if (product.subtitle) descBits.push(product.subtitle);
  if (product.description) descBits.push(product.description);
  if (descBits.length) lines.push(`【商品】${product.name} —— ${descBits.join('。')}`);
  if (product.color) lines.push(`【主色调】${product.color}`);
  if (Array.isArray(product.highlights) && product.highlights.length > 0) {
    lines.push(`【材质 / 工艺】${product.highlights.join('，')}`);
  }
  lines.push('【操作要求】');
  lines.push('1. 完全移除原图客厅里的旧沙发、抱枕、沙发毯等坐具');
  lines.push('2. 在原沙发占据的位置放入新沙发，**视角/透视**与原图保持一致');
  lines.push('3. 保持客厅的墙面、地板、电视柜、灯具、装饰物、绿植完全不动');
  lines.push('4. 新沙发的投影方向必须和原图主光源方向一致（暖光从哪边来，影子就倒向另一边）');
  lines.push('5. 不要新增其他家具；不要改变镜头远近/角度');
  lines.push('6. 输出实拍照片级别，避免 AI 痕迹（无明显边缘、无不合理光影）');
  lines.push('【输出】1024x1024 单张图。');
  return lines.join('\n');
}

// ---------- v2：AI 商品场景图（单图输入，营销素材链路） ----------
// 与试摆链路的区别：
//   - 只传 1 张商品主图（不是 room+sofa 双图），让模型生成「商品所处的真实家庭场景」
//   - 只有两级：twofishai 成功 → 返回；失败 → Pollinations；都失败 → throw（决策 3：绝不兜底 demo 图）

function buildScenePrompt(product, style, scene) {
  const sceneName = scene || style?.scene || '客厅';
  const lines = [
    '【任务】以第二段风格要求，为图中这件家具生成一张“摆在真实家庭场景里”的写实照片。',
  ];
  // 商品属性缺失时只保留通用句，不编造（沿用 v1 诚实性原则）
  const descBits = [product?.name, product?.subtitle].filter(Boolean);
  if (descBits.length) {
    lines.push(`【商品】${descBits.join('，')}。必须保持商品的外观、轮廓、材质、颜色与图中完全一致。`);
  } else {
    lines.push('【商品】必须保持图中家具的外观、轮廓、材质、颜色与输入图完全一致，不得凭空改变商品属性。');
  }
  lines.push(`【场景】${sceneName}，${style?.prompt || ''}。`);
  lines.push('【硬性要求】');
  lines.push('1. 商品是画面主角，按真实透视与投影摆放，光照方向一致');
  lines.push('2. 禁止修改商品的颜色/材质/图案；禁止添加品牌标志、水印、文字');
  lines.push('3. 场景里其他陈设自然合理，符合中国家庭');
  lines.push('4. 输出实拍照片级别，无 AI 痕迹');
  lines.push('【输出】1024x1024 单张图。');
  return lines.join('\n');
}

// Pollinations 场景图兜底：上传商品图到 tmpfiles.org，要求「保留商品不变、生成它所处的场景」
async function callScenePollinations({ product, productBuffer, scene }) {
  const { default: sharp } = await import('sharp');
  const imgJpeg = await sharp(productBuffer)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const fd = new FormData();
  fd.append('file', new Blob([imgJpeg], { type: 'image/jpeg' }), 'product.jpg');
  const uploadResp = await fetch('https://tmpfiles.org/api/v1/upload', {
    method: 'POST',
    body: fd,
    signal: AbortSignal.timeout(60000),
  });
  if (!uploadResp.ok) throw new Error(`tmpfiles upload ${uploadResp.status}`);
  const uploadData = await uploadResp.json();
  let productUrl = uploadData?.data?.url;
  if (!productUrl) throw new Error('tmpfiles returned no url');
  // API 给的是预览页地址，换直链
  productUrl = productUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');

  const descBits = [product?.name, product?.subtitle].filter(Boolean);
  const desc = descBits.length ? `the furniture product (${descBits.join(', ')})` : 'the furniture product';
  const roomEn = scene === '卧室' ? 'a cozy bedroom' : scene === '餐厅' ? 'a dining room' : 'a living room';
  const enPrompt = `Keep ${desc} from the input image exactly unchanged: same appearance, silhouette, material, color and pattern. Place it in a real Chinese home, ${roomEn} interior around it, natural perspective, realistic shadows matching the lighting. Photorealistic photograph, no brand logo, no watermark, no text, no AI artifacts.`;

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(enPrompt)}?width=1024&height=1024&model=gpt-image-2&image=${encodeURIComponent(productUrl)}&nologo=true&seed=42&enhance=true`;
  const genResp = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!genResp.ok) throw new Error(`pollinations ${genResp.status}`);
  const arr = new Uint8Array(await genResp.arrayBuffer());
  // 注意：不在此处加最小尺寸拦截（QA mock 返回 1x1 PNG，必须能过）
  if (arr.length < 1000) throw new Error('pollinations returned too-small image');
  return Buffer.from(arr);
}

// 场景图两级链路：twofishai edits（单图）→ Pollinations；都失败 throw
async function callSceneImageAI({ product, productBuffer, style }) {
  const scene = sceneRoomForProduct(product, style);
  const prompt = buildScenePrompt(product, style, scene);

  // 1) twofishai / gpt-image-2（主路径，90s 超时防后台请求吊死）
  if (TWO_FISH_API_KEY) {
    try {
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', prompt);
      form.append('size', '1024x1024');
      const productSmall = await shrinkForAI(productBuffer);
      form.append('image[]', new Blob([productSmall], { type: 'image/jpeg' }), 'product.jpg');

      const resp = await fetch(TWO_FISH_EDITS_URL, {
        method: 'POST',
        headers: { 'x-api-key': TWO_FISH_API_KEY },
        body: form,
        signal: AbortSignal.timeout(90000),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`TwoFish API ${resp.status}: ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const item = data?.data?.[0];
      if (!item) throw new Error('TwoFish returned empty data');
      let buf;
      if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
      else if (item.url) {
        const imgResp = await fetch(item.url, { signal: AbortSignal.timeout(90000) });
        buf = Buffer.from(new Uint8Array(await imgResp.arrayBuffer()));
      }
      if (buf && buf.length > 0) return { buffer: buf, demoType: 'ai-composition' };
      throw new Error('TwoFish response unrecognized shape');
    } catch (err) {
      console.warn('[scene] twofishai failed: ' + err.message);
    }
  }

  // POLLINATIONS_OFF=1：测试开关，跳过兜底直接 throw（只影响显式设置的环境）
  if (process.env.POLLINATIONS_OFF === '1') {
    throw new Error('场景图上游失败（POLLINATIONS_OFF=1，已跳过 Pollinations 兜底）');
  }

  // 2) Pollinations 图生图兜底
  try {
    const buf = await callScenePollinations({ product, productBuffer, scene });
    if (buf) return { buffer: buf, demoType: 'ai-composition' };
  } catch (e) {
    console.warn('[scene] Pollinations failed: ' + e.message);
  }

  throw new Error('场景图上游全部失败（twofishai / Pollinations 均不可用）');
}

// ---------- App ----------

const app = express();

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// ---------- HTML page routes (声明在 static 中间件之前，避免被静态托管吞掉) ----------
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/product/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'product.html')));
app.get('/checkout/:productId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'checkout.html')));
app.get('/order/:orderId', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'order.html')));
app.get('/tryon', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'tryon.html')));
app.get('/whole-home', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'whole-home.html')));
app.get('/chat-guide', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'chat-guide.html')));
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/my-orders', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'my-orders.html')));
app.get('/my-home', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'my-home.html')));
app.get('/my-generations', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'my-generations.html')));
// 阿杏 AI 家居助手（新端口同一套后端，前端单页壳在 src/axing/）
app.get('/axing', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'axing', 'index.html')));
app.get('/axing/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'axing', 'index.html')));

// Admin 页面：/admin 直接进登录页（避免被 express.static 当成目录展示 index.html）
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html')));
app.get('/admin/index', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/admin/product', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'product.html')));
app.get('/admin/ai-upload', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'ai-upload.html')));
app.get('/admin/room', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'room.html')));
app.get('/admin/tryon', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'tryon.html')));
app.get('/admin/orders', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'orders.html')));
app.get('/admin/products', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'products.html')));
app.get('/admin/scene', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'scene.html')));
app.get('/admin/rooms', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'rooms.html')));
app.get('/admin/presets', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'presets.html')));
app.get('/admin/tryon-results', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'tryon-results.html')));
app.get('/admin/feature-flags', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'feature-flags.html')));
app.get('/admin/categories', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'categories.html')));
// 阿杏顾客在线约到店后，老板在这个页面看到「明天谁来、要看什么、打电话」（转化闭环的收口）
app.get('/admin/appointments', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'appointments.html')));

// Static: HTML pages served from src/ (兜底：直接访问 .html 时)
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// Static: images served from public/images/
app.use('/images', express.static(IMAGES_DIR, { fallthrough: true }));

// Static: also expose under /public/images for legacy
app.use('/public/images', express.static(IMAGES_DIR, { fallthrough: true }));

// Static: uploaded compositions / rooms / products
// 本地有就走本地，没有则代理到 MinIO（解决 127.0.0.1:9000 在浏览器无法访问的问题）
const uploadsHandler = express.static(UPLOADS_DIR, { fallthrough: true });
app.use('/uploads', (req, res, next) => {
  uploadsHandler(req, res, async (err) => {
    if (res.headersSent) return;
    try {
      // /uploads/{type}/{file} → MinIO object key = {type}/{file}（bucket 由 getObject 首参提供，勿再拼进 key）
      const relative = decodeURIComponent(req.path.replace(/^\/+/, ''));
      const objectName = relative;
      const stream = await minioClient.getObject(BUCKET, objectName);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const ext = relative.split('.').pop().toLowerCase();
      const ct = ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp'
        : ext === 'gif' ? 'image/gif'
        : 'image/jpeg';
      res.setHeader('Content-Type', ct);
      stream.pipe(res);
      stream.on('error', (e) => {
        if (!res.headersSent) res.status(502).end('minio error');
      });
    } catch (e2) {
      res.status(404).end('not found');
    }
  });
});

// ---------- API: 现有的产品 / 订单 / 试摆（保留原行为） ----------

// OpenAI 兼容的 image-generation 入口（POST /v1/images/generations）。
// 入参 {model, prompt, size?, n?}，出参 {created, data:[{b64_json}]}。
// 实际写真合成仍由 callTryonAI 承担（带 room/sofa 参考图）。本端点提供
// 单 prompt 的纯文生图路径：先尝试 twofishai -> /v1/images/generations，
// 失败后回退到本地历史合成图缓存。这样 `curl https://.../v1/images/generations`
// 在本地能稳定拿到一张合成图，便于联调。
// 安全：联调端点会直连上游烧 token，只给后台会话用；鉴权失败按 OpenAI 风格回 401
function requireAdminOpenAI(req, res, next) {
  const session = getSession(req);
  if (session && session.userId === 'admin') return next();
  return res.status(401).json({ error: { message: 'unauthorized', type: 'invalid_api_error' } });
}

app.post('/v1/images/generations', requireAdminOpenAI, async (req, res) => {
  try {
    const body = req.body || {};
    const model = String(body.model || 'gpt-image-2');
    const prompt = String(body.prompt || '');
    const size = String(body.size || '1024x1024');
    const n = Math.min(Math.max(parseInt(body.n || 1, 10) || 1, 1), 4);

    if (!prompt && !TWO_FISH_API_KEY) {
      return res.status(400).json({ error: { message: 'prompt required (or TWO_FISH_API_KEY for direct)' } });
    }

    // 1) 尝试 upstream：当 key 配置 + prompt 非空时直连 twofishai
    if (TWO_FISH_API_KEY && prompt) {
      try {
        const upstream = await fetch('https://twofishai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'x-api-key': TWO_FISH_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, prompt, size, n }),
        });
        const upstreamJson = await upstream.json().catch(() => null);
        if (upstream.ok && upstreamJson) {
          return res.status(200).json(upstreamJson);
        }
        console.warn(`[/v1/images/generations] upstream ${upstream.status}: ${JSON.stringify(upstreamJson).slice(0, 200)}`);
      } catch (err) {
        console.warn(`[/v1/images/generations] upstream fetch failed: ${err.message}`);
      }
    }

    // 2) 兜底：按 prompt 字符串当 productId 查匹配的合成图；无匹配再用 prompt 当 productId 查商品原图
    const cached = pickCachedCompositionForProduct(prompt);
    let buf = cached ? cached.buffer : null;
    let source = 'local-cache';
    if (!buf) {
      buf = await fetchProductImage(prompt);
      source = 'product-image';
    }
    if (!buf) return res.status(502).json({ error: { message: 'No upstream and no cached composition' } });
    const b64 = buf.toString('base64');
    const data = Array.from({ length: n }, () => ({ b64_json: b64 }));
    return res.status(200).json({ created: Math.floor(Date.now() / 1000), data, model, source });
  } catch (err) {
    return res.status(500).json({ error: { message: err.message } });
  }
});

// AI 导购：每 IP 24h 限次（防 Token 滥用；与匿名试摆同模式）
const CHAT_GUIDE_LIMIT = 30;
const CHAT_GUIDE_WINDOW_MS = 24 * 60 * 60 * 1000;
const chatGuideHits = new Map(); // ip -> timestamps[]

function checkChatGuideLimit(ip) {
  const now = Date.now();
  const cutoff = now - CHAT_GUIDE_WINDOW_MS;
  pruneHitsMap(chatGuideHits, CHAT_GUIDE_WINDOW_MS);
  const arr = (chatGuideHits.get(ip) || []).filter((t) => t >= cutoff);
  chatGuideHits.set(ip, arr);
  if (arr.length >= CHAT_GUIDE_LIMIT) return false;
  arr.push(now);
  return true;
}

function validateChatGuideBody(body) {
  const message = body && body.message;
  const history = body && Array.isArray(body.history) ? body.history : [];
  if (!message || typeof message !== 'string' || !message.trim()) {
    return { error: '请输入问题', status: 400 };
  }
  if (message.trim().length > 500) {
    return { error: '问题太长，请缩短后再问', status: 400 };
  }
  if (history.length > 20) {
    return { error: '对话轮次过多，请刷新页面后重试', status: 400 };
  }
  for (const turn of history) {
    if (turn && typeof turn.content === 'string' && turn.content.length > 2000) {
      return { error: '历史消息过长，请刷新页面后重试', status: 400 };
    }
  }
  return {
    message: message.trim(),
    history: history.slice(-20),
  };
}

function chatGuideErrorPayload(err) {
  const code = err && err.code;
  if (code === 'BAD_REQUEST') {
    return { status: 400, error: err.message || '请输入问题' };
  }
  if (code === 'MISSING_OPENAI_KEY') {
    return {
      status: 503,
      error: '导购暂时不可用，请稍后再试或拨打门店电话 13359140982',
    };
  }
  if (code === 'TIMEOUT') {
    return {
      status: 504,
      error: '导购助手响应超时，请稍后再试或拨打门店电话',
    };
  }
  console.error('[chat-guide]', err);
  return {
    status: 500,
    error: '导购助手暂时不可用，请稍后再试或拨打门店电话 13359140982',
  };
}

// POST /api/chat/guide — AI 聊天导购（完整 Markdown 回复）
// body: { message: string, history?: [{ role, content }] }
app.post('/api/chat/guide', async (req, res) => {
  try {
    const parsed = validateChatGuideBody(req.body);
    if (parsed.error) {
      return res.status(parsed.status).json({ success: false, error: parsed.error });
    }

    const ip = getClientIp(req);
    if (!checkChatGuideLimit(ip)) {
      return res.status(429).json({
        success: false,
        error: `今日导购次数已用完（每天 ${CHAT_GUIDE_LIMIT} 次），请明天再试或拨打门店电话 13359140982`,
      });
    }

    const data = await runShoppingGuideChat({
      message: parsed.message,
      history: parsed.history,
    });
    console.log(`[step][chat-guide] ok provider=${getChatProviderInfo().provider} model=${getChatProviderInfo().model} reply=${data.reply.length}字`);
    return res.json({ success: true, data: { reply: data.reply } });
  } catch (err) {
    const payload = chatGuideErrorPayload(err);
    return res.status(payload.status).json({ success: false, error: payload.error });
  }
});

// POST /api/chat/guide/stream — SSE 流式 Markdown（供 ynet parseStream）
// 真实路径：Agents SDK Runner stream + toTextStream → delta 事件
app.post('/api/chat/guide/stream', async (req, res) => {
  const parsed = validateChatGuideBody(req.body);
  if (parsed.error) {
    return res.status(parsed.status).json({ success: false, error: parsed.error });
  }

  const ip = getClientIp(req);
  if (!checkChatGuideLimit(ip)) {
    return res.status(429).json({
      success: false,
      error: `今日导购次数已用完（每天 ${CHAT_GUIDE_LIMIT} 次），请明天再试或拨打门店电话 13359140982`,
    });
  }

  // 提前探测密钥，避免先开 SSE 再报缺 key
  configureOpenAIFromEnv();
  const providerInfo = getChatProviderInfo();
  if (!providerInfo.ready && process.env.CHAT_GUIDE_FAKE_MODEL !== '1') {
    return res.status(503).json({
      success: false,
      error: '导购暂时不可用：请配置 STEP_API_KEY / ARK_API_KEY / OPENAI_API_KEY',
    });
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  const writeEvent = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  writeEvent({
    type: 'status',
    provider: providerInfo.provider || (process.env.CHAT_GUIDE_FAKE_MODEL === '1' ? 'fake' : null),
    model: providerInfo.model,
    streaming: true,
  });

  try {
    for await (const event of streamShoppingGuideChat({
      message: parsed.message,
      history: parsed.history,
    })) {
      writeEvent(event);
    }
  } catch (err) {
    const payload = chatGuideErrorPayload(err);
    writeEvent({ type: 'error', error: payload.error, status: payload.status });
  }
  res.end();
});

// GET /api/chat/guide/status — 导购模型是否就绪（排障用）
app.get('/api/chat/guide/status', (req, res) => {
  configureOpenAIFromEnv();
  const info = getChatProviderInfo();
  return res.json({
    success: true,
    data: {
      ...info,
      live: Boolean(info.ready),
    },
  });
});

// ---------- AI 语音导购（阶跃 StepAudio 2.5 ASR/TTS + step-3.7-flash） ----------
// 流程：顾客按住说话 → 前端录 WAV(16k mono) → POST /api/voice/ask
//   → stepaudio-2.5-asr 转文字 → step-3.7-flash 按在售商品库口语作答 → stepaudio-2.5-tts 合成 mp3 → 返回播放
const VOICE_ASK_LIMIT = parseInt(process.env.VOICE_ASK_LIMIT || '30', 10);
const VOICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const voiceHits = new Map();
const VOICE_AUDIO_MAX_BYTES = 8 * 1024 * 1024; // 30 秒 16k 单声道 WAV 约 1MB，留足余量

function checkVoiceLimit(ip) {
  const now = Date.now();
  const cutoff = now - VOICE_WINDOW_MS;
  pruneHitsMap(voiceHits, VOICE_WINDOW_MS);
  const arr = (voiceHits.get(ip) || []).filter((t) => t >= cutoff);
  voiceHits.set(ip, arr);
  if (arr.length >= VOICE_ASK_LIMIT) return false;
  arr.push(now);
  return true;
}

// SSE 逐行解析 ASR 结果：取 transcript.text.done 的完整文本（无则拼接 delta）
function parseAsrSse(rawText) {
  const events = String(rawText)
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  let doneText = '';
  let deltaText = '';
  for (const payload of events) {
    try {
      const ev = JSON.parse(payload);
      if (ev.type === 'transcript.text.done' && ev.text) doneText += ev.text;
      if (ev.type === 'transcript.text.delta' && ev.delta) deltaText += ev.delta;
    } catch (_) { /* 忽略非 JSON 行 */ }
  }
  return (doneText || deltaText).trim();
}

// 服务器到阶跃的偶发网络抖动（容器 DNS/IPv6 出网不稳）：网络类错误重试一次
async function withStepRetry(fn) {
  try {
    return await fn();
  } catch (err) {
    const msg = String(err && (err.cause?.code || err.code || err.message));
    if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|timeout|fetch failed|aborted due to timeout/i.test(msg)) {
      console.warn('[step] network hiccup, retrying once:', msg.slice(0, 80));
      return await fn();
    }
    throw err;
  }
}

async function stepTranscribe(audioBuffer, mimetype = '') {
  const mime = String(mimetype || '').toLowerCase();
  let type = 'wav';
  if (mime.includes('mp3') || mime.includes('mpeg')) type = 'mp3';
  else if (mime.includes('ogg')) type = 'ogg';
  else if (mime.includes('m4a') || mime.includes('mp4')) type = 'm4a';
  else if (mime.includes('webm')) type = 'ogg'; // webm/opus 按 ogg 容器尝试
  const body = {
    audio: {
      data: audioBuffer.toString('base64'),
      input: {
        transcription: {
          model: process.env.STEP_ASR_MODEL || 'stepaudio-2.5-asr',
          language: 'zh',
          enable_itn: true,
          hotwords: ['银杏家具', '沙发', '布艺', '科技布', '实木', '试摆', '导购'],
        },
        format: { type },
      },
    },
  };
  const resp = await fetch(`${STEP_BASE_URL}/audio/asr/sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${STEP_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`语音识别失败（${resp.status}）：${text.slice(0, 120)}`);
  }
  const raw = await resp.text();
  return parseAsrSse(raw);
}

/** 语音导购作答：读在售商品库 + 门店信息，口语化短回答（供 TTS 直接朗读） */
async function stepVoiceGuideReply(userText) {
  // 思考型模型偶发 content 为空（思考 token 占满预算），重试一次兜底
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await stepVoiceGuideReplyOnce(userText);
    } catch (err) {
      lastErr = err;
      if (!/返回为空/.test(err.message)) throw err;
    }
  }
  throw lastErr;
}

/** 语音导购人设提示词：真实商品库 + 口语约束（实时语音与一次式问答共用） */
function buildVoiceGuideInstructions() {
  const products = listOnSaleProducts();
  const store = getStoreInfo();
  const catalogLines = products
    .map((p) => {
      const base = `- ${p.name}｜${p.price || '价格面议'}｜${p.subtitle || ''}｜${p.size || ''}`;
      // v2 P1：适合人群 / 摆放建议（字段缺失就不拼，旧商品兜底——严禁拼出 undefined/null）
      const extras = [
        p.suitableFor ? `适合：${p.suitableFor}` : '',
        p.placementTip ? `摆放建议：${p.placementTip}` : '',
      ].filter(Boolean).join('；');
      return extras ? `${base}｜${extras}` : base;
    })
    .join('\n');
  return [
    '你是「银杏家具」实体店的语音导购，正在和顾客语音对话（顾客多为中老年人）。',
    '你只能依据下面的在售商品库和门店信息回答，禁止编造价格、库存、型号。',
    '回复要求（必须遵守）：',
    '1. 纯口语短句，30 到 80 个字，最多两三句，说完可以邀请顾客到店或试摆；',
    '2. 不要 Markdown、不要表格、不要序号符号、不要 emoji；',
    '3. 价格原样引用商品库里的价格（如 ¥2899起）；',
    `4. 门店：${store.address}，电话 ${store.phone}，营业 ${store.hours}；`,
    '5. 商品库里没有的（如具体某品牌），如实说店里暂时没有，建议来店或打电话。',
    '',
    '在售商品库：',
    catalogLines || '（暂时没有在售商品）',
  ].join('\n');
}

async function stepVoiceGuideReplyOnce(userText) {
  const body = {
    model: STEP_VISION_MODEL,
    messages: [
      { role: 'system', content: buildVoiceGuideInstructions() },
      { role: 'user', content: String(userText).slice(0, 500) },
    ],
    max_tokens: 800,
  };
  const resp = await fetch(`${STEP_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${STEP_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(40000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`导购模型失败（${resp.status}）：${text.slice(0, 120)}`);
  }
  const data = await resp.json();
  const reply = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!reply) throw new Error('导购模型返回为空');
  return reply;
}

async function stepTts(text) {
  const body = {
    model: process.env.STEP_TTS_MODEL || 'stepaudio-2.5-tts',
    input: String(text).slice(0, 800),
    voice: process.env.STEP_TTS_VOICE || 'elegantgentle-female',
    instruction: process.env.STEP_TTS_INSTRUCTION || '语气亲切热情，像家具店导购向顾客介绍商品，语速适中偏慢',
    response_format: 'mp3',
  };
  const resp = await fetch(`${STEP_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${STEP_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`语音合成失败（${resp.status}）：${errText.slice(0, 120)}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

// GET /api/voice/status — 语音导购是否就绪（排障用）
app.get('/api/voice/status', (req, res) => {
  return ok(res, {
    ready: Boolean(STEP_API_KEY),
    asrModel: process.env.STEP_ASR_MODEL || 'stepaudio-2.5-asr',
    ttsModel: process.env.STEP_TTS_MODEL || 'stepaudio-2.5-tts',
    voice: process.env.STEP_TTS_VOICE || 'elegantgentle-female',
    guideModel: STEP_VISION_MODEL,
    rtModel: VOICE_RT_MODEL,
    rtBase: VOICE_RT_BASE,
  });
});

// POST /api/voice/ask — 字段：audio（WAV/MP3 录音，≤8MB）
// 返回：{ userText, reply, audioBase64, audioMime }；仅回答，不写任何业务数据
app.post('/api/voice/ask',
  multer({ storage: multer.memoryStorage(), limits: { fileSize: VOICE_AUDIO_MAX_BYTES } }).single('audio'),
  async (req, res) => {
    try {
      if (!STEP_API_KEY) {
        return fail(res, 503, '语音导购暂不可用，请拨打门店电话 13359140982');
      }
      if (!req.file || !req.file.buffer || !req.file.buffer.length) {
        return fail(res, 400, '没有收到录音，请再试一次');
      }

      const ip = getClientIp(req);
      if (!checkVoiceLimit(ip)) {
        return fail(res, 429, `今日语音提问次数已用完（每天 ${VOICE_ASK_LIMIT} 次），请明天再试或拨打门店电话 13359140982`);
      }

      const userText = await withStepRetry(() => stepTranscribe(req.file.buffer, req.file.mimetype));
      if (!userText) {
        return fail(res, 400, '没有听清您说的话，请靠近手机再试一次');
      }

      const reply = await withStepRetry(() => stepVoiceGuideReply(userText));
      const audioBuffer = await withStepRetry(() => stepTts(reply));

      console.log(`[step][voice-ask] ok ip=${ip} asr="${userText.slice(0, 40)}" reply=${reply.length}字 audio=${audioBuffer.length}B model=${STEP_VISION_MODEL}`);

      return ok(res, {
        userText,
        reply,
        audioBase64: audioBuffer.toString('base64'),
        audioMime: 'audio/mpeg',
      });
    } catch (err) {
      console.error('[voice-ask]', err);
      const status = /识别失败|导购模型失败|语音合成失败/.test(err.message) ? 502 : 500;
      return fail(res, status, '语音导购暂时不可用，请稍后再试或拨打门店电话 13359140982');
    }
  });


app.get('/api/products', (req, res) => {
  try {
    const store = loadStore();
    const all = getProducts();
    // ?all=1 是后台用的旁路，会把「下架」商品连库存、价格一起返回。它原先没有任何鉴权，
    // 顾客或竞品一条 curl 就能看到你压着不卖的货和底价（G 组实测出来的信息泄露）。
    // 只有 admin 会话能拿全量；未登录走这条等同前台，只给在售。
    const showAll = req.query.all === '1';
    if (showAll) {
      const session = getSession(req);
      if (!session || session.userId !== 'admin') return fail(res, 401, '请先登录后台');
    }
    const products = showAll ? all : all.filter(p => p.status !== '下架');
    return ok(res, { store, products });
  } catch (err) {
    return fail(res, 500, '读取产品失败');
  }
});

app.get('/api/products/:id', (req, res) => {
  try {
    const store = loadStore();
    const product = findProduct(req.params.id);
    if (!product) return fail(res, 404, '商品不存在');
    return ok(res, { store, product });
  } catch (err) {
    return fail(res, 500, '读取产品失败');
  }
});

// GET /api/admin/products/:id — 取单个商品（含下架）；CLAUDE.md §4 已文档化，此处补实现
// admin 要能看到下架品，所以不走 /api/products 的"默认仅在售"过滤
app.get('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    const product = findProduct(req.params.id);
    if (!product) return fail(res, 404, '商品不存在');
    return ok(res, product);
  } catch (err) {
    return fail(res, 500, '读取商品失败');
  }
});

// PATCH /api/admin/products/:id — 改任意字段（id 不可改）
app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return fail(res, 404, '商品不存在');
    const { id: _ignored, ...patch } = req.body || {};
    products[idx] = { ...products[idx], ...patch, id: products[idx].id };
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { product: products[idx] });
  } catch (err) {
    return fail(res, 500, '更新商品失败');
  }
});

// POST /api/admin/products/:id/regenerate-copy — 按商品原图重新跑一遍 AI 文案
// 只更新文案字段（卖点/适合谁/摆放建议/尺寸/描述/亮点），name/price/status 等老板改过的字段一律保留
app.post('/api/admin/products/:id/regenerate-copy', requireAdmin, async (req, res) => {
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return fail(res, 404, '商品不存在');
    const product = products[idx];

    const imageBuffer = await readProductImageBuffer(product.image);
    if (!imageBuffer) return fail(res, 404, '图片丢失，请重新上传');

    let info;
    try {
      info = await identifyWithDoubao(imageBuffer, product.name || '');
    } catch (err) {
      return fail(res, 502, `AI 文案生成失败：${err.message}`);
    }

    // 只覆盖文案字段，name/price/status/subtitle/badge 等全部保留
    const updated = {
      ...product,
      size: info.size,
      description: info.description,
      sellingPoints: info.sellingPoints,
      suitableFor: info.suitableFor,
      placementTip: info.placementTip,
      highlights: info.sellingPoints.slice(0, 3),
    };
    products[idx] = updated;

    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { product: updated });
  } catch (err) {
    return fail(res, 500, '重新生成文案失败');
  }
});

// ---------- v2：AI 商品场景图（后台营销素材） ----------

// 并发护栏：gpt-image-2 上游不并发打，全局单飞（admin 端点、不做每日配额）
let sceneJobRunning = false;

// 把商品数组写回 products.json（兼容纯数组 / {products:[...]} 两种容器）
function saveProductsList(products) {
  const store = loadStore();
  if (Array.isArray(store)) {
    saveContainer(PRODUCTS_FILE, products);
  } else {
    store.products = products;
    saveContainer(PRODUCTS_FILE, store);
  }
}

// POST /api/admin/products/:id/scene-image — 生成一张「商品摆进真实家庭场景」的营销图
// body: { styleId, force? }；成功落 product.sceneImages + uploads.json(type='scene')
app.post('/api/admin/products/:id/scene-image', requireAdmin, async (req, res) => {
  if (sceneJobRunning) {
    // 单飞锁放在最外层：任何参数下，进行中第二个请求一律 409（409 语义优先于 400）
    return fail(res, 409, '有场景图正在生成，请等它完成再点');
  }
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return fail(res, 404, '商品不存在');
    const product = products[idx];

    const imageBuffer = await readProductImageBuffer(product.image);
    if (!imageBuffer) return fail(res, 404, '图片丢失，请重新上传或重新拍照');

    const styleId = String(req.body?.styleId || '');
    const style = findSceneStyle(styleId);
    if (!style) return fail(res, 400, '风格不存在，请刷新页面后重新选择');

    const existing = Array.isArray(product.sceneImages) ? product.sceneImages : [];
    const force = Boolean(req.body?.force);
    if (existing.some(s => s.styleId === styleId) && !force) {
      return fail(res, 400, '该风格已生成过，点「重新生成」可替换');
    }

    sceneJobRunning = true;
    let result;
    try {
      result = await callSceneImageAI({ product, productBuffer: imageBuffer, style });
    } finally {
      sceneJobRunning = false;
    }
    const { buffer, demoType } = result;

    const filename = `scene-${product.id}-${styleId}-${Date.now()}.jpg`;
    const { url } = await saveImage(buffer, 'compositions', filename, 'image/jpeg');

    const sceneImage = {
      url,
      styleId,
      styleName: style.name,
      demoType,
      createdAt: new Date().toISOString(),
    };

    // 同 styleId 替换不追加；新图 unshift 到最前；上限 = 风格卡数量（默认 5）
    const cap = Math.max(1, loadSceneStyles().length || 5);
    product.sceneImages = [sceneImage, ...existing.filter(s => s.styleId !== styleId)].slice(0, cap);
    products[idx] = product;
    saveProductsList(products);

    // uploads.json 用独立 type='scene'，绝不写 'composition'（避免污染试摆兜底缓存）
    const uploadsContainer = loadUploadsContainer();
    uploadsContainer.uploads.unshift({
      id: generateId('up'),
      type: 'scene',
      url,
      filename,
      productId: product.id,
      styleId,
      size: buffer.length,
      createdAt: sceneImage.createdAt,
    });
    saveUploadsContainer(uploadsContainer);

    return ok(res, { sceneImage, product });
  } catch (err) {
    // 决策 3：上游失败明确 502，不兜底 demo 图；未落任何库（无脏数据）
    console.warn('[scene] generate failed: ' + err.message);
    return fail(res, 502, '场景图生成失败，请再试一次');
  }
});

// DELETE /api/admin/products/:id/scene-image — 移除指定风格条目（body: { styleId }）
// 只删 products.json 里的条目，不删 MinIO/本地图片文件（孤儿文件无害）
app.delete('/api/admin/products/:id/scene-image', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return fail(res, 404, '商品不存在');
    const styleId = String(req.body?.styleId || '');
    if (!styleId) return fail(res, 400, 'styleId 必填');

    const product = products[idx];
    const before = Array.isArray(product.sceneImages) ? product.sceneImages : [];
    product.sceneImages = before.filter(s => s.styleId !== styleId);
    products[idx] = product;
    saveProductsList(products);
    return ok(res, { sceneImages: product.sceneImages, product });
  } catch (err) {
    return fail(res, 500, '删除场景图失败');
  }
});

// GET /api/admin/scene-styles — 场景图风格卡（后台工厂页渲染按钮用）
app.get('/api/admin/scene-styles', requireAdmin, (req, res) => {
  return ok(res, { styles: loadSceneStyles() });
});

// POST /api/admin/products/:id/toggle — 上下架切换
app.post('/api/admin/products/:id/toggle', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const p = products.find(p => p.id === req.params.id);
    if (!p) return fail(res, 404, '商品不存在');
    p.status = p.status === '下架' ? '在售' : '下架';
    saveProductsList(products);
    return ok(res, { product: p });
  } catch (err) {
    return fail(res, 500, '切换上下架失败');
  }
});

// DELETE /api/admin/products/:id — 删商品 + 对应图片文件
app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === req.params.id);
    if (idx === -1) return fail(res, 404, '商品不存在');
    const [removed] = products.splice(idx, 1);
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    // 删 uploads/products/ 里对应的图（filename 推算）
    if (removed && removed.image && removed.image.startsWith('/uploads/products/')) {
      const filename = removed.image.replace('/uploads/products/', '');
      const fullPath = path.join(UPLOAD_DIRS.products, filename);
      if (fs.existsSync(fullPath)) {
        try { fs.unlinkSync(fullPath); } catch (_) { /* 忽略文件删除失败 */ }
      }
    }
    return ok(res, { ok: true, id: req.params.id });
  } catch (err) {
    return fail(res, 500, '删除商品失败');
  }
});

// POST /api/admin/products/:id/retake-image — 替换商品图（重拍/重传）
app.post('/api/admin/products/:id/retake-image', requireAdmin, multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, '请选择一张图片');
    // 文件类型/大小校验（multer 路径，防 .svg 等落盘）
    const fileErr = checkUploadFile(req.file);
    if (fileErr) return fail(res, 400, fileErr);
    const product = findProduct(req.params.id);
    if (!product) return fail(res, 404, '商品不存在');

    // 删旧图（如果是本地路径）
    if (product.image && product.image.startsWith('/uploads/products/')) {
      const oldName = product.image.replace('/uploads/products/', '');
      try { fs.unlinkSync(path.join(UPLOAD_DIRS.products, oldName)); } catch (_) { /* 忽略 */ }
    }

    // 存新图到 MinIO
    const ext = safeImageExt(req.file.originalname, req.file.mimetype);
    const filename = `${req.params.id}-${Date.now().toString(36)}${ext}`;
    const { url } = await saveImage(req.file.buffer, 'products', filename, req.file.mimetype || 'image/jpeg');

    // 更新 product
    product.image = url;
    if (Array.isArray(product.images)) {
      product.images.push(url);
    } else {
      product.images = [url];
    }

    // 写回 products.json
    const products = getProducts();
    const idx = products.findIndex(p => p.id === product.id);
    if (idx !== -1) products[idx] = product;
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { product, url });
  } catch (err) {
    return fail(res, 500, `重传失败: ${err.message}`);
  }
});

// POST /api/admin/products/batch — 批量操作（toggle/delete/set_on_sale/set_off_shelf）
app.post('/api/admin/products/batch', requireAdmin, (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, '请选商品');
    if (!['toggle', 'delete', 'set_on_sale', 'set_off_shelf'].includes(action)) {
      return fail(res, 400, 'action 必须是 toggle/delete/set_on_sale/set_off_shelf');
    }
    const products = getProducts();
    const updated = [];
    for (const id of ids) {
      const idx = products.findIndex(p => p.id === id);
      if (idx === -1) continue;
      const p = products[idx];
      if (action === 'toggle') {
        p.status = p.status === '下架' ? '在售' : '下架';
        updated.push({ id: p.id, status: p.status });
      } else if (action === 'set_on_sale') {
        p.status = '在售';
        updated.push({ id: p.id, status: p.status });
      } else if (action === 'set_off_shelf') {
        p.status = '下架';
        updated.push({ id: p.id, status: p.status });
      } else if (action === 'delete') {
        // 删图
        if (p.image && p.image.startsWith('/uploads/products/')) {
          try { fs.unlinkSync(path.join(UPLOAD_DIRS.products, p.image.replace('/uploads/products/', ''))); } catch (_) { /* 忽略 */ }
        }
        products.splice(idx, 1);
        updated.push({ id, deleted: true });
      }
    }
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { updated, count: updated.length, total: products.length });
  } catch (err) {
    return fail(res, 500, '批量操作失败');
  }
});

// GET /api/admin/rooms — 后台列出所有客厅上传
app.get('/api/admin/rooms', requireAdmin, (req, res) => {
  try {
    const container = loadUploadsContainer();
    const rooms = container.uploads.filter(u => u.type === 'room').map(u => ({ ...u, url: fixImageUrl(u.url) }));
    return ok(res, { rooms });
  } catch (err) {
    return fail(res, 500, '读取客厅图失败');
  }
});

// DELETE /api/admin/rooms/:id — 删客厅上传记录（不删磁盘文件，避免误删他人数据）
app.delete('/api/admin/rooms/:id', requireAdmin, (req, res) => {
  try {
    const container = loadUploadsContainer();
    const idx = container.uploads.findIndex(u => u.id === req.params.id && u.type === 'room');
    if (idx === -1) return fail(res, 404, '记录不存在');
    container.uploads.splice(idx, 1);
    saveUploadsContainer(container);
    return ok(res, { ok: true, id: req.params.id });
  } catch (err) {
    return fail(res, 500, '删除失败');
  }
});

// GET /api/admin/tryon-results?limit=50 — 后台列出历史合成图
app.get('/api/admin/tryon-results', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
    const container = loadUploadsContainer();
    const results = container.uploads
      .filter(u => u.type === 'composition')
      .slice(0, limit)
      .map(u => ({ ...u, url: fixImageUrl(u.url) }));
    return ok(res, { results });
  } catch (err) {
    return fail(res, 500, '读取历史失败');
  }
});

// GET /api/admin/backup — 备份所有数据为 JSON
app.get('/api/admin/backup', requireAdmin, (req, res) => {
  try {
    const products = readJSON(PRODUCTS_FILE) || {};
    const orders = readJSON(ORDERS_FILE) || { orders: [] };
    const users = readJSON(USERS_FILE) || { users: [] };
    const uploads = readJSON(UPLOADS_FILE) || { uploads: [] };
    const backup = {
      ts: new Date().toISOString(),
      products,
      orders,
      users,
      uploads,
      version: 'yxjia-mvp-1.0'
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="yxjia-backup-${Date.now()}.json"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    return fail(res, 500, '备份失败');
  }
});

app.get('/api/orders', requireAdmin, (req, res) => {
  try {
    const container = loadOrdersContainer();
    return ok(res, container);
  } catch (err) {
    return fail(res, 500, '读取订单失败');
  }
});

// ---------- 订单查询的隐私控制 ----------
// 现状背景：原来任意手机号就能拉出该号全部订单（姓名+电话+地址+商品），属于隐私泄露。
// 规则（小店铺场景，兼顾老人「不登录也能查单」的体验）：
//   1) 已登录顾客：只能查自己手机号下的订单；查别人手机号 → 403
//      （未登录时不会 401 打断下单成功页 /order/:id 的查看，见第 2 条）
//   2) 未登录：仍允许按手机号 / 订单号查（下单成功页和老人电话查单要靠它），
//      但返回结果脱敏——称呼、地址打码，备注整条去掉，避免任意手机号拖出他人姓名+详细地址
function getSessionUserPhone(req) {
  const session = getSession(req);
  if (!session || session.userId === 'admin') return null; // admin 会话不当顾客账号用
  const user = findUserById(session.userId);
  return user && user.phone ? user.phone : null;
}

function maskName(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (s.length <= 1) return '*';
  return s[0] + '*'.repeat(s.length - 1);
}

function maskAddress(addr) {
  const s = String(addr || '').trim();
  if (!s) return '';
  if (s.length <= 4) return '****';
  return s.slice(0, 4) + '****';
}

// 脱敏副本（只动返回值，不动 orders.json 里的原始数据）
function maskOrderForPublic(order) {
  return {
    ...order,
    name: maskName(order.name),
    address: maskAddress(order.address),
    note: '',
  };
}

// 按调用者身份决定是否脱敏；已登录（本人）给全量，未登录给脱敏版
function ordersForCaller(req, list) {
  const myPhone = getSessionUserPhone(req);
  const orders = myPhone ? list : list.map(maskOrderForPublic);
  return { orders };
}

// GET /api/orders/:phone — 按手机号查；以 O 开头时按订单号查（下单成功页 /order/:id 用）
app.get('/api/orders/:phone', (req, res) => {
  try {
    const container = loadOrdersContainer();
    const filter = String(req.params.phone || '').trim();
    if (!filter) return fail(res, 400, '手机号或订单号必填');
    const myPhone = getSessionUserPhone(req);
    let filtered;
    if (filter.startsWith('O')) {
      // 订单号分支：保持原行为（未登录也能查，好让下单成功页直接展示）
      filtered = container.orders.filter(o => o.id === filter);
      if (myPhone) filtered = filtered.filter(o => o.phone === myPhone); // 登录后只能看自己的
    } else {
      if (myPhone && myPhone !== filter) return fail(res, 403, '只能查询自己手机号下的订单');
      filtered = container.orders.filter(o => o.phone === filter);
    }
    return ok(res, ordersForCaller(req, filtered));
  } catch (err) {
    return fail(res, 500, '读取订单失败');
  }
});

// GET /api/orders/by-phone/:phone — 我的订单页（src/my-orders.html）用
app.get('/api/orders/by-phone/:phone', (req, res) => {
  try {
    const container = loadOrdersContainer();
    const phone = String(req.params.phone || '').trim();
    if (!phone) return fail(res, 400, '手机号必填');
    const myPhone = getSessionUserPhone(req);
    if (myPhone && myPhone !== phone) return fail(res, 403, '只能查询自己手机号下的订单');
    const filtered = container.orders.filter(o => o.phone === phone);
    return ok(res, ordersForCaller(req, filtered));
  } catch (err) {
    return fail(res, 500, '读取订单失败');
  }
});

app.post('/api/orders', (req, res) => {
  if (!req.body || !req.body.productId || typeof req.body.productId !== 'string') {
    return fail(res, 400, '商品必填');
  }
  const product = findProduct(req.body.productId);
  if (!product) return fail(res, 404, '商品不存在');

  if (!req.body.name || typeof req.body.name !== 'string' || req.body.name.trim() === '') {
    return fail(res, 400, '称呼必填');
  }
  if (!isValidPhone(req.body.phone)) {
    return fail(res, 400, '手机号格式不对');
  }

  try {
    const container = loadOrdersContainer();
    const order = {
      id: 'O' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 5).toUpperCase(),
      name: req.body.name.trim(),
      phone: req.body.phone.trim(),
      productId: req.body.productId,
      productName: product.name,
      productPrice: product.price,
      address: req.body.address || '来店自提',
      spec: req.body.spec || '',
      note: req.body.note || '',
      quantity: req.body.quantity || 1,
      status: '待联系',
      createdAt: new Date().toISOString(),
    };
    container.orders.unshift(order);
    saveOrdersContainer(container);
    // 推送老板微信（fire-and-forget，不影响下单返回；异常模块内已吞）
    pushOrderToWechat(order, {
      sendKey: SERVERCHAN_SENDKEY,
      apiBase: SERVERCHAN_API_BASE,
      enabled: ORDER_PUSH_ENABLED,
    });
    return ok(res, { ok: true, order });
  } catch (err) {
    return fail(res, 500, '保存订单失败');
  }
});

// ================= 阿杏 AI 助手（/axing）专用轻量接口 =================
// 到店预约 + 保存方案：都写本地 JSON（沿用现有 ok/fail + 容器模式），零新依赖。
// 隐私：两个文件都含手机号，已加 .gitignore。

const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const SCENES_FILE = path.join(DATA_DIR, 'scenes.json');

function loadAppointmentsContainer() {
  return loadContainer(APPOINTMENTS_FILE, 'appointments');
}
function saveAppointmentsContainer(container) {
  saveContainer(APPOINTMENTS_FILE, container);
}
function loadScenesContainer() {
  return loadContainer(SCENES_FILE, 'scenes');
}
function saveScenesContainer(container) {
  saveContainer(SCENES_FILE, container);
}

// 预约时段固定三档（门店 9:00-20:00，老人友好：不让用户自己输时间）
const APPOINTMENT_SLOTS = ['上午 9:00-12:00', '下午 12:00-18:00', '晚上 18:00-20:00'];
// 预约状态机（店主在后台点按钮推进；与 /api/admin/appointments 的 status 过滤共用同一份白名单）
const APPOINTMENT_STATUSES = ['待到店', '已到店', '已成单', '已取消'];

// 按手机号查预约的 IP 限额（未登录也要让老人查，但防枚举拖库）
const APPT_QUERY_LIMIT = 20;
const APPT_QUERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const apptQueryHits = new Map();
function checkApptQueryLimit(ip) {
  const now = Date.now();
  const cutoff = now - APPT_QUERY_WINDOW_MS;
  pruneHitsMap(apptQueryHits, APPT_QUERY_WINDOW_MS);
  const arr = (apptQueryHits.get(ip) || []).filter(t => t >= cutoff);
  apptQueryHits.set(ip, arr);
  if (arr.length >= APPT_QUERY_LIMIT) return false;
  arr.push(now);
  return true;
}

// POST /api/appointments — body: { name, phone, date(YYYY-MM-DD), slot, productIds?: [], note? }
app.post('/api/appointments', (req, res) => {
  const name = (req.body?.name || '').trim();
  const phone = (req.body?.phone || '').trim();
  const date = (req.body?.date || '').trim();
  const slot = (req.body?.slot || '').trim();
  const note = (req.body?.note || '').trim();
  const productIds = Array.isArray(req.body?.productIds)
    ? req.body.productIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
    : [];

  if (!name) return fail(res, 400, '怎么称呼您？');
  if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, '请选择到店日期');
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return fail(res, 400, '到店日期不能早于今天');
  if (!APPOINTMENT_SLOTS.includes(slot)) return fail(res, 400, '请选择到店时段');

  const productNames = [];
  for (const pid of productIds) {
    const p = findProduct(pid);
    if (!p) return fail(res, 404, `商品不存在：${pid}`);
    productNames.push(p.name);
  }

  try {
    const container = loadAppointmentsContainer();
    const appointment = {
      id: 'A' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 5).toUpperCase(),
      name,
      phone,
      date,
      slot,
      productIds,
      productNames,
      note: note.slice(0, 500),
      status: '待到店',
      createdAt: new Date().toISOString(),
    };
    container.appointments.unshift(appointment);
    saveAppointmentsContainer(container);
    console.log(`[axing] appointment ${appointment.id} ${name} ${phone} ${date} ${slot} products=${productIds.join(',') || '-'}`);
    return ok(res, { ok: true, appointment });
  } catch (err) {
    console.error('[axing][appointments]', err);
    return fail(res, 500, '保存预约失败，请改用电话 13359140982');
  }
});

// GET /api/appointments/by-phone/:phone — 查自己的预约（未登录可查，IP 限额；登录用户只能查自己）
app.get('/api/appointments/by-phone/:phone', (req, res) => {
  const phone = (req.params.phone || '').trim();
  if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
  const myPhone = getSessionUserPhone(req);
  if (myPhone && myPhone !== phone) return fail(res, 403, '只能查询自己手机号的预约');
  if (!myPhone && !checkApptQueryLimit(getClientIp(req))) {
    return fail(res, 429, '今天查询次数已用完，请明天再试，或拨打门店电话 13359140982');
  }
  try {
    const container = loadAppointmentsContainer();
    const list = container.appointments.filter(a => a.phone === phone).slice(0, 30);
    return ok(res, { appointments: list });
  } catch (err) {
    console.error('[axing][appointments-query]', err);
    return fail(res, 500, '读取预约失败');
  }
});

// GET /api/admin/appointments — 店主看预约：按到店日期升序（最近要来的人排最前，老板先打明天的电话），
// 同一天再按提交时间倒序（后约的放前面，方便回访确认）。?status= 可过滤，最多返回 200 条。
app.get('/api/admin/appointments', requireAdmin, (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  if (status && !APPOINTMENT_STATUSES.includes(status)) {
    return fail(res, 400, `状态只能是：${APPOINTMENT_STATUSES.join(' / ')}`);
  }
  try {
    const container = loadAppointmentsContainer();
    const all = Array.isArray(container.appointments) ? container.appointments : [];
    const list = (status ? all.filter(a => a.status === status) : all.slice()).sort((a, b) => {
      const da = String(a.date || ''), db = String(b.date || '');
      if (da !== db) return da < db ? -1 : 1;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
    return ok(res, { appointments: list.slice(0, 200), total: all.length });
  } catch (err) {
    console.error('[axing][admin-appointments]', err);
    return fail(res, 500, '读取预约失败');
  }
});

// PATCH /api/admin/appointments/:id — 店主推进状态（body: { status }）
app.patch('/api/admin/appointments/:id', requireAdmin, (req, res) => {
  const status = typeof req.body?.status === 'string' ? req.body.status.trim() : '';
  if (!APPOINTMENT_STATUSES.includes(status)) {
    return fail(res, 400, `状态只能是：${APPOINTMENT_STATUSES.join(' / ')}`);
  }
  try {
    const container = loadAppointmentsContainer();
    const idx = (container.appointments || []).findIndex(a => a.id === req.params.id);
    if (idx < 0) return fail(res, 404, '没找到这条预约');
    container.appointments[idx] = { ...container.appointments[idx], status };
    saveAppointmentsContainer(container);
    return ok(res, { appointment: container.appointments[idx] });
  } catch (err) {
    console.error('[axing][admin-appointment-patch]', err);
    return fail(res, 500, '保存状态失败');
  }
});

// 方案里的图片 URL（试摆图 / 顾客客厅照）只做增强：非 http(s) 或超长一律降级成 null，
// 绝不让一条坏 URL 把整个方案的保存打断（PM 批判 §2.11）
function normalizeImageUrl(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (v.length > 1000) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  return v;
}

// POST /api/scenes — 保存「我家的方案」body: { name?, phone?, items: [{ productId, color?, materialId?, transform?, dims?, compositionUrl?, roomUrl? }] }
app.post('/api/scenes', (req, res) => {
  const name = (req.body?.name || '').trim().slice(0, 40);
  const phone = (req.body?.phone || '').trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return fail(res, 400, '方案里还没有家具');
  if (items.length > 20) return fail(res, 400, '一个方案最多放 20 件家具');
  if (phone && !isValidPhone(phone)) return fail(res, 400, '手机号格式不对');

  const resolved = [];
  for (const item of items) {
    const pid = typeof item?.productId === 'string' ? item.productId.trim() : '';
    if (!pid) return fail(res, 400, '有家具没有选具体商品');
    const product = findProduct(pid);
    if (!product) return fail(res, 404, `商品不存在：${pid}`);
    resolved.push({
      productId: pid,
      productName: product.name,
      productImage: product.image || null,
      color: typeof item.color === 'string' ? item.color.slice(0, 20) : null,
      materialId: typeof item.materialId === 'string' ? item.materialId.slice(0, 20) : null,
      transform: item.transform && typeof item.transform === 'object' ? item.transform : null,
      dims: item.dims && typeof item.dims === 'object' ? item.dims : null,
      // 试摆图 + 顾客客厅照（老数据没有这两个键，读的时候自然就是 undefined，不影响回看）
      compositionUrl: normalizeImageUrl(item.compositionUrl),
      roomUrl: normalizeImageUrl(item.roomUrl),
    });
  }

  try {
    const container = loadScenesContainer();
    const scene = {
      id: 'S' + Date.now().toString().slice(-8) + Math.random().toString(36).slice(2, 5).toUpperCase(),
      name: name || `我的家 · ${new Date().toLocaleDateString('zh-CN')}`,
      userPhone: phone,
      items: resolved,
      createdAt: new Date().toISOString(),
    };
    container.scenes.unshift(scene);
    if (container.scenes.length > 1000) container.scenes.length = 1000;
    saveScenesContainer(container);
    console.log(`[axing] scene ${scene.id} saved phone=${phone || '-'} items=${resolved.length}`);
    return ok(res, { ok: true, scene });
  } catch (err) {
    console.error('[axing][scenes]', err);
    return fail(res, 500, '保存方案失败');
  }
});

// GET /api/scenes/by-phone/:phone — 我的方案（未登录可查，IP 限额；登录用户只能查自己）
app.get('/api/scenes/by-phone/:phone', (req, res) => {
  const phone = (req.params.phone || '').trim();
  if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
  const myPhone = getSessionUserPhone(req);
  if (myPhone && myPhone !== phone) return fail(res, 403, '只能查询自己手机号的方案');
  if (!myPhone && !checkApptQueryLimit(getClientIp(req))) {
    return fail(res, 429, '今天查询次数已用完，请明天再试，或拨打门店电话 13359140982');
  }
  try {
    const container = loadScenesContainer();
    const list = container.scenes.filter(s => s.userPhone === phone).slice(0, 30);
    return ok(res, { scenes: list });
  } catch (err) {
    console.error('[axing][scenes-query]', err);
    return fail(res, 500, '读取方案失败');
  }
});

// 旧的 /api/tryon（保持兼容：未带 sofaFile 时返回演示图）
app.post('/api/tryon', (req, res) => {
  if (!req.body || !req.body.productId) {
    return fail(res, 400, '请选择要试摆的商品');
  }
  try {
    const product = findProduct(req.body.productId);
    if (!product) return fail(res, 404, '商品不存在');
    const compositionUrl = `/images/compositions/${product.id}-demo.jpg`;
    return ok(res, {
      ok: true,
      message: '已收到',
      product,
      compositionUrl,
      ts: Date.now(),
    });
  } catch (err) {
    return fail(res, 500, '试摆失败');
  }
});

// GET /api/tryon/history?phone=xxx&limit=20
// 返回用户历史试摆记录（含合成图 URL + 用的产品 + 客厅照 URL），用于快速复用
// 隐私：登录用户只能查自己手机号（403）；未登录仍可查（老人不登录也要用），
// 但按 IP 限额（仿匿名试摆模式），避免拿它当枚举他人手机号的拖库口子。
const TRYON_HISTORY_LIMIT = 30;
const TRYON_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const tryonHistoryHits = new Map(); // ip -> number[] (timestamps)

function checkTryonHistoryLimit(ip) {
  const now = Date.now();
  const cutoff = now - TRYON_HISTORY_WINDOW_MS;
  pruneHitsMap(tryonHistoryHits, TRYON_HISTORY_WINDOW_MS);
  const arr = (tryonHistoryHits.get(ip) || []).filter(t => t >= cutoff);
  tryonHistoryHits.set(ip, arr);
  if (arr.length >= TRYON_HISTORY_LIMIT) return false;
  arr.push(now);
  return true;
}

app.get('/api/tryon/history', (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
    const myPhone = getSessionUserPhone(req);
    // 已登录：只允许查自己（否则 403）
    if (myPhone && myPhone !== phone) return fail(res, 403, '只能查询自己手机号的历史');
    // 未登录：保留可查，但加 IP 限额防枚举
    if (!myPhone && !checkTryonHistoryLimit(getClientIp(req))) {
      return fail(res, 429, `今天查询次数已用完（每天 ${TRYON_HISTORY_LIMIT} 次），请明天再试，或拨打门店电话 13359140982`);
    }
    const container = loadUploadsContainer();
    const list = container.uploads
      .filter(u => u.type === 'composition' && u.userPhone === phone)
      .slice(0, limit)
      .map(u => ({ ...u, url: fixImageUrl(u.url) }));
    // 同时返回该用户上传过的客厅照（用于复用）
    const rooms = container.uploads
      .filter(u => u.type === 'room' && u.userPhone === phone)
      .slice(0, 10)
      .map(u => ({ ...u, url: fixImageUrl(u.url) }));
    return ok(res, { history: list, rooms });
  } catch (err) {
    return fail(res, 500, '读取历史失败');
  }
});

// GET /api/generations/mine — 登录用户看自己的生成历史（含当时 prompt + 全链路 trace + 失败原因）
app.get('/api/generations/mine', requireUser, (req, res) => {
  try {
    const phone = getSessionUserPhone(req) || '';
    const limit = Math.min(parseInt(req.query.limit || '30', 10) || 30, 100);
    const c = loadGenerationsContainer();
    const list = (c.generations || [])
      .filter(g => g.userPhone === phone)
      .slice(0, limit)
      .map(g => ({ ...g, compositionUrl: fixImageUrl(g.compositionUrl) }));
    return ok(res, { generations: list, count: list.length });
  } catch (err) {
    return fail(res, 500, '读取生成历史失败');
  }
});

// ---------- API: 用户系统 ----------

function findUserById(id) {
  return loadUsersContainer().users.find(u => u.id === id);
}

function findUserByPhone(phone) {
  return loadUsersContainer().users.find(u => u.phone === phone);
}

// POST /api/auth/send-code  -> {phone}
app.post('/api/auth/send-code', (req, res) => {
  try {
    const phone = (req.body && req.body.phone) || '';
    if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
    // MVP：固定 123456
    return ok(res, { ok: true, message: '验证码已发出（MVP：固定 123456）' });
  } catch (err) {
    return fail(res, 500, '发送验证码失败');
  }
});

// POST /api/auth/login -> {phone, code, name?}
app.post('/api/auth/login', (req, res) => {
  try {
    const body = req.body || {};
    if (!isValidPhone(body.phone)) return fail(res, 400, '手机号格式不对');
    if (body.code !== FIXED_VERIFY_CODE) return fail(res, 400, '验证码不对，请填 123456');
    const container = loadUsersContainer();
    let user = container.users.find(u => u.phone === body.phone);
    if (!user) {
      user = {
        id: generateId('u'),
        phone: body.phone,
        name: (body.name && String(body.name).trim()) || '',
        createdAt: new Date().toISOString(),
      };
      container.users.push(user);
      saveUsersContainer(container);
    }
    const token = attachSession(user.id);
    setSessionCookie(res, token);
    return ok(res, { ok: true, token, user });
  } catch (err) {
    return fail(res, 500, '登录失败');
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  try {
    const session = getSession(req);
    if (session) SESSIONS.delete(session.token);
    clearSessionCookie(res);
    return ok(res, { ok: true });
  } catch (err) {
    return fail(res, 500, '退出失败');
  }
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return fail(res, 401, '未登录');
  if (session.userId === 'admin') return ok(res, { user: { id: 'admin', role: 'admin', name: '管理员' } });
  const user = findUserById(session.userId);
  if (!user) return fail(res, 401, '账号不存在');
  return ok(res, { user });
});

// GET /api/users/:id/uploads — 仅本人或 admin
app.get('/api/users/:id/uploads', (req, res) => {
  const session = getSession(req);
  if (!session) return fail(res, 401, '请先登录');
  if (session.userId !== 'admin' && session.userId !== req.params.id) {
    return fail(res, 403, '无权查看');
  }
  const container = loadUploadsContainer();
  const list = container.uploads.filter(u => u.userId === req.params.id).map(u => ({ ...u, url: fixImageUrl(u.url) }));
  return ok(res, { uploads: list });
});

// ---------- API: 上传（multipart） ----------

// POST /api/upload/product-image — 字段：file, name, price, size, category
// 安全：后台上架商品用（src/admin/product.html），必须 admin 会话；顺带校验文件类型/大小
app.post('/api/upload/product-image', requireAdmin, async (req, res) => {
  try {
    const parts = await parseMultipart(req).catch(() => null);
    if (!parts) return fail(res, 400, '请用 multipart/form-data 上传');

    const file = getMultipartFile(parts, 'file');
    const fileErr = checkUploadFile(file);
    if (fileErr) return fail(res, 400, fileErr);

    const name = (getMultipartField(parts, 'name') || '').trim();
    const price = (getMultipartField(parts, 'price') || '').trim() || '¥Xxxx 起';
    const size = (getMultipartField(parts, 'size') || '').trim();
    const category = (getMultipartField(parts, 'category') || '').trim() || '其他';
    if (!name) return fail(res, 400, '商品名必填');

    const saved = await saveUpload(file, 'products');
    const store = loadStore();
    const products = getProducts();
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const product = {
      id,
      name,
      subtitle: category,
      price,
      size: size || '未知',
      stock: '现货',
      badge: '',
      emoji: '📦',
      color: '#5a4030',
      description: name,
      highlights: [category, '上传时间：' + new Date().toLocaleString('zh-CN')],
      image: saved.url,
    };
    products.push(product);
    if (Array.isArray(store)) {
      // 不太可能：当前 data 是对象结构
      saveContainer(PRODUCTS_FILE, [...store, product]);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { ok: true, product, url: saved.url });
  } catch (err) {
    return fail(res, 500, `上传失败：${err.message}`);
  }
});

// POST /api/admin/upload-and-identify
// 单图上传 → 视觉模型自动命名+分类+价格 → 写入 products.json
// 字段：file, hint?（可选名称提示）
// 视觉模型优先阶跃 Step Plan（STEP_API_KEY），兜底火山方舟（ARK_API_KEY），均从环境变量读
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_VISION_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const ARK_VISION_MODEL = 'doubao-seed-2-1-pro-260628';

const STEP_API_KEY = process.env.STEP_API_KEY;
const STEP_BASE_URL = process.env.STEP_BASE_URL || 'https://api.stepfun.com/step_plan/v1';
const STEP_VISION_MODEL = process.env.STEP_VISION_MODEL || 'step-3.7-flash';

/** 视觉识别所用 provider：阶跃优先，方舟兜底；都未配置返回 null */
function visionProvider() {
  if (STEP_API_KEY) {
    return {
      name: 'step',
      key: STEP_API_KEY,
      url: `${STEP_BASE_URL}/chat/completions`,
      model: STEP_VISION_MODEL,
      extraBody: {},
    };
  }
  if (ARK_API_KEY) {
    return {
      name: 'doubao',
      key: ARK_API_KEY,
      url: ARK_VISION_URL,
      model: ARK_VISION_MODEL,
      extraBody: {},
    };
  }
  return null;
}

async function identifyWithDoubao(imageBuffer, hint = '') {
  const provider = visionProvider();
  if (!provider) throw new Error('未配置 STEP_API_KEY 或 ARK_API_KEY（请检查 .env）');
  const b64 = imageBuffer.toString('base64');
  const hintPart = hint ? `提示："${hint}"。` : '';
  const body = {
    model: provider.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: 'text', text: `看这张家具图。${hintPart}返回严格 JSON（无 markdown，只回 JSON）：{"name":"5-15字中文短名","price":"照片能判断价位才填，如 ¥2999起；判断不了填 到店询价","category":"sofa/cabinet/bed/table/other","subtitle":"5-10字材质简述","color":"#XXXXXX 主色hex","emoji":"🛋️/📺/🛏️/🍽️/📦","size":"能从照片判断就写 约X米宽×X米深，必须带约字；判断不了写 可到店量尺","sellingPoints":["卖点1","卖点2","卖点3"],"suitableFor":"不超过40字大白话，适合什么家庭/场景","placementTip":"不超过60字摆放建议","description":"2-3句给顾客看的大白话介绍"}。要求：sellingPoints 恰好3条、每条不超过30字，只写照片上看得见的事实（材质/工艺/安全/好打理），不许写"高端大气上档次"这类空话；价格拿不准一律写"到店询价"，禁止编造价格；尺寸禁止编造精确数字，必须带"约"字或写"可到店量尺"；description 里禁止出现"AI 识别""AI 生成"字样。只回 JSON。` }
      ]
    }],
    ...provider.extraBody
  };
  const resp = await fetch(provider.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.key}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`${provider.name} API ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  // 尝试提取 JSON（可能被 markdown 包了）
  const match = content.match(/\{[\s\S]*\}/);
  const json = match ? JSON.parse(match[0]) : null;
  if (!json || !json.name) throw new Error(`${provider.name} 解析失败: ${content.slice(0, 200)}`);
  return normalizeIdentifyResult(json);
}

// ---------- 识别结果清洗（诚实性兜底 + 防御 AI 输出不规范） ----------

function clampIdentifyStr(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// 价格：占位符样式（¥Xxxx起）或不含数字（判断不了）一律回落"到店询价"，不许卖编造价
function honestPrice(v) {
  const s = clampIdentifyStr(v, 20);
  if (!s) return '到店询价';
  if (/^¥\s*X+x+.*$/i.test(s)) return '到店询价';
  if (!/\d/.test(s)) return '到店询价';
  return s;
}

// 尺寸：必须带"约"字（估算口吻），否则视为编造精确尺寸 → 回落到店量尺
function honestSize(v) {
  const s = clampIdentifyStr(v, 30);
  if (!s || s === '常规尺寸' || !s.includes('约')) return '可到店量尺';
  return s;
}

function normalizeIdentifyResult(json) {
  const name = clampIdentifyStr(json.name, 30);
  const subtitle = clampIdentifyStr(json.subtitle, 30);

  // sellingPoints：非数组 / 空数组 / 条目不是字符串都要防，回落 [subtitle]
  let sellingPoints = Array.isArray(json.sellingPoints)
    ? json.sellingPoints.map(x => clampIdentifyStr(x, 40)).filter(Boolean).slice(0, 3)
    : [];
  if (sellingPoints.length === 0) {
    sellingPoints = subtitle ? [subtitle] : [];
  }

  // description：剥干净可能混进来的 "AI 识别/AI 生成" 字样；AI 没给就用大白话兜底拼一段
  let description = clampIdentifyStr(json.description, 300)
    .replace(/AI\s*(识别|生成)\s*[:：]?/g, '')
    .trim();
  if (!description) {
    description = [name, subtitle, sellingPoints[0]].filter(Boolean).join('，');
  }

  return {
    name,
    price: honestPrice(json.price),
    category: ['sofa', 'cabinet', 'bed', 'table', 'other'].includes(json.category) ? json.category : 'other',
    subtitle,
    color: /^#[0-9a-f]{6}$/i.test(json.color) ? json.color : '#3a2818',
    emoji: clampIdentifyStr(json.emoji, 4) || '🛋️',
    size: honestSize(json.size),
    sellingPoints,
    suitableFor: clampIdentifyStr(json.suitableFor, 50),
    placementTip: clampIdentifyStr(json.placementTip, 80),
    description,
  };
}

// 按 product.image 找回原图 buffer：本地相对路径直接读，MinIO/外链走 HTTP；读不到返回 null
async function readProductImageBuffer(image) {
  if (!image || typeof image !== 'string') return null;
  if (image.startsWith('/uploads/')) {
    const full = path.join(UPLOADS_DIR, image.replace(/^\/uploads\//, ''));
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full);
  }
  if (/^https?:\/\//i.test(image)) {
    try {
      const resp = await fetch(image);
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    } catch (_) {
      return null;
    }
  }
  // 兜底：只给了文件名的情况
  const full = path.join(UPLOAD_DIRS.products, path.basename(image));
  return fs.existsSync(full) ? fs.readFileSync(full) : null;
}

app.post('/api/admin/upload-and-identify', requireAdmin, multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, '请选择要上传的图片');
    const hint = (req.body && req.body.hint) || '';

    // 文件类型/大小校验（multer 路径，防 .svg 等落盘）
    const fileErr = checkUploadFile(req.file);
    if (fileErr) return fail(res, 400, fileErr);

    // 1) 保存到 MinIO（fallback 本地）
    const ext = safeImageExt(req.file.originalname, req.file.mimetype);
    const filename = `${crypto.randomBytes(8).toString('hex')}${ext}`;
    const { url: imageUrl } = await saveImage(req.file.buffer, 'products', filename, req.file.mimetype || 'image/jpeg');

    // 2) 调视觉模型识别（阶跃 step-3.7-flash 优先，方舟 doubao 兜底）
    let info;
    try {
      info = await identifyWithDoubao(req.file.buffer, hint);
      const vp = visionProvider();
      console.log(`[step][identify] ok provider=${vp ? vp.name : '?'} model=${vp ? vp.model : '?'} name="${info.name}" price="${info.price}"`);
    } catch (err) {
      return ok(res, {
        ok: false,
        product: null,
        url: imageUrl,
        aiError: err.message,
        message: 'AI 识别失败，图片已保存，请手动填写商品名',
        needManual: true
      });
    }

    // 3) 写入 products.json
    const store = loadStore();
    const products = getProducts();
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
    const product = {
      id,
      name: info.name,
      subtitle: info.subtitle || info.category,
      category: info.category,
      price: info.price,
      size: info.size,
      stock: '现货',
      badge: '主推',
      emoji: info.emoji,
      color: info.color,
      description: info.description,
      sellingPoints: info.sellingPoints,
      suitableFor: info.suitableFor,
      placementTip: info.placementTip,
      // highlights 直接用卖点（前 3 条），不再写 "AI 识别于 …" 机器噪音
      highlights: info.sellingPoints.slice(0, 3),
      image: imageUrl
    };
    products.push(product);
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, [...store, product]);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    return ok(res, { ok: true, product, url: imageUrl, ai: info, message: 'AI 识别成功，已加进商品库' });
  } catch (err) {
    return fail(res, 500, `上传失败：${err.message}`);
  }
});

// POST /api/upload/room — 字段：file (room), phone?, productId?
app.post('/api/upload/room', async (req, res) => {
  try {
    const parts = await parseMultipart(req).catch(() => null);
    if (!parts) return fail(res, 400, '请用 multipart/form-data 上传');
    const file = getMultipartFile(parts, 'file');
    if (!file || !file.data || file.data.length === 0) {
      return fail(res, 400, '请选择要上传的顾客客厅照片');
    }
    const fileErr = checkUploadFile(file);
    if (fileErr) return fail(res, 400, fileErr);
    const saved = await saveUpload(file, 'rooms');
    // 记录到 uploads.json（含手机号，便于后续 history 查询）
    const phone = (getMultipartField(parts, 'phone') || '').trim();
    const productId = (getMultipartField(parts, 'productId') || '').trim();
    const container = loadUploadsContainer();
    container.uploads.unshift({
      id: generateId('up'),
      type: 'room',
      url: saved.url,
      filename: saved.filename,
      userPhone: phone,
      productId,
      uploadedBy: phone ? `user:${phone}` : 'anonymous',
      size: file.data.length,
      createdAt: new Date().toISOString(),
    });
    saveUploadsContainer(container);
    return ok(res, { ok: true, url: saved.url, filename: saved.filename });
  } catch (err) {
    return fail(res, 500, `上传失败：${err.message}`);
  }
});

// ---------- 匿名试摆（无需登录，每 IP 每天 3 次限额） ----------

const ANON_TRYON_LIMIT = 3;
const ANON_TRYON_WINDOW_MS = 24 * 60 * 60 * 1000;
const anonTryonHits = new Map(); // ip -> number[] (timestamps)

function checkAnonTryonLimit(ip) {
  const now = Date.now();
  const cutoff = now - ANON_TRYON_WINDOW_MS;
  pruneHitsMap(anonTryonHits, ANON_TRYON_WINDOW_MS);
  const arr = (anonTryonHits.get(ip) || []).filter(t => t >= cutoff);
  anonTryonHits.set(ip, arr);
  if (arr.length >= ANON_TRYON_LIMIT) return false;
  arr.push(now);
  return true;
}

// ---------- 登录用户试摆限额（每用户每天 20 次，防无限打 gpt-image-2 上游） ----------
// 说明：匿名试摆已有 IP 限额，但登录后原先没有任何每用户额度，单个账号可无限烧 token。
// 这里按 session 的 userId 记次数（用户换手机号重登也是同一个 userId，换 IP 绕不过）。
const USER_TRYON_LIMIT = 20;
const USER_TRYON_WINDOW_MS = 24 * 60 * 60 * 1000;
const userTryonHits = new Map(); // userId -> number[] (timestamps)

function tryonUserKey(req) {
  const session = getSession(req);
  return session && session.userId && session.userId !== 'admin' ? session.userId : '';
}

function checkUserTryonLimit(userKey) {
  if (!userKey) return true; // 无会话 key 时不拦（requireUser 已保证有会话）
  const now = Date.now();
  const cutoff = now - USER_TRYON_WINDOW_MS;
  pruneHitsMap(userTryonHits, USER_TRYON_WINDOW_MS);
  const arr = (userTryonHits.get(userKey) || []).filter(t => t >= cutoff);
  userTryonHits.set(userKey, arr);
  if (arr.length >= USER_TRYON_LIMIT) return false;
  arr.push(now);
  return true;
}

function remainingUserTryonQuota(userKey) {
  if (!userKey) return USER_TRYON_LIMIT;
  const cutoff = Date.now() - USER_TRYON_WINDOW_MS;
  return Math.max(0, USER_TRYON_LIMIT - (userTryonHits.get(userKey) || []).filter(t => t >= cutoff).length);
}

// 路由层守卫：超限时直接回 429，返回 false 表示已被拦截（调用方 return 即可）
function guardUserTryonLimit(req, res) {
  const key = tryonUserKey(req);
  if (checkUserTryonLimit(key)) return true;
  fail(res, 429, `今天试摆次数已用完（每天 ${USER_TRYON_LIMIT} 次），欢迎到店看实物，或拨打 13359140982`);
  return false;
}

function getClientIp(req) {
  // 仅在确认部署在可信反向代理之后（TRUST_PROXY=1）才信 XFF；
  // 否则 XFF 可被任意伪造，用来绕过所有 IP 限流。默认不信。
  if (process.env.TRUST_PROXY === '1') {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket.remoteAddress || 'unknown';
}

// POST /api/tryon/ai-anon — 匿名试摆（multipart: room(file), productId, prompt?, preset?）
// 每 IP 24 小时最多 3 次；超出后引导登录
app.post('/api/tryon/ai-anon', multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).fields([
  { name: 'room', maxCount: 1 },
  { name: 'productId', maxCount: 1 },
  { name: 'prompt', maxCount: 1 },
  { name: 'preset', maxCount: 1 },
  { name: 'presetId', maxCount: 1 },
]), async (req, res) => {
  const ip = getClientIp(req);
  if (!checkAnonTryonLimit(ip)) {
    return fail(res, 429, `免费体验已用完（每天 ${ANON_TRYON_LIMIT} 次），请明天再试，或拨打门店电话 13359140982 让阿杏帮您留一个`);
  }
  try {
    const roomFile = req.files?.room?.[0];
    const productId = req.body?.productId;
    const customPrompt = (req.body?.prompt || '').trim();
    const presetRaw = req.body?.preset || req.body?.presetId || '';
    if (!roomFile) return fail(res, 400, '请上传客厅照片');
    if (!productId) return fail(res, 400, '请选择要试摆的商品');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // 拉取商品参考图（用当前 host 解析商品主图的相对 URL）
    let sofaBuffer = null;
    let productFetchError = null;
    if (product.image) {
      try {
        const productUrl = new URL(product.image, SELF_BASE);
        const r = await fetch(productUrl);
        if (r.ok) sofaBuffer = Buffer.from(await r.arrayBuffer());
        else productFetchError = `${productUrl} → HTTP ${r.status}`;
      } catch (e) { productFetchError = e.message; }
    }
    if (!sofaBuffer) {
      // 兜底图 sofa-zhongshi.jpg 已随 imgfix 删除；不用错误品类的图硬拼，明确报错让用户重选（诚实性）
      return fail(res, 502, `拉取商品图失败（${productFetchError || '商品暂无主图'}），请重新选择商品或到店体验`);
    }

    const defaultPrompt = buildTryonDefaultPrompt(product);
    const { finalPrompt, preset: presetHit } = buildFinalTryonPrompt(defaultPrompt, presetRaw, customPrompt);

    let aiBuffer = null, demoType = null, aiError = null;
    const genTrace = [];
    const genStartedAt = Date.now();
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.buffer,
        sofaBuffer,
        productImagePath: product.image,
        prompt: finalPrompt,
        trace: genTrace,
      });
      aiBuffer = r.buffer;
      demoType = r.demoType;
    } catch (err) {
      aiError = err.message;
    }

    let compositionUrl = null;
    if (aiBuffer && aiBuffer.length > 0) {
      const filename = `anon-comp-${Date.now()}.jpg`;
      const { url } = await saveImage(aiBuffer, 'compositions', filename, 'image/jpeg');
      compositionUrl = url;
    }
    recordGeneration({
      userPhone: getSessionUserPhone(req) || '',
      kind: 'tryon',
      anonymous: true,
      endpoint: '/api/tryon/ai-anon',
      productId,
      productName: product?.name || '',
      preset: presetHit,
      prompt: finalPrompt,
      status: genStatus(demoType, !!compositionUrl),
      demoType,
      compositionUrl,
      error: aiError || null,
      trace: genTrace,
      totalMs: Date.now() - genStartedAt,
    });
    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64,${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      anonymous: true,
      preset: presetHit,
      remaining: Math.max(0, ANON_TRYON_LIMIT - (anonTryonHits.get(ip) || []).filter(t => t >= Date.now() - ANON_TRYON_WINDOW_MS).length),
      message: compositionUrl
        ? (demoType === 'ai-composition' ? '匿名试摆成功' :
           demoType === 'pollinations' ? '匿名试摆成功（Pollinations 合成）' :
           '匿名试摆成功（AI 暂不可用，已展示商品预览）')
        : '合成失败',
    });
  } catch (err) {
    return fail(res, 500, `试摆失败：${err.message}`);
  }
});

// POST /api/tryon/ai — multipart: room(file), sofa(file), productId
app.post('/api/tryon/ai', requireUser, async (req, res) => {
  try {
    const parts = await parseMultipart(req).catch(() => null);
    if (!parts) return fail(res, 400, '请用 multipart/form-data 上传');
    const roomFile = getMultipartFile(parts, 'room');
    const sofaFile = getMultipartFile(parts, 'sofa');
    const productId = (getMultipartField(parts, 'productId') || '').trim();
    if (!roomFile || !sofaFile) return fail(res, 400, '请同时上传顾客客厅照和沙发图');
    if (!productId) return fail(res, 400, '请选择要试摆的商品');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    let compositionUrl = null;
    let aiError = null;
    let aiBuffer = null;
    let demoType = null;
    // 每用户每日限额（在真正打上游前拦，参数校验失败不占额度）
    if (!guardUserTryonLimit(req, res)) return;
    const genTrace = [];
    const genStartedAt = Date.now();
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.data,
        sofaBuffer: sofaFile.data,
        productImagePath: product.image,
        trace: genTrace,
      });
      aiBuffer = r.buffer;
      demoType = r.demoType;
    } catch (err) {
      aiError = err.message;
    }

    if (aiBuffer && aiBuffer.length > 0) {
      const filename = `composition-${Date.now()}.jpg`;
      const { url } = await saveImage(aiBuffer, 'compositions', filename, 'image/jpeg');
      compositionUrl = url;
    } else {
      // 失败兜底：保存顾客上传的原图作为待人工处理
      const filename = `fallback-${Date.now()}.jpg`;
      await saveImage(roomFile.data, 'compositions', filename, roomFile.contentType || 'image/jpeg');
      compositionUrl = null;
    }
    recordGeneration({
      userPhone: getSessionUserPhone(req) || '',
      kind: 'tryon',
      endpoint: '/api/tryon/ai',
      productId,
      productName: product?.name || '',
      preset: '',
      prompt: buildTryonPrompt(productId),
      status: genStatus(demoType, !!compositionUrl),
      demoType,
      compositionUrl,
      error: aiError || null,
      trace: genTrace,
      totalMs: Date.now() - genStartedAt,
    });

    const result = {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64,${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      message: compositionUrl
        ? (demoType === 'ai-composition' ? 'AI 试摆成功' :
           demoType === 'pollinations' ? 'AI 试摆成功（Pollinations 合成）' :
           'AI 暂不可用，已展示商品预览')
        : 'AI 试摆失败，已保存顾客原图，请在后台手动处理',
    };
    return ok(res, result);
  } catch (err) {
    return fail(res, 500, `试摆失败：${err.message}`);
  }
});

// POST /api/tryon/ai-custom — 用户自定义 prompt 的合成
// 字段：room(file), sofa(file), productId, prompt(用户自定义), preset(光线/风格预设 id 或中文名)
app.post('/api/tryon/ai-custom', requireUser, multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).fields([
  { name: 'room', maxCount: 1 },
  { name: 'sofa', maxCount: 1 },
  { name: 'productId', maxCount: 1 },
  { name: 'prompt', maxCount: 1 },
  { name: 'preset', maxCount: 1 },
  { name: 'presetId', maxCount: 1 },
]), async (req, res) => {
  try {
    const roomFile = req.files?.room?.[0];
    const sofaFile = req.files?.sofa?.[0];
    const productId = req.body?.productId;
    const customPrompt = (req.body?.prompt || '').trim();
    const presetRaw = req.body?.preset || req.body?.presetId || '';
    if (!roomFile || !sofaFile) return fail(res, 400, '请同时上传顾客客厅照和沙发图');
    if (!productId) return fail(res, 400, '请选择要试摆的商品');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // 默认 + 预设（光线/风格）+ 用户 prompt
    const defaultPrompt = buildTryonDefaultPrompt(product);
    const { finalPrompt, preset: presetHit } = buildFinalTryonPrompt(defaultPrompt, presetRaw, customPrompt);

    let aiBuffer = null, demoType = null, aiError = null;
    // 每用户每日限额（在真正打上游前拦，参数校验失败不占额度）
    if (!guardUserTryonLimit(req, res)) return;
    const genTrace = [];
    const genStartedAt = Date.now();
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.buffer,
        sofaBuffer: sofaFile.buffer,
        productImagePath: product.image,
        prompt: finalPrompt,
        trace: genTrace,
      });
      aiBuffer = r.buffer;
      demoType = r.demoType;
    } catch (err) {
      aiError = err.message;
    }

    let compositionUrl = null;
    if (aiBuffer && aiBuffer.length > 0) {
      const filename = `composition-custom-${Date.now()}.jpg`;
      const { url } = await saveImage(aiBuffer, 'compositions', filename, 'image/jpeg');
      compositionUrl = url;
    }
    recordGeneration({
      userPhone: getSessionUserPhone(req) || '',
      kind: 'tryon',
      endpoint: '/api/tryon/ai-custom',
      productId,
      productName: product?.name || '',
      preset: presetHit,
      prompt: finalPrompt,
      status: genStatus(demoType, !!compositionUrl),
      demoType,
      compositionUrl,
      error: aiError || null,
      trace: genTrace,
      totalMs: Date.now() - genStartedAt,
    });
    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64,${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      customPrompt,
      preset: presetHit,
      message: compositionUrl
        ? (demoType === 'ai-composition' ? '自定义 prompt 合成成功' :
           demoType === 'pollinations' ? '自定义 prompt 合成成功（Pollinations 合成）' :
           'AI 暂不可用，已展示商品预览')
        : '合成失败',
    });
  } catch (err) {
    return fail(res, 500, `试摆失败：${err.message}`);
  }
});

// GET /api/tryon/presets — 5 个预设 prompt 模板（从 presets.json 读取，可后台编辑）
app.get('/api/tryon/presets', (req, res) => {
  res.json({ presets: loadPresets() });
});

// GET /api/feature-flags — 公开端点，前端用来控制 UI 行为（如强制填手机号）
app.get('/api/feature-flags', (req, res) => {
  return ok(res, loadFeatureFlags());
});

// GET /api/categories — v3 首页"板块"数据源。含 enabled 标志，前端按 enabled + 有在售商品渲染板块。
app.get('/api/categories', (req, res) => {
  try {
    const categories = loadCategories().map(c => ({
      id: c.id,
      name: c.name || c.id,
      room: c.room || '',
      noun: c.noun || '',
      defaultRoom: c.defaultRoom || '/images/default-room.jpg',
      badge: c.badge || '',
      enabled: c.enabled !== false,
      sort: c.sort || 999,
    }));
    return ok(res, { categories });
  } catch (err) {
    return fail(res, 500, '读取品类配置失败');
  }
});

// ---------- API: 全屋定制（Phase 1） ----------
//
// GET  /api/whole-home/styles      → 6 张风格卡（公开）
// POST /api/whole-home/recommend   → 基于 analyze 记录 + style 卡生成推荐方案（公开）
//
// Phase 1 只读 data/whole-home-styles.json，不调 AI，estPrice 暂填"面议"
// 未来柜/床/桌上线后，往 style 卡的 skuBinding 追加即可，路由签名不变

// GET /api/whole-home/styles — 返回所有风格卡（按 priority 升序）
app.get('/api/whole-home/styles', (req, res) => {
  try {
    const styles = loadWholeHomeStyles();
    return ok(res, { styles, total: styles.length });
  } catch (err) {
    return fail(res, 500, '读取风格卡失败');
  }
});

// POST /api/whole-home/recommend
// 入参：{ analyzeId, styleId, budget? }
//   - analyzeId：来自 POST /api/whole-home/analyze 返回的 id（whan- 开头，存在 data/uploads.json 的
//     wholeHomeAnalyzes[] 数组里；不在 uploads[] 里，别去那儿找，否则必然 404）
//   - styleId：上面 GET /api/whole-home/styles 返回的某个 style.id
//   - budget：可选，客户预算区间（字符串，e.g. "10-12万"），原样回显
app.post('/api/whole-home/recommend', (req, res) => {
  try {
    const body = req.body || {};
    const { analyzeId, styleId } = body;
    const budget = typeof body.budget === 'string' ? body.budget.trim().slice(0, 30) : '';

    if (!analyzeId || typeof analyzeId !== 'string') return fail(res, 400, 'analyzeId 必填');
    if (!styleId || typeof styleId !== 'string') return fail(res, 400, 'styleId 必填');

    // 1) 读 analyze 记录（/api/whole-home/analyze 写入 uploads.json 的 wholeHomeAnalyzes[]）
    const uploadsContainer = loadUploadsContainer();
    const analyzeList = Array.isArray(uploadsContainer.wholeHomeAnalyzes)
      ? uploadsContainer.wholeHomeAnalyzes
      : [];
    const analyzeRecord = analyzeList.find(a => a && a.id === analyzeId);
    if (!analyzeRecord) {
      return fail(res, 404, '找不到该全屋分析记录（请先调 /api/whole-home/analyze 上传房间照片）');
    }

    // 2) 读风格卡
    const style = findWholeHomeStyle(styleId);
    if (!style) return fail(res, 404, `找不到风格卡: ${styleId}`);

    // 3) analyze 里每间房的分析结论（roomType / sizeEstimate / lightingDirection / mainColor /
    //    suggestedItems / estimatedBudget / originalUrl）
    const analyzedRooms = Array.isArray(analyzeRecord.rooms) ? analyzeRecord.rooms : [];

    // 4) 房间清单：风格卡声明的房间 + analyze 实际分析出的房间类型（去重，保持顺序）
    const styleRooms = Array.isArray(style.rooms) && style.rooms.length > 0 ? style.rooms.slice() : [];
    const roomSeen = new Set(styleRooms);
    for (const r of analyzedRooms) {
      const t = String(r && r.roomType || '').trim();
      if (t && t !== '未知' && !roomSeen.has(t)) { styleRooms.push(t); roomSeen.add(t); }
    }
    if (styleRooms.length === 0) styleRooms.push('客厅');
    const binding = Array.isArray(style.skuBinding) ? style.skuBinding : [];

    const roomRoleHints = {
      '客厅': ['客厅', '会客'],
      '主卧': ['主卧', '主位'],
      '次卧': ['次卧'],
      '老人房': ['老人', '老人房'],
      '儿童房': ['儿童', '儿童房', '小孩', '游戏区'],
      '书房': ['书房', '阅读'],
      '茶室': ['茶室', '禅修'],
      '餐厅': ['餐厅'],
    };

    const itemsByRoom = {};
    for (const r of styleRooms) itemsByRoom[r] = [];

    for (const item of binding) {
      const roleText = item.role || '';
      let matched = false;
      for (const [room, hints] of Object.entries(roomRoleHints)) {
        if (styleRooms.includes(room) && hints.some(h => roleText.includes(h))) {
          itemsByRoom[room].push({
            productId: item.productId,
            role: item.role,
            note: item.note || '',
            estPrice: '面议', // Phase 1：products.json 没 price 字段
          });
          matched = true;
          break;
        }
      }
      // 兜底：如果 role 匹配不到房间，且 binding 只有 1 件，就丢给"客厅"（最常见）
      if (!matched) {
        const fallbackRoom = styleRooms.includes('客厅') ? '客厅' : styleRooms[0];
        itemsByRoom[fallbackRoom].push({
          productId: item.productId,
          role: item.role,
          note: item.note || '',
          estPrice: '面议',
        });
      }
    }

    // 5) 组装 rooms：每个房间 = 现场分析结论 + AI 建议补的家具 + 风格卡绑定的 SKU
    const rooms = styleRooms.map(roomType => {
      const a = analyzedRooms.find(r => String(r && r.roomType || '').trim() === roomType) || null;
      return {
        roomType,
        analysis: a ? {
          roomSize: a.sizeEstimate || a.roomSize || '',
          currentStyle: a.style || '',
          lightingDirection: a.lightingDirection || '',
          mainColor: a.mainColor || '',
          suggestedItems: Array.isArray(a.suggestedItems) ? a.suggestedItems : [],
          estimatedBudget: a.estimatedBudget || '',
          imageUrl: a.originalUrl ? fixImageUrl(a.originalUrl) : '',
        } : null,
        items: itemsByRoom[roomType] || [],
      };
    });

    // 汇总整套方案要补的家具（AI 每间房 suggestedItems 的并集，去重）
    const suggestedItems = [];
    for (const r of analyzedRooms) {
      for (const s of (Array.isArray(r.suggestedItems) ? r.suggestedItems : [])) {
        const t = String(s || '').trim();
        if (t && !suggestedItems.includes(t)) suggestedItems.push(t);
      }
    }

    // 6) deliveryPlan — 规则：含"沙发"的 SKU 先发（14 天），其余后发（28-35 天）
    //    优先用风格卡自带的 deliveryPlan 文案，没有再用默认值
    const sofaItems = binding.filter(b => (b.role || '').includes('沙发'));
    const otherItems = binding.filter(b => !(b.role || '').includes('沙发'));
    const cardPlan = style.deliveryPlan || {};
    const deliveryPlan = {
      batch1: {
        label: (cardPlan.batch1 && cardPlan.batch1.label) || '沙发先发（先行到家）',
        eta: (cardPlan.batch1 && cardPlan.batch1.eta) || '下单后 14 天到货',
        items: sofaItems.map(b => ({ productId: b.productId, role: b.role })),
      },
      batch2: {
        label: (cardPlan.batch2 && cardPlan.batch2.label) || '柜、床、桌后补（后续到位）',
        eta: (cardPlan.batch2 && cardPlan.batch2.eta) || '下单后 28-35 天到货',
        items: otherItems.map(b => ({ productId: b.productId, role: b.role })),
        note: 'Phase 1 暂只有沙发；柜/床/桌上线后会自动补齐此批次',
      },
    };

    // 7) 拼 plan 主体
    const roomImageUrls = (Array.isArray(analyzeRecord.roomImageUrls) ? analyzeRecord.roomImageUrls : [])
      .map(u => fixImageUrl(u))
      .filter(Boolean);
    const plan = {
      analyzeId,
      analyze: {
        id: analyzeRecord.id,
        uploadedAt: analyzeRecord.createdAt,
        userPhone: analyzeRecord.phone || '',
        roomImageUrls,
        roomCount: analyzedRooms.length,
        overallStyle: analyzeRecord.overallStyle || analyzeRecord.style || '',
        budgetSuggestion: analyzeRecord.budgetSuggestion || '',
      },
      style: {
        id: style.id,
        name: style.name,
        tagline: style.tagline,
        description: style.description,
        targetAudience: style.targetAudience || [],
        aiPromptHint: style.aiPromptHint,
      },
      budget: budget || analyzeRecord.budgetSuggestion || '面议',
      rooms,
      suggestedItems,
      deliveryPlan,
      note: 'Phase 1 体验版：仅绑定现有 3 款沙发，柜/床/桌上线后会自动扩展；estPrice 暂为「面议」，到店看货报价',
      generatedAt: new Date().toISOString(),
    };

    return ok(res, { plan });
  } catch (err) {
    console.error('[whole-home/recommend] error:', err);
    return fail(res, 500, '生成推荐方案失败: ' + err.message);
  }
});

// GET /api/whole-home/history?phone=xxx&limit=20 — 我的家：按手机号查该用户的全屋分析历史
//   每条 = 照片（roomImageUrls）+ 当时的推荐结论（整体风格/预算/每房建议家具）
// 隐私：登录用户只能查自己手机号（403）；未登录仍可查但按 IP 限额（复用试摆历史的计数器，
//   同一「防枚举拖库」目的），避免被当成按手机号扫库的口子。
app.get('/api/whole-home/history', (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 50);
    if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
    const myPhone = getSessionUserPhone(req);
    if (myPhone && myPhone !== phone) return fail(res, 403, '只能查询自己手机号的历史');
    if (!myPhone && !checkTryonHistoryLimit(getClientIp(req))) {
      return fail(res, 429, `今天查询次数已用完（每天 ${TRYON_HISTORY_LIMIT} 次），请明天再试，或拨打门店电话 13359140982`);
    }
    const container = loadUploadsContainer();
    const analyses = (Array.isArray(container.wholeHomeAnalyzes) ? container.wholeHomeAnalyzes : [])
      .filter(a => a && a.phone === phone)
      .slice(0, limit)
      .map(a => ({
        id: a.id,
        createdAt: a.createdAt,
        overallStyle: a.overallStyle || a.style || '',
        budgetSuggestion: a.budgetSuggestion || '',
        roomImageUrls: (Array.isArray(a.roomImageUrls) ? a.roomImageUrls : [])
          .map(u => fixImageUrl(u)).filter(Boolean),
        rooms: (Array.isArray(a.rooms) ? a.rooms : []).map(r => ({
          roomType: r.roomType || '',
          sizeEstimate: r.sizeEstimate || r.roomSize || '',
          lightingDirection: r.lightingDirection || '',
          mainColor: r.mainColor || '',
          style: r.style || '',
          suggestedItems: Array.isArray(r.suggestedItems) ? r.suggestedItems : [],
          estimatedBudget: r.estimatedBudget || '',
        })),
      }));
    return ok(res, { analyses, total: analyses.length });
  } catch (err) {
    console.error('[whole-home/history] error:', err);
    return fail(res, 500, '查询历史失败: ' + err.message);
  }
});

// GET /api/admin/feature-flags — 后台查看
app.get('/api/admin/feature-flags', requireAdmin, (req, res) => {
  return ok(res, loadFeatureFlags());
});

// PUT /api/admin/feature-flags — 后台修改
app.put('/api/admin/feature-flags', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const flags = {
      tryonRequirePhone: body.tryonRequirePhone === true,
      tryonRequirePhoneMessage: String(body.tryonRequirePhoneMessage || '').slice(0, 200),
    };
    writeJSON(FEATURE_FLAGS_FILE, flags);
    return ok(res, flags);
  } catch (err) {
    return fail(res, 500, '保存开关失败');
  }
});

// GET /api/admin/presets — 后台读取（与公开端点同一份数据）
app.get('/api/admin/presets', requireAdmin, (req, res) => {
  return ok(res, { presets: loadPresets() });
});

// PUT /api/admin/presets — 后台保存（body: { presets: Preset[] }）
app.put('/api/admin/presets', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.presets) || body.presets.length === 0) {
      return fail(res, 400, 'presets 必填（数组）');
    }
    const cleaned = body.presets.map(p => ({
      id: String(p.id || '').trim() || `p-${Date.now().toString(36)}`,
      name: String(p.name || '').trim().slice(0, 30) || '未命名',
      prompt: String(p.prompt || '').slice(0, 1000),
    })).filter(p => p.id);
    savePresets(cleaned);
    return ok(res, { presets: cleaned });
  } catch (err) {
    return fail(res, 500, '保存提示词失败');
  }
});

// GET /api/admin/categories — 后台读取品类（含 defaultRoom 图片 URL）
app.get('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    return ok(res, { categories: loadCategories() });
  } catch (err) {
    return fail(res, 500, '读取品类配置失败');
  }
});

// PUT /api/admin/categories — 后台保存品类文字字段（name/room/noun/badge/sort/enabled）。
// 不动 defaultRoom 图片本身——换图走 POST /api/admin/categories/:id/room-image。
app.put('/api/admin/categories', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.categories) || body.categories.length === 0) {
      return fail(res, 400, 'categories 不能为空');
    }
    const prevById = new Map(loadCategories().map(c => [c.id, c]));
    const cleaned = body.categories.map(c => {
      const id = String(c?.id || '').trim();
      if (!id) return null;
      const prev = prevById.get(id) || {};
      const num = parseInt(c.sort, 10);
      return {
        id,
        name: String(c.name || '').trim().slice(0, 30) || (prev.name || id),
        room: String(c.room || '').trim().slice(0, 20),
        noun: String(c.noun || '').trim().slice(0, 20),
        defaultRoom: prev.defaultRoom || '/images/default-room.jpg',
        badge: String(c.badge || '').trim().slice(0, 10),
        sort: Number.isFinite(num) ? num : (prev.sort || 999),
        enabled: c.enabled !== false,
      };
    }).filter(Boolean);
    if (cleaned.length === 0) return fail(res, 400, '没有有效的品类');
    saveCategories(cleaned);
    return ok(res, { categories: cleaned });
  } catch (err) {
    return fail(res, 500, '保存品类配置失败');
  }
});

// POST /api/admin/categories/:id/room-image — 更换某品类默认房间图（multer 单文件 + sharp 压缩）。
// 顾客没上传自家照片时，试摆用这个默认房间图，故要一张空旷房间图（别带沙发）。
app.post('/api/admin/categories/:id/room-image', requireAdmin,
  multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file'),
  async (req, res) => {
    try {
      if (!req.file) return fail(res, 400, '请选择一张房间照片');
      const fileErr = checkUploadFile(req.file);
      if (fileErr) return fail(res, 400, fileErr);
      const id = String(req.params.id || '').trim();
      const categories = loadCategories();
      const cat = categories.find(c => c.id === id);
      if (!cat) return fail(res, 404, '品类不存在');
      // 压成 JPEG：房间图不需要原图尺寸，控制体积利于前端加载
      const { default: sharp } = await import('sharp');
      const jpeg = await sharp(req.file.buffer)
        .resize({ width: 1280, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const filename = `default-${id}-${Date.now().toString(36)}.jpg`;
      const { url } = await saveImage(jpeg, 'default-rooms', filename, 'image/jpeg');
      cat.defaultRoom = url;
      saveCategories(categories);
      return ok(res, { categories, url });
    } catch (err) {
      return fail(res, 500, `换图失败: ${err.message}`);
    }
  }
);

// POST /api/tryon/ai-history — 历史图场景：JSON 入参 {productId, roomUrl, phone?, prompt?, preset?}
app.post('/api/tryon/ai-history', requireUser, async (req, res) => {
  try {
    const body = req.body || {};
    const { productId, roomUrl, phone } = body;
    const customPrompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const presetRaw = body.preset || body.presetId || '';
    if (!productId || !roomUrl) return fail(res, 400, 'productId 和 roomUrl 必填');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // SSRF 防护：roomUrl 只接受本站相对路径（/uploads/... 或 /images/...），
    // 解析后 host 必须落在本服务上，拒绝任何外网/内网绝对 URL（含云元数据 169.254.169.254）
    const roomUrlRaw = String(roomUrl).trim();
    const ROOM_URL_PREFIXES = ['/uploads/', '/images/'];
    if (!ROOM_URL_PREFIXES.some((p) => roomUrlRaw.startsWith(p))) {
      return fail(res, 400, '只能用本站的客厅图');
    }
    let roomFetchUrl;
    try {
      const parsed = new URL(roomUrlRaw, `http://127.0.0.1:${PORT}`);
      if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
        return fail(res, 400, '只能用本站的客厅图');
      }
      roomFetchUrl = parsed.toString();
    } catch (e) {
      return fail(res, 400, '客厅图地址不对');
    }

    // 拉取历史图
    const roomResp = await fetch(roomFetchUrl);
    if (!roomResp.ok) return fail(res, 502, '拉取历史客厅图失败');
    const roomBuffer = Buffer.from(await roomResp.arrayBuffer());

    // 拉取商品图
    if (!product.image) return fail(res, 502, '商品暂无主图，请重新选择商品或到店体验');
    const productResp = await fetch(new URL(product.image, `http://127.0.0.1:${PORT}`));
    if (!productResp.ok) return fail(res, 502, '拉取商品图失败');
    const sofaBuffer = Buffer.from(await productResp.arrayBuffer());

    let aiBuffer = null, demoType = null, aiError = null;
    // 每用户每日限额（在真正打上游前拦，参数校验失败不占额度）
    if (!guardUserTryonLimit(req, res)) return;
    // 默认 + 预设（光线/风格）+ 用户 prompt，与 ai-custom 同一套拼装规则
    const defaultPrompt = buildTryonDefaultPrompt(product);
    const { finalPrompt, preset: presetHit } = buildFinalTryonPrompt(defaultPrompt, presetRaw, customPrompt);
    const genTrace = [];
    const genStartedAt = Date.now();
    try {
      const r = await callTryonAI({
        productId, roomBuffer, sofaBuffer, productImagePath: product.image,
        prompt: finalPrompt,
        trace: genTrace,
      });
      aiBuffer = r.buffer;
      demoType = r.demoType;
    } catch (err) {
      aiError = err.message;
    }

    let compositionUrl = null;
    if (aiBuffer && aiBuffer.length > 0) {
      const filename = `composition-${Date.now()}.jpg`;
      const { url } = await saveImage(aiBuffer, 'compositions', filename, 'image/jpeg');
      compositionUrl = url;
      const container = loadUploadsContainer();
      container.uploads.unshift({
        id: generateId('up'),
        type: 'composition',
        url: compositionUrl,
        filename,
        userPhone: phone || '',
        productId,
        uploadedBy: phone ? `user:${phone}` : 'anonymous',
        size: aiBuffer.length,
        createdAt: new Date().toISOString(),
      });
      saveUploadsContainer(container);
    }
    recordGeneration({
      userPhone: phone || getSessionUserPhone(req) || '',
      kind: 'tryon',
      endpoint: '/api/tryon/ai-history',
      productId,
      productName: product?.name || '',
      preset: presetHit,
      prompt: finalPrompt,
      status: genStatus(demoType, !!compositionUrl),
      demoType,
      compositionUrl,
      error: aiError || null,
      trace: genTrace,
      totalMs: Date.now() - genStartedAt,
    });

    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64;${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      preset: presetHit,
      message: compositionUrl
        ? (demoType === 'ai-composition' ? 'AI 试摆成功（历史图）' :
           demoType === 'pollinations' ? 'AI 试摆成功（Pollinations 合成）' :
           'AI 暂不可用，已展示商品预览')
        : '合成失败',
    });
  } catch (err) {
    return fail(res, 500, `试摆失败：${err.message}`);
  }
});

// POST /api/admin/login -> {username, password}
// 安全：按 IP 防爆破——连续失败 5 次锁 15 分钟（仿 IP 限流 Map 模式）
const ADMIN_LOGIN_MAX_FAILS = 5;
const ADMIN_LOGIN_LOCK_MS = 15 * 60 * 1000;
const adminLoginFails = new Map(); // ip -> { count, lockedUntil }

function adminLoginLocked(ip) {
  const rec = adminLoginFails.get(ip);
  if (!rec) return false;
  if (rec.lockedUntil && rec.lockedUntil > Date.now()) return true;
  if (rec.lockedUntil) adminLoginFails.delete(ip); // 锁已过期，重新计数
  return false;
}

function recordAdminLoginFail(ip) {
  const rec = adminLoginFails.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= ADMIN_LOGIN_MAX_FAILS) {
    rec.lockedUntil = Date.now() + ADMIN_LOGIN_LOCK_MS;
    console.warn(`[admin-login] ip=${ip} 连续失败 ${rec.count} 次，锁定 ${ADMIN_LOGIN_LOCK_MS / 60000} 分钟`);
  }
  adminLoginFails.set(ip, rec);
}

app.post('/api/admin/login', (req, res) => {
  try {
    const body = req.body || {};
    const ip = getClientIp(req);
    if (adminLoginLocked(ip)) {
      return fail(res, 429, `密码错误次数太多，请 ${ADMIN_LOGIN_LOCK_MS / 60000} 分钟后再试`);
    }
    if (body.username === ADMIN_USER && body.password === ADMIN_PASSWORD) {
      adminLoginFails.delete(ip); // 登录成功清掉失败记录
      const token = attachSession('admin');
      setSessionCookie(res, token);
      return ok(res, { ok: true, token });
    }
    recordAdminLoginFail(ip);
    return fail(res, 401, '用户名或密码不对');
  } catch (err) {
    return fail(res, 500, '登录失败');
  }
});

// ---------- API: 全屋定制 Phase 1 analyze ----------
//
// POST /api/whole-home/analyze
//   multipart: rooms[0..n] (3-6 张图), phone? (string), style? (id 或中文名)
//
// 流程：sharp 缩图到 1024 宽 → 每张调豆包 doubao-seed-2-1-pro-260628 出结构化 JSON
//      → 累加成 rooms[] + overallStyle + budgetSuggestion → 写到 uploads.json 的
//      wholeHomeAnalyzes[] 数组里。
// 限额：单 IP 每 24h 最多 5 次（参考 /api/tryon/ai-anon 的 anon 限额模式）

// 风格别名：用户传"商洛暖居"/"陕南暖居风"/"shangluo-nuanju" 都认
// 统一映射成"陕南暖居风"（与 data/whole-home-styles.json 的 name 字段对齐）
const WHOLE_HOME_STYLE_ALIASES = new Map([
  ['shangluo-nuanju', '陕南暖居风'],
  ['陕南暖居风', '陕南暖居风'],
  ['陕南暖居', '陕南暖居风'],
  ['商洛暖居', '陕南暖居风'],
  ['商洛暖居风', '陕南暖居风'],
  ['sandai-tongtang', '三代同堂'],
  ['三代同堂', '三代同堂'],
  ['hunfang-naiyou', '婚房奶油风'],
  ['hunfang-nuoni', '婚房奶油风'],
  ['婚房奶油风', '婚房奶油风'],
  ['婚房奶油', '婚房奶油风'],
  ['jianyue-beiou', '简约北欧'],
  ['简约北欧', '简约北欧'],
  ['xinzhongshi', '新中式'],
  ['xin-zhongshi', '新中式'],
  ['新中式', '新中式'],
  ['jijian-chaji', '极简侘寂'],
  ['极简侘寂', '极简侘寂'],
]);
const WHOLE_HOME_STYLE_OFFICIAL = [...new Set(WHOLE_HOME_STYLE_ALIASES.values())];

const WHOLE_HOME_LIMIT = 5;
const WHOLE_HOME_WINDOW_MS = 24 * 60 * 60 * 1000;
const wholeHomeHits = new Map(); // ip -> number[] (timestamps)

function checkWholeHomeLimit(ip) {
  const now = Date.now();
  const cutoff = now - WHOLE_HOME_WINDOW_MS;
  const arr = (wholeHomeHits.get(ip) || []).filter(t => t >= cutoff);
  wholeHomeHits.set(ip, arr);
  if (arr.length >= WHOLE_HOME_LIMIT) return false;
  arr.push(now);
  return true;
}

function remainingWholeHomeQuota(ip) {
  const now = Date.now();
  const cutoff = now - WHOLE_HOME_WINDOW_MS;
  return Math.max(
    0,
    WHOLE_HOME_LIMIT - (wholeHomeHits.get(ip) || []).filter(t => t >= cutoff).length
  );
}

// 豆包 prompt：严格只回 JSON，禁止 markdown / 说明 / 思考 / 前缀
// 字段对齐到豆包语义（roomSize / currentStyle 等），服务端再映射回 API 合同字段
function buildWholeHomePrompt({ style, phone }) {
  const styleHint = style
    ? `\n【客户倾向风格】${style}（请在 currentStyle / suggestedItems 中呼应）`
    : '';
  const phoneHint = phone
    ? `\n【客户手机号】${phone}（仅用于回访，不进 JSON）`
    : '';
  return `【任务】分析这一张中国家庭的室内照片，输出结构化信息。
【背景】商洛本地（陕南小城），客户预算 1-10 万元。
【图片】base64 内嵌在消息里${styleHint}${phoneHint}
【输出 JSON 格式】（严格按字段，缺字段视为不合格）
{
  "roomType": "客厅/主卧/次卧/餐厅/厨房/书房/儿童房/卫生间/阳台/玄关 之一",
  "roomSize": "约 15-20 平米（按视觉估）",
  "currentStyle": "现有风格，新中式/北欧/极简/侘寂/美式/工业/混搭 之一",
  "lightingDirection": "南/北/东/西（按窗户高亮估）",
  "mainColor": "#XXXXXX 三个主色 hex",
  "suggestedItems": ["应补的家具类型，如：3 人位沙发 + 茶几 + 电视柜"],
  "estimatedBudget": "¥数字"
}
【严格要求】只回 JSON 对象。不要 markdown 代码块（不要 \`\`\`json 包裹）、
不要说明文字、不要思考过程、不要"以下是 JSON"前缀。
直接以 { 开头，以 } 结尾。无任何多余字符。`;
}

async function compressRoomImage(buffer) {
  const { default: sharp } = await import('sharp');
  return await sharp(buffer)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function analyzeOneRoomWithDoubao({ imageBuffer, style, phone }) {
  const provider = visionProvider();
  if (!provider) {
    throw new Error('未配置 STEP_API_KEY 或 ARK_API_KEY（请检查 .env）');
  }
  const b64 = imageBuffer.toString('base64');
  const prompt = buildWholeHomePrompt({ style, phone });
  const body = {
    model: provider.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: 'text', text: prompt },
      ],
    }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };
  const resp = await fetch(provider.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.key}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`视觉模型 API ${resp.status}：${text.slice(0, 180) || '(empty body)'}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content) throw new Error('豆包返回为空');

  // 三段解析：直 parse → 剥 ```json 围栏 → 抓第一对 {...}
  let parsed = null;
  try { parsed = JSON.parse(content); }
  catch (_) {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) {
      try { parsed = JSON.parse(fence[1]); } catch (_) { /* fall through */ }
    }
    if (!parsed) {
      const brace = content.match(/\{[\s\S]*\}/);
      if (brace) {
        try { parsed = JSON.parse(brace[0]); } catch (_) { /* fall through */ }
      }
    }
    if (!parsed) throw new Error('豆包 JSON 解析失败：' + content.slice(0, 120));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('豆包 JSON 不是对象');
  }

  // 字段映射：豆包字段（step 2 prompt） → API 合同字段（step 1c）
  const roomType = String(parsed.roomType || '未知').trim().slice(0, 30) || '未知';
  const styleOut = String(parsed.currentStyle || parsed.style || '').trim().slice(0, 30) || '未识别';
  const sizeEstimate = String(parsed.roomSize || parsed.sizeEstimate || '').trim().slice(0, 50) || '未知';
  const lightingDirection = String(parsed.lightingDirection || '').trim().slice(0, 10) || '未知';
  const rawMain = String(parsed.mainColor || '').trim();
  const mainColor = /^#[0-9a-fA-F]{6}$/.test(rawMain) ? rawMain : '#888888';
  const suggestedItems = Array.isArray(parsed.suggestedItems)
    ? parsed.suggestedItems.map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, 10)
    : [];
  const estimatedBudget = String(parsed.estimatedBudget || '').trim().slice(0, 30);

  return {
    roomType,
    style: styleOut,
    sizeEstimate,
    lightingDirection,
    mainColor,
    suggestedItems,
    estimatedBudget,
  };
}

function computeOverallStyle({ userStyle, rooms }) {
  if (userStyle) return userStyle;
  const counts = new Map();
  for (const r of rooms) {
    const s = (r.style || '').trim();
    if (!s || s === '未识别') continue;
    counts.set(s, (counts.get(s) || 0) + 1);
  }
  if (counts.size === 0) return WHOLE_HOME_STYLE_OFFICIAL[3] || '简约北欧';
  let best = '';
  let bestN = 0;
  for (const [s, c] of counts) {
    if (c > bestN) { best = s; bestN = c; }
  }
  return best || WHOLE_HOME_STYLE_OFFICIAL[3] || '简约北欧';
}

function fmtMoney(v) {
  if (v >= 10000) {
    const w = v / 10000;
    return (Math.round(w * 10) / 10).toFixed(1).replace(/\.0$/, '') + '万';
  }
  return Math.round(v / 1000) + 'k';
}

function computeBudgetSuggestion(rooms) {
  const n = rooms.length || 1;
  // 软装基数：每张图 8k-12k，按张数叠加
  let low = 8000 * n;
  let high = 12000 * n;

  // 豆包 estimatedBudget 里的最大数字作为高点参考
  let userPeak = 0;
  for (const r of rooms) {
    const m = (r.estimatedBudget || '').match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const v = parseFloat(m[1]);
      if (Number.isFinite(v) && v > 100) userPeak = Math.max(userPeak, v);
    }
  }
  if (userPeak > high) high = userPeak;

  // 1-10 万硬上限（用户提到的预算区间）
  if (low < 10000) low = 10000;
  if (low > 30000) low = 30000;
  if (high > 100000) high = 100000;

  return `¥${fmtMoney(low)} - ¥${fmtMoney(high)}`;
}

const wholeHomeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
}).fields([
  { name: 'rooms', maxCount: 6 },
  { name: 'phone', maxCount: 1 },
  { name: 'style', maxCount: 1 },
]);

// POST /api/whole-home/analyze — 全屋分析入口
app.post('/api/whole-home/analyze', (req, res) => {
  wholeHomeUpload(req, res, async (multerErr) => {
    if (multerErr) {
      if (multerErr.code === 'LIMIT_FILE_SIZE') return fail(res, 400, '单张图片不能超过 15MB，请压缩后重传');
      if (multerErr.code === 'LIMIT_FILE_COUNT' || multerErr.code === 'LIMIT_UNEXPECTED_FILE') {
        return fail(res, 400, '一次最多 6 张房间照片');
      }
      return fail(res, 400, '上传失败：' + (multerErr.message || '未知错误'));
    }

    const ip = getClientIp(req);
    if (!checkWholeHomeLimit(ip)) {
      return fail(res, 429, `全屋分析每天限 ${WHOLE_HOME_LIMIT} 次，请登录以提升额度（剩余 ${remainingWholeHomeQuota(ip)} 次）`);
    }

    const roomFiles = Array.isArray(req.files?.rooms) ? req.files.rooms : [];
    if (roomFiles.length < 3) return fail(res, 400, '请至少上传 3 张房间照片');
    if (roomFiles.length > 6) return fail(res, 400, '一次最多 6 张房间照片');

    const phoneRaw = String(req.body?.phone || '').trim();
    const styleRaw = String(req.body?.style || '').trim();
    if (phoneRaw && !isValidPhone(phoneRaw)) {
      return fail(res, 400, '手机号格式不对（11 位、1 开头）');
    }
    let officialStyle = '';
    if (styleRaw) {
      officialStyle = WHOLE_HOME_STYLE_ALIASES.get(styleRaw) || '';
      if (!officialStyle) {
        return fail(res, 400, `风格只能是：${WHOLE_HOME_STYLE_OFFICIAL.join(' / ')}`);
      }
    }

    const roomsAnalyzed = [];
    const roomsPersisted = [];
    let i = 0;
    for (const f of roomFiles) {
      i++;
      // 0) 文件类型/大小校验（multer 路径也要拦，防 .svg 落盘被 /uploads 以 image/svg+xml 托管 → XSS）
      const fileErr = checkUploadFile(f);
      if (fileErr) return fail(res, 400, fileErr);
      try {
        // 1) 原图持久化（MinIO → 本地 fallback）
        const ext = safeImageExt(f.originalname, f.mimetype);
        const persistName = `whan-${Date.now()}-${i}-${crypto.randomBytes(4).toString('hex')}${ext}`;
        const persisted = await saveImage(f.buffer, 'rooms', persistName, f.mimetype || 'image/jpeg');
        roomsPersisted.push(persisted.url);

        // 2) 压到 1024 宽再调豆包（降 token + 提速）
        const compressed = await compressRoomImage(f.buffer);
        // 3) 豆包结构化分析
        const one = await analyzeOneRoomWithDoubao({
          imageBuffer: compressed,
          style: officialStyle,
          phone: phoneRaw,
        });
        roomsAnalyzed.push({ ...one, originalUrl: persisted.url, index: i });
      } catch (err) {
        console.warn(`[whole-home] room #${i} failed: ${err.message}`);
        return fail(res, 502, `第 ${i} 张图分析失败：${err.message}`);
      }
    }

    const analyzeId = generateId('whan');
    const overallStyle = computeOverallStyle({ userStyle: officialStyle, rooms: roomsAnalyzed });
    const budgetSuggestion = computeBudgetSuggestion(roomsAnalyzed);

    // 写 uploads.json 的 wholeHomeAnalyzes[]（与现有 uploads[] 并列，独立数组）
    try {
      const container = loadUploadsContainer();
      if (!Array.isArray(container.wholeHomeAnalyzes)) container.wholeHomeAnalyzes = [];
      container.wholeHomeAnalyzes.unshift({
        id: analyzeId,
        type: 'whole-home-analyze',
        phone: phoneRaw,
        userStyle: officialStyle,
        style: overallStyle,
        rooms: roomsAnalyzed,
        overallStyle,
        budgetSuggestion,
        roomImageUrls: roomsPersisted,
        ip,
        uploadedBy: phoneRaw ? `user:${phoneRaw}` : 'anonymous',
        createdAt: new Date().toISOString(),
      });
      if (container.wholeHomeAnalyzes.length > 1000) {
        container.wholeHomeAnalyzes = container.wholeHomeAnalyzes.slice(0, 1000);
      }
      saveUploadsContainer(container);
    } catch (err) {
      console.warn(`[whole-home] persist analyze record failed: ${err.message}`);
    }

    return ok(res, {
      analyzeId,
      rooms: roomsAnalyzed,
      overallStyle,
      budgetSuggestion,
      message: `已分析 ${roomsAnalyzed.length} 张照片，整体推荐「${overallStyle}」，预算 ${budgetSuggestion}`,
      remaining: remainingWholeHomeQuota(ip),
    });
  });
});

function requireUser(req, res, next) {
  const session = getSession(req);
  if (!session) return fail(res, 401, '请先登录后再试摆');
  if (session.userId === 'admin') return fail(res, 403, '请用顾客账号登录');
  next();
}

function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (session && session.userId === 'admin') return next();
  return fail(res, 401, '请先登录后台');
}

app.use('/admin/api', requireAdmin);

// JSON parse error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return fail(res, 400, '请求体不是合法 JSON');
  }
  return next(err);
});

// ---------- AI 语音导购 · 实时流式模式（stepaudio-2.5-realtime 全双工 WebSocket 代理） ----------
// 浏览器 WS → 本服务（注入商品库人设、限流）→ wss://api.stepfun.com/step_plan/v1/realtime
// 交互节奏：点话筒开始说话（推流）→ 再点结束（commit + response.create）→ 首包音频约 0.7s 流式返回
const VOICE_RT_MAX_SESSIONS = parseInt(process.env.VOICE_RT_MAX_SESSIONS || '3', 10);
// 实时语音模型：StepAudio 3 Realtime（限免预览版，走开放平台路径 wss://api.stepfun.com/v1）
// 注意：StepAudio 3 系列在 Step Plan 订阅路径不可用（404）；限免到期后需切换正式版或回退 stepaudio-2.5-realtime
const VOICE_RT_MODEL = process.env.STEP_RT_MODEL || 'stepaudio-3-realtime-preview';
const VOICE_RT_BASE = process.env.STEP_RT_BASE_URL || 'https://api.stepfun.com/v1';
const voiceRtWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 }); // 单帧上限 64KB（合法音频块约 3.2KB）
let voiceRtSessions = 0;
const voiceRtAllowedClientEvents = new Set([
  'input_audio_buffer.append',
  'input_audio_buffer.commit',
  'input_audio_buffer.clear',
  'response.create',
  'response.cancel',
]);

const VOICE_RT_IDLE_TIMEOUT_MS = parseInt(process.env.VOICE_RT_IDLE_TIMEOUT_MS || '90000', 10);
const VOICE_RT_MAX_PER_IP = parseInt(process.env.VOICE_RT_MAX_PER_IP || '1', 10);
const voiceRtPerIp = new Map(); // ip -> 当前会话数
const voiceRtConnLog = new Map(); // ip -> 最近连接时间戳数组（10 次/分钟限流）

function voiceRtReject(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function handleVoiceRealtimeUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/voice/realtime') {
    voiceRtReject(socket, '404 Not Found');
    return;
  }
  if (!STEP_API_KEY) {
    voiceRtReject(socket, '503 Service Unavailable');
    return;
  }
  const ip = getClientIp(req);
  // 每 IP 连接频率限流（10 次/分钟），防止单 IP 刷上游握手
  const now = Date.now();
  pruneHitsMap(voiceRtConnLog, 60_000);
  const conns = (voiceRtConnLog.get(ip) || []).filter((t) => now - t < 60_000);
  if (conns.length >= 10) {
    console.warn(`[step][voice-rt] rejected: rate limit ip=${ip}`);
    voiceRtReject(socket, '429 Too Many Requests');
    return;
  }
  conns.push(now);
  voiceRtConnLog.set(ip, conns);
  // 每 IP 并发上限
  if ((voiceRtPerIp.get(ip) || 0) >= VOICE_RT_MAX_PER_IP) {
    console.warn(`[step][voice-rt] rejected: per-ip concurrent ip=${ip}`);
    voiceRtReject(socket, '429 Too Many Requests');
    return;
  }
  if (voiceRtSessions >= VOICE_RT_MAX_SESSIONS) {
    console.warn('[step][voice-rt] rejected: too many sessions');
    voiceRtReject(socket, '429 Too Many Requests');
    return;
  }

  voiceRtWss.handleUpgrade(req, socket, head, (client) => {
    pruneCounterMap(voiceRtPerIp);
    voiceRtSessions += 1;
    voiceRtPerIp.set(ip, (voiceRtPerIp.get(ip) || 0) + 1);
    let upstream = null;
    let released = false;

    // 唯一释放出口（幂等）：上游 close / 客户端 close 任一先到都只释放一次
    const release = () => {
      if (released) return;
      released = true;
      voiceRtSessions = Math.max(0, voiceRtSessions - 1);
      voiceRtPerIp.set(ip, Math.max(0, (voiceRtPerIp.get(ip) || 0) - 1));
      clearTimeout(idleTimer);
      try { if (upstream) upstream.close(); } catch (_) {}
      try { client.close(); } catch (_) {}
    };

    // 空闲超时：90 秒无任何客户端消息则挂断（防匿名连接占满 3 个槽位）
    let idleTimer = setTimeout(() => {
      console.warn(`[step][voice-rt] idle timeout ip=${ip}`);
      release();
    }, VOICE_RT_IDLE_TIMEOUT_MS);

    upstream = new WebSocket(`${VOICE_RT_BASE}/realtime?model=${VOICE_RT_MODEL}`, {
      headers: { Authorization: `Bearer ${STEP_API_KEY}` },
      handshakeTimeout: 15000,
    });

    upstream.on('open', () => {
      // 服务端统一注入导购人设（真实商品库 + 音色 + 音频格式），客户端不可覆盖
      upstream.send(JSON.stringify({
        event_id: 'srv_session',
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: buildVoiceGuideInstructions(),
          voice: process.env.STEP_TTS_VOICE || 'elegantgentle-female',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
        },
      }));
    });

    // 上游 → 浏览器：全量转发（session/audio/transcript/error 事件），带背压保护
    upstream.on('message', (data) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (client.bufferedAmount > 2 * 1024 * 1024) { // 慢客户端防内存堆积
        console.warn(`[step][voice-rt] backpressure terminate ip=${ip}`);
        release();
        return;
      }
      client.send(data.toString());
    });
    upstream.on('error', (e) => {
      // 原文只进日志；给客户端固定文案，避免泄漏内部地址/TLS 细节
      console.warn('[step][voice-rt] upstream error:', e.message);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', error: { message: '语音服务连接中断，请重试' } }));
      }
      release();
    });
    upstream.on('close', () => release());

    // 浏览器 → 上游：白名单事件（音频推流 / commit / 取消），其余丢弃
    client.on('message', (data) => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => release(), VOICE_RT_IDLE_TIMEOUT_MS);
      try {
        const ev = JSON.parse(data.toString());
        if (process.env.VOICE_RT_DEBUG === '1') console.log(`[step][voice-rt-debug] client ev=${ev.type} upstreamReady=${upstream && upstream.readyState}`);
        if (!voiceRtAllowedClientEvents.has(ev.type)) return;
        if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
      } catch (_) { /* 非 JSON 消息忽略 */ }
    });
    client.on('error', () => {});
    client.on('close', () => release());
  });
}


// 404 fallback for API
app.use('/api', (req, res) => {
  fail(res, 404, 'API 不存在');
});

// ---------- 进程级兜底：单个 rejection 不许搞垮整家店的服务 ----------
// Node 22 默认对 unhandled rejection 直接退出进程。Express 4 又不接 async handler
// 抛出的错（没有 wrapAsync），所以任何一个漏了 catch 的 async 都会变成 rejection。
// 实测踩过：常量名写错（TRYON_ANON_LIMIT vs ANON_TRYON_LIMIT）让「匿名试摆打满限额」
// 这条常规路径直接把进程搞崩，之后所有请求 ERR_CONNECTION_REFUSED，直到 systemd 重启。
// 一家县城的店不能因为一个坏请求就整站 500。这里接住它、留堆栈，让该请求自己失败，
// 其余请求照常服务。（真要继续退出， policing 交给 systemd 的 Restart=。）
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack}` : String(reason);
  console.error(`[fatal-guard] unhandled rejection（已接住，进程继续服务）\n${msg}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[fatal-guard] uncaught exception（已接住，进程继续服务）\n${err.stack || err}`);
});

if (process.env.NODE_ENV !== 'test') {
  // 启动时把 bucket 设为 public read（失败不阻塞，仅警告 → 走本地 fallback）
  ensureBucketPublic().catch(() => {});
  const httpServer = http.createServer(app);
  httpServer.on('upgrade', handleVoiceRealtimeUpgrade);
  httpServer.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.info(`银杏家具 MVP 已启动: http://127.0.0.1:${PORT} · 电话 13359140982`);
    console.info(`  MinIO: ${MINIO_PUBLIC_URL}  bucket: ${BUCKET}`);
    console.info(`  语音实时导购: /api/voice/realtime (${VOICE_RT_MODEL}, 并发上限 ${VOICE_RT_MAX_SESSIONS})`);
    if (!TWO_FISH_API_KEY) {
      console.warn('⚠️  TWO_FISH_API_KEY 未设置：/api/tryon/ai 会进入兜底分支');
    }
  });
}

export default app;
