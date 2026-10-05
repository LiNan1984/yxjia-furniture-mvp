// chat-composer.js — 阿杏「聊天永远在」输入栏（v2.1 spec §2.1 / §70 / §71）。
// 只管底部 Composer 交互：文字问答（POST /api/chat/guide）、声波跳语音页、选照片跳上传页、更多功能占位。
// 聊天气泡的渲染归 view-home.js（它听 ctx.on('chat:message') / 'chat:thinking'），这里只 emit / appendChat，不碰首页 DOM。
// DOM 与样式已由 index.html + axing.css 提供；本文件不改 css、不引三方依赖、不 import three。

const TIMEOUT_MS = 20000;                                    // 单次问答超时（spec §11.3 常规 <5s，20s 是宽容上限）
const HISTORY_TURNS = 6;                                     // 随身携带的上下文轮数，支撑「换一个」这类指代（后端上限 20）
const MAX_IMG_BYTES = 10 * 1024 * 1024;                      // 照片上限 10MB，与 upload 端限制对齐
const FALLBACK_TEXT = '阿杏刚刚走神了，没听清。你再说一遍好不好？';

export function initComposer(ctx) {
  const input = document.getElementById('composerInput');
  const sendBtn = document.getElementById('composerSend');
  const imgBtn = document.getElementById('composerImage');
  const voiceBtn = document.getElementById('composerVoice');
  const plusBtn = document.getElementById('composerPlus');
  const phone = document.getElementById('phone');
  if (!input || !sendBtn || !imgBtn) return;                 // 壳未就绪时不装，避免整页脚本挂掉

  const DEFAULT_PLACEHOLDER = input.placeholder || '发消息或按住说话…';
  const history = [];                                        // {role, content}，cleanup 时清空
  const cleanups = [];
  const on = (node, evt, fn, opts) => {
    node.addEventListener(evt, fn, opts);
    cleanups.push(() => node.removeEventListener(evt, fn, opts));
  };

  let busy = false;          // 请求进行中：禁连发，防止两条消息把上下文打乱
  let timer = null;          // 超时计时器
  let ac = null;             // 超时竞速用的 AbortController
  let fileInput = null;      // 临时 <input type=file>（不复用，否则连选同一张图不触发 change）
  let disposed = false;      // cleanup 之后丢弃迟到的响应

  // 有字 → 显示发送、收起图片按钮；清空 → 反过来
  // 注意：.ax-composer__btn{display:flex}（类选择器）会盖掉 UA 的 [hidden]{display:none}，
  // 而 css 只给 .ax-composer__send[hidden] 补了规则 —— 这里统一补内联 display，保证两个按钮都真隐藏。
  const setHidden = (node, hidden) => {
    node.hidden = hidden;
    node.style.display = hidden ? 'none' : '';
  };
  const syncSendVisibility = () => {
    const hasText = !!input.value.trim();
    setHidden(sendBtn, !hasText);
    setHidden(imgBtn, hasText);
  };

  const setBusy = (v) => {
    busy = v;
    sendBtn.disabled = v;
    input.readOnly = v;
    input.placeholder = v ? '阿杏正在想…' : DEFAULT_PLACEHOLDER;
  };

  const remember = (role, content) => {
    history.push({ role, content: String(content).slice(0, 2000) });
    while (history.length > HISTORY_TURNS) history.shift();
  };

  // 发送一条文字问答：用户消息立即上屏 → 请求 → 成功上阿杏回复 / 失败 toast + 兜底话术
  async function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    syncSendVisibility();
    input.focus();                                            // 保持焦点，方便老人连着问
    ctx.appendChat('user', text);
    ctx.emit('chat:thinking');
    const payload = history.slice();                          // 只带本轮之前的上下文
    remember('user', text);
    setBusy(true);
    ac = new AbortController();
    timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    // api.js 的 fetch 不接 signal，这里用 AbortController 做 UI 层竞速超时（底层请求自行结束，不影响结果）
    const guard = new Promise((_, reject) => {
      ac.signal.addEventListener('abort', () => reject(new Error('等太久了，网络有点慢')));
    });
    try {
      const data = await Promise.race([ctx.api.chatGuide(text, payload), guard]);
      const reply = typeof data === 'string' ? data : (data && data.reply) || '';
      if (!reply) throw new Error('阿杏没说出话来，再试一次');
      remember('ai', reply);
      if (!disposed) ctx.appendChat('ai', reply);
    } catch (err) {
      if (!disposed) {
        ctx.toast(ctx.humanError(err));                       // 超时/断网/限流都翻成人话
        ctx.appendChat('ai', FALLBACK_TEXT);                  // 时间线不能出现问了没答的空洞
      }
    } finally {
      clearTimeout(timer);
      timer = null;
      ac = null;
      if (!disposed) {
        setBusy(false);
        ctx.emit('chat:done');
        input.focus();
      }
    }
  }

  // ---------- 输入框 ----------
  on(input, 'input', syncSendVisibility);
  on(input, 'keydown', (e) => {
    // 回车即发送；isComposing 保证输入法组字过程中的回车不触发
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); }
  });

  // ---------- 发送 ----------
  on(sendBtn, 'click', send);

  // ---------- 声波：MVP 降级为跳转全屏语音页 ----------
  // spec §11「语音不离开 Chat」是远期目标（要在 Chat 内嵌话筒 + 实时识别），
  // MVP 语音导购有独立全屏 view-voice，这里先跳过去，文案交互以后再并回 Composer。
  on(voiceBtn, 'click', () => ctx.go('view-voice'));

  // ---------- 图片：选一张客厅照，带去上传页 ----------
  on(imgBtn, 'click', () => {
    if (fileInput) fileInput.remove();
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'image/*';
    fi.hidden = true;
    fi.addEventListener('change', () => {
      const file = fi.files && fi.files[0];
      if (file) {
        if (!file.type.startsWith('image/')) ctx.toast('只能选照片哦');
        else if (file.size > MAX_IMG_BYTES) ctx.toast('照片太大了，换一张小一点的');
        else {
          ctx.setState({ pendingRoomFile: file.name });
          ctx.go('view-upload');
        }
      }
      fi.remove();                                            // 用完即焚，保证下次能重复选同一张
      fileInput = null;
    });
    document.body.appendChild(fi);
    fileInput = fi;
    fi.click();
  });

  // ---------- ＋：更多功能占位 ----------
  on(plusBtn, 'click', () => ctx.toast('更多功能还在来的路上～'));

  // ---------- Composer 隐藏时收起软键盘 ----------
  // data-composer 由 app.js 按 view 切换；非 tab 页面（上传/语音/3D…）输入框失焦，避免键盘顶着表单
  if (phone && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => {
      if (phone.dataset.composer !== 'on' && document.activeElement === input) input.blur();
    });
    mo.observe(phone, { attributes: true, attributeFilter: ['data-composer'] });
    cleanups.push(() => mo.disconnect());
  }

  syncSendVisibility();

  return function cleanup() {
    disposed = true;
    if (timer) clearTimeout(timer);
    if (ac) ac.abort();
    if (fileInput) fileInput.remove();
    history.length = 0;
    cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略单个解绑异常 */ } });
  };
}
