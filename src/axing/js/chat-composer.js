// chat-composer.js — 阿杏底部输入栏（交互规范 §2-2 / §1-1）。
//
// 分工：本文件只管「用户怎么把意图递出来」——打字、回车、点发送、点相册、点声波、点更多。
// 「发出去之后发生什么」（上屏 / 流式 / 停止生成 / 兜底话术）全部在 chat-core.js，
// 这样任何 view 都能通过 ctx.chat.send() 复用同一条链路，不会各写一套导致
// 「点了 chip 只有用户气泡、没有 AI 回复」这种半截对话（P3）。
//
// DOM 与样式由 index.html + axing.css/chat.css 提供；本文件不引三方依赖、不 import three。

const MAX_IMG_BYTES = 10 * 1024 * 1024;   // 照片上限 10MB，与 upload 端限制对齐

export function initComposer(ctx) {
  const input = document.getElementById('composerInput');
  const sendBtn = document.getElementById('composerSend');
  const imgBtn = document.getElementById('composerImage');
  const voiceBtn = document.getElementById('composerVoice');
  const plusBtn = document.getElementById('composerPlus');
  if (!input || !sendBtn || !imgBtn) return;      // 壳未就绪时不装，避免整页脚本挂掉

  const DEFAULT_PLACEHOLDER = input.placeholder || '发消息或按住说话…';
  input.dataset.basePh = DEFAULT_PLACEHOLDER;
  const cleanups = [];
  const on = (node, evt, fn) => {
    node.addEventListener(evt, fn);
    cleanups.push(() => node.removeEventListener(evt, fn));
  };

  // 有字 → 显示发送、收起图片按钮；清空 → 反过来。
  // .ax-composer__btn{display:flex}（类选择器）会盖掉 UA 的 [hidden]{display:none}，
  // 所以这里必须显式写内联 display，两个按钮才能真正隐/显（踩过的坑）。
  const setHidden = (node, hidden) => {
    node.hidden = hidden;
    node.style.display = hidden ? 'none' : '';
  };
  const syncSendVisibility = () => {
    const hasText = !!input.value.trim();
    setHidden(sendBtn, !hasText);
    setHidden(imgBtn, hasText);
  };

  // ---------- 发送：统一走 chat-core ----------
  const submit = () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    syncSendVisibility();
    input.focus();                                // 保持焦点，方便老人连着问
    ctx.chat.send(text);
  };

  on(input, 'input', syncSendVisibility);
  on(input, 'keydown', (e) => {
    // 回车即发送；isComposing 保证输入法组字过程中的回车不触发
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); }
  });
  on(sendBtn, 'click', submit);

  // ---------- 声波：跳全屏语音页（语音本身就是另一种聊天模态） ----------
  // 交互规范 §1-1：MVP 语音导购有独立全屏 view-voice，
  // 「语音不离开 Chat」是远期目标。
  if (voiceBtn) on(voiceBtn, 'click', () => ctx.go('view-voice'));

  // ---------- 图片：选一张客厅照，带去上传浮窗（不再是独立全屏页） ----------
  let fileInput = null;
  if (imgBtn) on(imgBtn, 'click', () => {
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
          ctx.openUpload();
        }
      }
      fi.remove();                                // 用完即焚，保证下次能重复选同一张
      fileInput = null;
    });
    document.body.appendChild(fi);
    fileInput = fi;
    fi.click();
  });

  // ---------- ＋：更多功能占位 ----------
  if (plusBtn) on(plusBtn, 'click', () => ctx.toast('更多功能还在来的路上～'));

  // ---------- Composer 隐藏时收起软键盘 ----------
  // data-composer 由 app.js 按 view 切换；非 tab 页面（语音/3D…）输入框失焦，避免键盘顶着表单
  const phone = document.getElementById('phone');
  if (phone && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => {
      if (phone.dataset.composer !== 'on' && document.activeElement === input) input.blur();
    });
    mo.observe(phone, { attributes: true, attributeFilter: ['data-composer'] });
    cleanups.push(() => mo.disconnect());
  }

  syncSendVisibility();

  return function cleanup() {
    if (fileInput) fileInput.remove();
    cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略单个解绑异常 */ } });
  };
}
