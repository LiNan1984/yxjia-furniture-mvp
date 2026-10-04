// 阿杏前端 API 封装：统一 {success,data} / {success,error} 解析，失败抛 ApiError
// 所有路径都是现有后端（server.js）已实现的接口，无新增依赖。

export class ApiError extends Error {
  constructor(message, status) {
    super(message || '网络开小差了，请再试一次');
    this.name = 'ApiError';
    this.status = status || 0;
  }
}

async function parse(res) {
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || !body || body.success === false) {
    throw new ApiError(body && body.error, res.status);
  }
  return body.data;
}

async function req(path, options = {}) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError('网络不给力，检查一下网络再试', 0);
  }
  return parse(res);
}

function json(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  };
}

export const api = {
  // 商品
  products: () => req('/api/products'),
  product: (id) => req(`/api/products/${encodeURIComponent(id)}`),
  // 试摆预设 prompt（自然/暖光/…）
  presets: () => req('/api/tryon/presets'),
  // 阿杏文字对话（Markdown 回复）
  chatGuide: (message, history = []) =>
    req('/api/chat/guide', json({ message, history })),
  // 阿杏语音：传 WAV/MP3 Blob，回 { userText, reply, audioBase64, audioMime }
  voiceAsk: (audioBlob) => {
    const fd = new FormData();
    fd.append('audio', audioBlob, 'voice.wav');
    return req('/api/voice/ask', { method: 'POST', body: fd });
  },
  voiceStatus: () => req('/api/voice/status'),
  // 客厅照上传（multipart file）→ { url, filename }
  uploadRoom: (file, extra = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    if (extra.phone) fd.append('phone', extra.phone);
    if (extra.productId) fd.append('productId', extra.productId);
    return req('/api/upload/room', { method: 'POST', body: fd });
  },
  // 匿名 AI 试摆（每 IP 每天 3 次）→ { product, compositionUrl, compositionBase64, aiError, demoType, preset, remaining }
  tryonAnon: ({ room, productId, prompt = '', preset = '' }) => {
    const fd = new FormData();
    fd.append('room', room);
    fd.append('productId', productId);
    if (prompt) fd.append('prompt', prompt);
    if (preset) fd.append('preset', preset);
    return req('/api/tryon/ai-anon', { method: 'POST', body: fd });
  },
  // 下单（也用于「预约到店体验」）
  createOrder: (payload) => req('/api/orders', json(payload)),
  // 到店预约（阿杏新增接口）
  createAppointment: (payload) => req('/api/appointments', json(payload)),
  appointmentsByPhone: (phone) =>
    req(`/api/appointments/by-phone/${encodeURIComponent(phone)}`),
  // 保存方案（阿杏新增接口）
  saveScene: (payload) => req('/api/scenes', json(payload)),
  scenesByPhone: (phone) =>
    req(`/api/scenes/by-phone/${encodeURIComponent(phone)}`),
  // 全屋搭配风格
  wholeHomeStyles: () => req('/api/whole-home/styles'),
  // 品类（含示例房间图，供「拍照上传」里的示例房间）
  categories: () => req('/api/categories'),
  // 顾客登录/当前用户（试摆登录引导用）
  login: (phone, code) =>
    req('/api/auth/login', json({ phone, code })),
  me: () => req('/api/auth/me'),
};
