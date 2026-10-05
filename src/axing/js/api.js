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
  // 多数端点走 ok() 包 { success, data }；少数公开端点（如 /api/tryon/presets）
  // 直接返回业务对象，没有 data 层，这里回退成 body 本身
  return body.data !== undefined ? body.data : body;
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

// ---------------------------------------------------------------- SSE 流式问答
// fetch 没有 EventSource 的自动解析，必须自己读 reader 切帧。
// 后端 /api/chat/guide/stream 的帧格式固定为 `data: {json}\n\n`，
// 事件类型：status / thinking / tool / delta / done / error。

/** 从 SSE 缓冲里切出完整帧。返回 [帧数组, 剩余不完整缓冲]。 */
function splitSseFrames(buffer) {
  const frames = [];
  let rest = buffer;
  for (;;) {
    const idx = rest.indexOf('\n\n');
    if (idx === -1) break;
    frames.push(rest.slice(0, idx));
    rest = rest.slice(idx + 2);
  }
  // 兼容 \r\n\r\n 分隔（后端不产，代理层可能改）
  if (frames.length === 0) {
    const idx = rest.indexOf('\r\n\r\n');
    if (idx !== -1) {
      frames.push(rest.slice(0, idx));
      rest = rest.slice(idx + 4);
    }
  }
  return [frames, rest];
}

/** 一帧 SSE → 事件对象（剥 data: 前缀后 JSON.parse）；非 data 帧返回 null */
function parseSseFrame(frame) {
  let payload = null;
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('data:')) payload = line.slice(5).trim();
  }
  if (!payload) return null;
  try { return JSON.parse(payload); } catch { return null; }
}

/**
 * SSE 流式导购问答（Agents SDK Runner stream + toTextStream）。
 * @param {{ message: string, history?: Array<{role:string,content:string}> }} input
 * @param {{
 *   onStatus?: (info: object) => void,
 *   onThinking?: (text: string) => void,
 *   onTool?: (name: string) => void,
 *   onDelta?: (text: string) => void,
 *   onDone?: (reply: string) => void,
 *   onError?: (message: string) => void,
 * }} handlers
 * @returns {{ abort(): void }}
 */
function chatGuideStream(input, handlers = {}) {
  const ac = new AbortController();
  const decoder = new TextDecoder();

  const run = async () => {
    let res;
    try {
      res = await fetch('/api/chat/guide/stream', {
        ...json(input),
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;                    // 主动 abort：不算错误
      (handlers.onError || (() => {}))('网络不给力，检查一下网络再试');
      return;
    }

    // 429/503/参数错：后端用 JSON 报错而不是开 SSE
    if (!res.ok || !res.body) {
      let msg = `服务暂时不可用（${res.status}）`;
      try {
        const body = await res.json();
        if (body && body.error) msg = body.error;
      } catch { /* 非 JSON，用默认话术 */ }
      (handlers.onError || (() => {}))(msg);
      return;
    }

    const reader = res.body.getReader();
    let buffer = '';
    let gotDone = false;                       // 上游是否给过 done，避免尾部兜底覆盖真回复
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const [frames, rest] = splitSseFrames(buffer);
        buffer = rest;
        for (const frame of frames) {
          const ev = parseSseFrame(frame);
          if (!ev) continue;
          switch (ev.type) {
            case 'status':
              handlers.onStatus && handlers.onStatus(ev);
              break;
            case 'thinking':
              handlers.onThinking && handlers.onThinking(ev.text);
              break;
            case 'tool':
              // 第二个参数是工具返回的商品数组（含 image）。老后端只发 name，
              // products 为 undefined，调用方按「没有图」处理即可。
              handlers.onTool && handlers.onTool(ev.name, ev.products);
              break;
            case 'delta':
              handlers.onDelta && handlers.onDelta(ev.text);
              break;
            case 'done':
              gotDone = true;
              handlers.onDone && handlers.onDone(ev.reply);
              break;
            case 'error':
              handlers.onError && handlers.onError(ev.error);
              break;
            default:
              break;
          }
        }
      }
      // 流正常结束但上游没给 done（连接被截断）：补一次空串兜底，
      // 让调用方能收尾，不要把用户晾在「正在想」里
      if (!gotDone) (handlers.onDone || (() => {}))('');
    } catch (err) {
      if (!ac.signal.aborted) {
        (handlers.onError || (() => {}))('对话连接断了，再说一次好不好？');
      }
    }
  };

  run();

  return {
    abort() {
      ac.abort();
    },
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
  // 阿杏文字对话（SSE 流式，Agents SDK Runner stream）。chat-core.js 默认走这条。
  // handlers = {onStatus,onThinking,onTool,onDelta,onDone,onError}，返回 { abort }
  chatGuideStream: (message, history = [], handlers = {}) =>
    chatGuideStream({ message, history }, handlers),
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
