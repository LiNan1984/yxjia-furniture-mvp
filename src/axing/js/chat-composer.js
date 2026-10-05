// chat-composer.js — 阿杏底部输入栏（交互规范 §2-2 / §1-1）。
//
// 分工：本文件只管「用户怎么把意图递出来」——打字、回车、点发送、点相册、点声波、点更多。
// 「发出去之后发生什么」（上屏 / 流式 / 停止生成 / 兜底话术）全部在 chat-core.js，
// 这样任何 view 都能通过 ctx.chat.send() 复用同一条链路，不会各写一套导致
// 「点了 chip 只有用户气泡、没有 AI 回复」这种半截对话（P3）。
//
// DOM 与样式由 index.html + axing.css/chat.css 提供；本文件不引三方依赖、不 import three。
// 照片大小/类型的校验归 sheet-upload.js（浮窗自己那套 15MB），这里不再重复一道——
// 同一条链路两处上限不一致，顾客只会看到「同一张照片有时能传有时不能」。

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

  // ---------- 图片：直接开上传浮窗，不自己弹系统相册 ----------
  // 交互规范 §1-2：上传客厅照的三个入口（首页上传卡 / Composer 相册键 / AI 回复的「拍照试摆」）
  // 统一进同一个浮窗，由浮窗提供「拍一张 / 从相册选择 / 示例房间」。
  // 曾经这里自己弹系统相册，有两个后果：① 顾客取消选择就是一次完全没反馈的空点
  // （老人会以为手机坏了）；② 看不到示例房间——没照片的顾客被直接堵死。
  if (imgBtn) on(imgBtn, 'click', () => ctx.openUpload());

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
    cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略单个解绑异常 */ } });
  };
}
