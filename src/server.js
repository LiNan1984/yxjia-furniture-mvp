import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Client as Minio } from 'minio';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const UPLOADS_FILE = path.join(DATA_DIR, 'uploads.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const FEATURE_FLAGS_FILE = path.join(DATA_DIR, 'feature-flags.json');
const WHOLE_HOME_STYLES_FILE = path.join(DATA_DIR, 'whole-home-styles.json');
const PUBLIC_DIR = __dirname;
const IMAGES_DIR = path.join(ROOT, 'public', 'images');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

// 上传子目录（按类型归档，文件路径遵循 uploads/{type}/{uuid}.{ext}）
const UPLOAD_DIRS = {
  products: path.join(UPLOADS_DIR, 'products'),
  rooms: path.join(UPLOADS_DIR, 'rooms'),
  compositions: path.join(UPLOADS_DIR, 'compositions'),
};

// TwoFish / gpt-image-2 端点（必须从环境变量读，不能在源码里硬编码）
// 启动时自动加载 .env（用 dotenv，但避免强依赖——失败时退回环境变量）
try { await import('dotenv').then(m=>m.config()).catch(()=>{}); } catch(_) {}
const TWO_FISH_API_KEY = process.env.TWO_FISH_API_KEY;
if (!TWO_FISH_API_KEY) console.warn('[warn] TWO_FISH_API_KEY 未设置：/api/tryon/ai-* 会进入兜底分支');
const TWO_FISH_EDITS_URL = 'https://twofishai.com/v1/images/edits';

// 后台账号（生产环境必须从环境变量覆盖）
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '123456';

// 验证码 MVP：固定 123456（生产请接真短信）
const FIXED_VERIFY_CODE = '123456';

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
        { id: 'sunlight', name: '暖光氛围', prompt: '强调午后暖阳光从窗户洒进客厅的效果，沙发表面有金色光斑' },
        { id: 'night', name: '夜晚温馨', prompt: '夜晚场景，客厅开暖色台灯，沙发在柔和灯光下显得温馨' },
        { id: 'minimal', name: '极简留白', prompt: '客厅保持极简风，沙发居中，周围大量留白' },
        { id: 'family', name: '家庭生活', prompt: '客厅有家庭生活感，茶几上有茶杯和书本，沙发有使用痕迹' },
      ],
    };
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(defaults, null, 2), 'utf-8');
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

function saveUpload(file, type) {
  // 文件路径遵循 uploads/{type}/{uuid}.{ext}
  const dir = UPLOAD_DIRS[type];
  if (!dir) throw new Error(`unsupported upload type: ${type}`);
  const ext = (path.extname(file.filename || '') || mimeToExt(file.contentType) || '.bin').toLowerCase();
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
    const productUrl = new URL(product.image, 'http://127.0.0.1:3000');
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

// callTryonAI 返回结构化结果：{ buffer, demoType }
// demoType:
//   'ai-composition'      TWO_FISH 真合成成功
//   'pollinations'        Pollinations.ai 真实图生图（公共免 key 兜底）
//   'cached-composition'  命中 uploads.json 里该 productId 的历史合成图
//   'side-by-side'        side-by-side 客厅+商品 预览
//   'product-image'       仅商品图
async function callTryonAI({ productId, roomBuffer, sofaBuffer, productImagePath, prompt }) {
  // 1) TWO_FISH / gpt-image-2（主路径，账号池已恢复）
  if (TWO_FISH_API_KEY) {
    try {
      const form = new FormData();
      form.append('model', 'gpt-image-2');
      form.append('prompt', prompt || buildTryonPrompt(productId));
      form.append('size', '1024x1024');
      form.append('image[]', new Blob([roomBuffer], { type: 'image/jpeg' }), 'room.jpg');
      form.append('image[]', new Blob([sofaBuffer], { type: 'image/jpeg' }), 'sofa.jpg');

      const resp = await fetch(TWO_FISH_EDITS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TWO_FISH_API_KEY}` },
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
      if (buf && buf.length > 0) return { buffer: buf, demoType: 'ai-composition' };
      throw new Error('TwoFish response unrecognized shape');
    } catch (err) {
      console.warn(`[ai] twofishai failed: ${err.message}`);
    }
  }
  // 2) Pollinations 兜底（两鱼再次 503 时启用）
  if (roomBuffer) {
    try {
      const buf = await callPollinations({ productId, roomBuffer, prompt });
      if (buf) return { buffer: buf, demoType: 'ai-composition' };
    } catch (e) {
      console.warn('[ai] gpt-image-2 via Pollinations failed: ' + e.message);
    }
  }

  // 3) 该 productId 的历史合成图
  const cached = pickCachedCompositionForProduct(productId);
  if (cached) return { buffer: cached.buffer, demoType: 'cached-composition' };

  // 4) side-by-side 预览
  const productImg = await fetchProductImage(productId);
  if (productImg && roomBuffer) {
    try {
      const sideBySide = await composeRoomAndProduct(roomBuffer, productImg);
      return { buffer: sideBySide, demoType: 'side-by-side' };
    } catch (e) {
      console.warn('[fallback] composeRoomAndProduct failed: ' + e.message);
    }
  }
  // 5) 仅商品图
  if (productImg) return { buffer: productImg, demoType: 'product-image' };
  throw new Error('AI upstream failed and no fallback image available');
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
app.get('/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));
app.get('/my-orders', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'my-orders.html')));

// Admin 页面：/admin 直接进登录页（避免被 express.static 当成目录展示 index.html）
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'login.html')));
app.get('/admin/index', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html')));
app.get('/admin/product', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'product.html')));
app.get('/admin/room', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'room.html')));
app.get('/admin/tryon', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'tryon.html')));
app.get('/admin/orders', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'orders.html')));
app.get('/admin/products', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'products.html')));
app.get('/admin/rooms', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'rooms.html')));
app.get('/admin/presets', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'presets.html')));
app.get('/admin/tryon-results', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'tryon-results.html')));
app.get('/admin/feature-flags', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin', 'feature-flags.html')));

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
      // /uploads/{type}/{file} → MinIO object key = {bucket}/{type}/{file}
      const relative = decodeURIComponent(req.path.replace(/^\/+/, ''));
      const objectName = `${BUCKET}/${relative}`;
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
app.post('/v1/images/generations', async (req, res) => {
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
            'Authorization': `Bearer ${TWO_FISH_API_KEY}`,
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

app.get('/api/products', (req, res) => {
  try {
    const store = loadStore();
    const all = getProducts();
    const showAll = req.query.all === '1';
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

// POST /api/admin/products/:id/toggle — 上下架切换
app.post('/api/admin/products/:id/toggle', requireAdmin, (req, res) => {
  try {
    const products = getProducts();
    const p = products.find(p => p.id === req.params.id);
    if (!p) return fail(res, 404, '商品不存在');
    p.status = p.status === '下架' ? '在售' : '下架';
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
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
    const product = findProduct(req.params.id);
    if (!product) return fail(res, 404, '商品不存在');

    // 删旧图（如果是本地路径）
    if (product.image && product.image.startsWith('/uploads/products/')) {
      const oldName = product.image.replace('/uploads/products/', '');
      try { fs.unlinkSync(path.join(UPLOAD_DIRS.products, oldName)); } catch (_) { /* 忽略 */ }
    }

    // 存新图到 MinIO
    const ext = path.extname(req.file.originalname) || '.jpg';
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

app.get('/api/orders', (req, res) => {
  try {
    const container = loadOrdersContainer();
    return ok(res, container);
  } catch (err) {
    return fail(res, 500, '读取订单失败');
  }
});

// GET /api/orders/:phone
app.get('/api/orders/:phone', (req, res) => {
  try {
    const container = loadOrdersContainer();
    const filter = req.params.phone;
    let filtered;
    if (filter.startsWith('O')) {
      filtered = container.orders.filter(o => o.id === filter);
    } else {
      filtered = container.orders.filter(o => o.phone === filter);
    }
    return ok(res, { orders: filtered });
  } catch (err) {
    return fail(res, 500, '读取订单失败');
  }
});

// GET /api/orders/by-phone/:phone
app.get('/api/orders/by-phone/:phone', (req, res) => {
  try {
    const container = loadOrdersContainer();
    const filtered = container.orders.filter(o => o.phone === req.params.phone);
    return ok(res, { orders: filtered });
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
    return ok(res, { ok: true, order });
  } catch (err) {
    return fail(res, 500, '保存订单失败');
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
app.get('/api/tryon/history', (req, res) => {
  try {
    const phone = (req.query.phone || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 100);
    if (!isValidPhone(phone)) return fail(res, 400, '手机号格式不对');
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
app.post('/api/upload/product-image', async (req, res) => {
  try {
    const parts = await parseMultipart(req).catch(() => null);
    if (!parts) return fail(res, 400, '请用 multipart/form-data 上传');

    const file = getMultipartFile(parts, 'file');
    if (!file || !file.data || file.data.length === 0) {
      return fail(res, 400, '请选择要上传的文件');
    }

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
// 单图上传 → doubao 视觉模型自动命名+分类+价格 → 写入 products.json
// 字段：file, hint?（可选名称提示）
// ARK_API_KEY 必须从环境变量读（生产部署有 .env）
const ARK_API_KEY = process.env.ARK_API_KEY;
const ARK_VISION_URL = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
const ARK_VISION_MODEL = 'doubao-seed-2-1-pro-260628';

async function identifyWithDoubao(imageBuffer, hint = '') {
  const b64 = imageBuffer.toString('base64');
  const hintPart = hint ? `提示："${hint}"。` : '';
  const body = {
    model: ARK_VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        { type: 'text', text: `看这张家具图。${hintPart}返回严格 JSON（无 markdown）：{"name":"5-15字中文短名","price":"¥Xxxx起","category":"sofa/cabinet/bed/table/other","subtitle":"5-10字材质简述","color":"#XXXXXX 主色hex","emoji":"🛋️/📺/🛏️/🍽️/📦"}。只回 JSON。` }
      ]
    }]
  };
  const resp = await fetch(ARK_VISION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ARK_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`doubao API ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  // 尝试提取 JSON（可能被 markdown 包了）
  const match = content.match(/\{[\s\S]*\}/);
  const json = match ? JSON.parse(match[0]) : null;
  if (!json || !json.name) throw new Error(`doubao 解析失败: ${content.slice(0, 200)}`);
  return {
    name: String(json.name).slice(0, 30),
    price: String(json.price || '¥Xxxx 起').slice(0, 20),
    category: ['sofa', 'cabinet', 'bed', 'table', 'other'].includes(json.category) ? json.category : 'other',
    subtitle: String(json.subtitle || '').slice(0, 30),
    color: /^#[0-9a-f]{6}$/i.test(json.color) ? json.color : '#3a2818',
    emoji: String(json.emoji || '🛋️').slice(0, 4)
  };
}

app.post('/api/admin/upload-and-identify', multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, '请选择要上传的图片');
    const hint = (req.body && req.body.hint) || '';

    // 1) 保存到 MinIO（fallback 本地）
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `${crypto.randomBytes(8).toString('hex')}${ext}`;
    const { url: imageUrl } = await saveImage(req.file.buffer, 'products', filename, req.file.mimetype || 'image/jpeg');

    // 2) 调 doubao 视觉模型识别
    let info;
    try {
      info = await identifyWithDoubao(req.file.buffer, hint);
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
      price: info.price,
      size: '常规尺寸',
      stock: '现货',
      badge: '主推',
      emoji: info.emoji,
      color: info.color,
      description: `AI 识别：${info.name}。${info.subtitle || ''}`,
      highlights: [info.subtitle || info.category, `AI 识别于 ${new Date().toLocaleString('zh-CN')}`],
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
  const arr = (anonTryonHits.get(ip) || []).filter(t => t >= cutoff);
  anonTryonHits.set(ip, arr);
  if (arr.length >= ANON_TRYON_LIMIT) return false;
  arr.push(now);
  return true;
}

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress
    || 'unknown';
}

// POST /api/tryon/ai-anon — 匿名试摆（multipart: room(file), productId, prompt?）
// 每 IP 24 小时最多 3 次；超出后引导登录
app.post('/api/tryon/ai-anon', multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).fields([
  { name: 'room', maxCount: 1 },
  { name: 'productId', maxCount: 1 },
  { name: 'prompt', maxCount: 1 },
]), async (req, res) => {
  const ip = getClientIp(req);
  if (!checkAnonTryonLimit(ip)) {
    return fail(res, 429, '免费体验已用完，请登录后再试摆');
  }
  try {
    const roomFile = req.files?.room?.[0];
    const productId = req.body?.productId;
    const customPrompt = (req.body?.prompt || '').trim();
    if (!roomFile) return fail(res, 400, '请上传客厅照片');
    if (!productId) return fail(res, 400, '请选择要试摆的商品');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // 拉取商品参考图（优先当前 host 的相对 URL；失败兜底到 /images/sofa-zhongshi.jpg）
    let sofaBuffer = null;
    let productFetchError = null;
    if (product.image) {
      try {
        const productUrl = new URL(product.image, 'http://127.0.0.1:3000');
        const r = await fetch(productUrl);
        if (r.ok) sofaBuffer = Buffer.from(await r.arrayBuffer());
        else productFetchError = `${productUrl} → HTTP ${r.status}`;
      } catch (e) { productFetchError = e.message; }
    }
    if (!sofaBuffer) {
      // 兜底：用内置的沙发图
      const fallback = await fetch('http://127.0.0.1:3000/images/sofa-zhongshi.jpg');
      if (!fallback.ok) return fail(res, 502, `拉取商品图失败（${productFetchError}）且无内置兜底图`);
      sofaBuffer = Buffer.from(await fallback.arrayBuffer());
    }

    const defaultPrompt = `把第二张图里的「${product.name}」自然摆放到第一张图的客厅场景，保持客厅光线、墙面、地板、家具风格不变。沙发按透视与光影融入，整体看起来像实拍照片，高清、温馨。`;
    const finalPrompt = customPrompt ? `${defaultPrompt} 用户额外要求：${customPrompt}` : defaultPrompt;

    let aiBuffer = null, demoType = null, aiError = null;
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.buffer,
        sofaBuffer,
        productImagePath: product.image,
        prompt: finalPrompt,
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
    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64,${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      anonymous: true,
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
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.data,
        sofaBuffer: sofaFile.data,
        productImagePath: product.image,
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
// 字段：room(file), sofa(file), productId, prompt(用户自定义)
app.post('/api/tryon/ai-custom', requireUser, multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }).fields([
  { name: 'room', maxCount: 1 },
  { name: 'sofa', maxCount: 1 },
  { name: 'productId', maxCount: 1 },
  { name: 'prompt', maxCount: 1 },
]), async (req, res) => {
  try {
    const roomFile = req.files?.room?.[0];
    const sofaFile = req.files?.sofa?.[0];
    const productId = req.body?.productId;
    const customPrompt = (req.body?.prompt || '').trim();
    if (!roomFile || !sofaFile) return fail(res, 400, '请同时上传顾客客厅照和沙发图');
    if (!productId) return fail(res, 400, '请选择要试摆的商品');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // 默认 + 用户 prompt
    const defaultPrompt = `把第二张图里的「${product.name}」自然摆放到第一张图的客厅场景，保持客厅光线、墙面、地板、家具风格不变。沙发按透视与光影融入，整体看起来像实拍照片，高清、温馨。`;
    const finalPrompt = customPrompt ? `${defaultPrompt} 用户额外要求：${customPrompt}` : defaultPrompt;

    let aiBuffer = null, demoType = null, aiError = null;
    try {
      const r = await callTryonAI({
        productId,
        roomBuffer: roomFile.buffer,
        sofaBuffer: sofaFile.buffer,
        productImagePath: product.image,
        prompt: finalPrompt,
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
    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64,${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
      customPrompt,
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
//   - analyzeId：来自 /api/upload/room 返回的上传记录 id（在 data/uploads.json 里）
//   - styleId：上面 GET 接口返回的某个 style.id
//   - budget：可选，客户预算区间（字符串，e.g. "10-12万"），原样回显
app.post('/api/whole-home/recommend', (req, res) => {
  try {
    const body = req.body || {};
    const { analyzeId, styleId } = body;
    const budget = typeof body.budget === 'string' ? body.budget.trim() : '';

    if (!analyzeId || typeof analyzeId !== 'string') return fail(res, 400, 'analyzeId 必填');
    if (!styleId || typeof styleId !== 'string') return fail(res, 400, 'styleId 必填');

    // 1) 读 analyze 记录（来自 /api/upload/room 写入的 data/uploads.json）
    const uploadsContainer = loadUploadsContainer();
    const analyzeRecord = uploadsContainer.uploads.find(u => u.id === analyzeId && u.type === 'room');
    if (!analyzeRecord) return fail(res, 404, '找不到该 analyze 记录（请先调 /api/upload/room 上传客厅照）');

    // 2) 读风格卡
    const style = findWholeHomeStyle(styleId);
    if (!style) return fail(res, 404, `找不到风格卡: ${styleId}`);

    // 3) 把 style.rooms 拆开，每个房间挂上对应的 skuBinding item
    //    skuBinding.role 里含"沙发"关键字的，归"客厅"；含"主卧"/"次卧"/"老人"/"儿童"等关键字的，按房间名匹配
    const styleRooms = Array.isArray(style.rooms) && style.rooms.length > 0
      ? style.rooms
      : ['客厅'];
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

    // 4) 组装 rooms 数组
    const rooms = styleRooms.map(roomType => ({
      roomType,
      items: itemsByRoom[roomType] || [],
    }));

    // 5) deliveryPlan — Phase 1 规则：含"沙发"的 SKU 先发（2 周），其余后发（4 周）
    const sofaItems = binding.filter(b => (b.role || '').includes('沙发'));
    const otherItems = binding.filter(b => !(b.role || '').includes('沙发'));
    const deliveryPlan = {
      batch1: {
        label: '沙发先发（先行到家）',
        eta: '下单后 14 天到货',
        items: sofaItems.map(b => ({ productId: b.productId, role: b.role })),
      },
      batch2: {
        label: '柜、床、桌后补（后续到位）',
        eta: '下单后 28-35 天到货',
        items: otherItems.map(b => ({ productId: b.productId, role: b.role })),
        note: 'Phase 1 暂只有沙发；柜/床/桌上线后会自动补齐此批次',
      },
    };

    // 6) 拼 plan 主体
    const plan = {
      analyzeId,
      analyze: {
        id: analyzeRecord.id,
        url: fixImageUrl(analyzeRecord.url),
        uploadedAt: analyzeRecord.createdAt,
        userPhone: analyzeRecord.userPhone || '',
      },
      style: {
        id: style.id,
        name: style.name,
        tagline: style.tagline,
        description: style.description,
        targetAudience: style.targetAudience || [],
        aiPromptHint: style.aiPromptHint,
      },
      budget: budget || '面议',
      rooms,
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

// POST /api/tryon/ai-history — 历史图场景：JSON 入参 {productId, roomUrl, phone?}
app.post('/api/tryon/ai-history', requireUser, async (req, res) => {
  try {
    const body = req.body || {};
    const { productId, roomUrl, phone } = body;
    if (!productId || !roomUrl) return fail(res, 400, 'productId 和 roomUrl 必填');
    const product = findProduct(productId);
    if (!product) return fail(res, 404, '商品不存在');

    // 拉取历史图
    const roomResp = await fetch(roomUrl);
    if (!roomResp.ok) return fail(res, 502, '拉取历史客厅图失败');
    const roomBuffer = Buffer.from(await roomResp.arrayBuffer());

    // 拉取商品图
    const productUrl = product.image
      ? new URL(product.image, 'http://127.0.0.1:3000')
      : new URL('/images/sofa-zhongshi.jpg', 'http://127.0.0.1:3000');
    const productResp = await fetch(productUrl);
    if (!productResp.ok) return fail(res, 502, '拉取商品图失败');
    const sofaBuffer = Buffer.from(await productResp.arrayBuffer());

    let aiBuffer = null, demoType = null, aiError = null;
    try {
      const r = await callTryonAI({
        productId, roomBuffer, sofaBuffer, productImagePath: product.image,
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

    return ok(res, {
      ok: true,
      product,
      compositionUrl,
      compositionBase64: aiBuffer ? `data:image/jpeg;base64;${aiBuffer.toString('base64')}` : null,
      aiError,
      demoType,
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
app.post('/api/admin/login', (req, res) => {
  try {
    const body = req.body || {};
    if (body.username === ADMIN_USER && body.password === ADMIN_PASSWORD) {
      const token = attachSession('admin');
      setSessionCookie(res, token);
      return ok(res, { ok: true, token });
    }
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
  if (!ARK_API_KEY) {
    throw new Error('ARK_API_KEY 未配置（请检查 .env）');
  }
  const b64 = imageBuffer.toString('base64');
  const prompt = buildWholeHomePrompt({ style, phone });
  const body = {
    model: ARK_VISION_MODEL,
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
  const resp = await fetch(ARK_VISION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ARK_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`豆包 API ${resp.status}：${text.slice(0, 180) || '(empty body)'}`);
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
      try {
        // 1) 原图持久化（MinIO → 本地 fallback）
        const ext = path.extname(f.originalname || '') || mimeToExt(f.mimetype) || '.jpg';
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

// 404 fallback for API
app.use('/api', (req, res) => {
  fail(res, 404, 'API 不存在');
});

if (process.env.NODE_ENV !== 'test') {
  // 启动时把 bucket 设为 public read（失败不阻塞，仅警告 → 走本地 fallback）
  ensureBucketPublic().catch(() => {});
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.info(`银杏家具 MVP 已启动: http://127.0.0.1:${PORT} · 电话 13359140982`);
    console.info(`  MinIO: ${MINIO_PUBLIC_URL}  bucket: ${BUCKET}`);
    if (!TWO_FISH_API_KEY) {
      console.warn('⚠️  TWO_FISH_API_KEY 未设置：/api/tryon/ai 会进入兜底分支');
    }
  });
}

export default app;
