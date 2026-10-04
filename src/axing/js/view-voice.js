// view-voice.js — 阿杏 · 语音对话 · 智能导购
// 约定：mount(root, ctx) 首次切到该 view 时调用一次，可返回 cleanup。
//
// 文字：input → api.chatGuide(message, history) → ui.mdToNodes 渲染 Markdown 回复
// 语音：按住 mic-btn → MediaRecorder 录音（webm/opus 优先，iOS 回落 mp4）→ api.voiceAsk(blob)
//       → userText 气泡 + reply 气泡 + 播放 audioBase64；拿不到麦克风就保留文字输入。

const QUICK_QUESTIONS = ['三千左右的布艺沙发', '有没有适合小客厅的', '帮我看看我家客厅'];

/** app.js 目前把 api.js 的命名空间（{ ApiError, api }）注入 ctx.api，
 *  这里兼容「包装器」和「命名空间」两种形状，壳改回去也不用动 view。 */
function resolveApi(ctx) {
  const a = (ctx && ctx.api) || {};
  const wrapped = a.api;
  if (wrapped && typeof wrapped === 'object' && typeof wrapped.products === 'function') return wrapped;
  return typeof a.products === 'function' ? a : wrapped || a;
}

function pickMime() {
  if (!window.MediaRecorder) return '';
  const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', ''];
  for (const m of cands) {
    if (!m || MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

function micIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 0 0-7 0v5A3.5 3.5 0 0 0 12 15zm6-3.5A6 6 0 0 1 7.2 12H5.2a7 7 0 0 0 6 6.9V21h1.6v-2.1a7 7 0 0 0 6-6.9z');
  svg.appendChild(path);
  return svg;
}

export async function mount(root, ctx) {
  const { el, mdToNodes } = ctx.ui;
  const api = resolveApi(ctx);

  /** @type {{role:'user'|'assistant',content:string}[]} */
  const history = [];
  let sending = false;
  let recording = false;
  /** @type {MediaRecorder|null} */
  let rec = null;
  let recChunks = [];
  let recStream = null;
  let recTimeout = null;

  // ---------- 阿杏人设条 ----------
  const statusEl = el('span.tiny.muted', { text: '语音状态读取中…' });
  statusEl.dataset.role = 'voice-status';
  root.appendChild(el('div.row', { style: 'align-items:flex-start;' }, [
    ctx.ui.avatar('lg'),
    el('div.grow', {}, [
      el('div', { text: '阿杏', style: 'font-size:17px;letter-spacing:.2em;' }),
      el('div.tiny.muted', { text: '正在为你服务' }),
    ]),
    statusEl,
  ]));
  root.appendChild(el('p.sec-desc', {
    text: '可以说话，也可以打字。告诉我预算和房间，我帮你找店里合适的家具。',
    style: 'margin-top:14px;',
  }));

  // ---------- 聊天气泡 ----------
  const chatBox = el('div.chat', { style: 'min-height:180px;margin-top:6px;' });
  root.appendChild(chatBox);

  const scroll = () => { chatBox.scrollTop = chatBox.scrollHeight; };

  function addUserBubble(text) {
    const b = el('div.bubble.user', { text });
    chatBox.appendChild(b);
    scroll();
    return b;
  }

  function addTyping() {
    const b = el('div.bubble.ai.typing', { text: '阿杏正在想…' });
    chatBox.appendChild(b);
    scroll();
    return b;
  }

  function addAiBubble(md) {
    const b = el('div.bubble.ai');
    b.appendChild(mdToNodes(md));
    b.appendChild(el('p.tiny.muted', {
      text: '想看你家摆上样子？点「拍照试摆」',
      style: 'margin:10px 0 0;',
    }));
    b.appendChild(el('div.row', { style: 'margin-top:8px;flex-wrap:wrap;' }, [
      el('button.btn', {
        text: '📷 拍照试摆', style: 'min-height:44px;',
        onclick: () => ctx.go('view-upload'),
      }),
      el('button.btn.btn--ghost', {
        text: '浏览家具', style: 'min-height:44px;',
        onclick: () => ctx.go('view-products'),
      }),
    ]));
    chatBox.appendChild(b);
    scroll();
    return b;
  }

  // 问候
  addAiBubble([
    '你好！我是阿杏～',
    '',
    '想挑什么家具？告诉我**预算**和**房间**，我帮你找。比如：',
    '',
    '- 我想要一个三四千的布艺沙发',
    '- 客厅小，有没有不占地方的',
  ].join('\n'));

  // ---------- 快捷问题 ----------
  const quickRow = el('div.chip-row', { style: 'margin-top:14px;' });
  quickRow.replaceChildren(...QUICK_QUESTIONS.map((q) => {
    const b = el('button.chip', { text: q });
    b.style.minHeight = '44px';
    b.addEventListener('click', () => sendText(q));
    return b;
  }));
  root.appendChild(quickRow);

  // ---------- 文字输入 ----------
  const input = el('input', {
    type: 'text', maxlength: '200', placeholder: '打字问我：预算多少？什么房间？', autocomplete: 'off',
  });
  input.setAttribute('aria-label', '输入你想问的');
  const sendBtn = el('button.btn.btn--primary', { text: '发送', style: 'min-height:48px;min-width:88px;' });
  sendBtn.addEventListener('click', () => sendText(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendText(input.value); }
  });
  root.appendChild(el('div.row', { style: 'margin-top:14px;align-items:stretch;' }, [input, sendBtn]));

  // ---------- 语音 ----------
  const recHint = el('div.loading-line', { text: '' });
  const micBtn = el('div.mic-btn', { role: 'button', tabindex: '0' });
  micBtn.setAttribute('aria-label', '按住说话');
  micBtn.appendChild(micIcon());
  micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRec(); });
  micBtn.addEventListener('pointerup', () => stopRec());
  micBtn.addEventListener('pointerleave', () => stopRec());
  micBtn.addEventListener('pointercancel', () => stopRec());
  micBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (recording) stopRec(); else startRec();
    }
  });
  root.appendChild(el('div', { style: 'margin-top:22px;' }, [
    micBtn,
    el('p.tiny.muted.center', { text: '按住话筒说话，松手就发送', style: 'margin:10px 0 0;' }),
    recHint,
  ]));

  function setSending(on) {
    sending = on;
    sendBtn.disabled = on;
    sendBtn.textContent = on ? '…' : '发送';
  }

  // ---------- 文字发送 ----------
  async function sendText(raw) {
    const text = (raw || '').trim();
    if (!text || sending) return;
    input.value = '';
    addUserBubble(text);
    const typing = addTyping();
    setSending(true);
    try {
      const data = await api.chatGuide(text, history.slice(-10));
      typing.remove();
      const reply = (data && data.reply) || '这个我没答上来，你打店里电话 13359140982 问问店员吧。';
      addAiBubble(reply);
      history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
      if (history.length > 20) history.splice(0, history.length - 20);
    } catch (err) {
      typing.remove();
      addAiBubble(`这次没接上话：${ctx.humanError(err)}\n你也可以打店里电话 13359140982，店员直接帮你挑。`);
    } finally {
      setSending(false);
    }
  }

  // ---------- 录音 ----------
  function stopTracks() {
    if (recStream) {
      recStream.getTracks().forEach((t) => t.stop());
      recStream = null;
    }
  }

  async function startRec() {
    if (recording || sending) return;
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      ctx.toast('这个浏览器不能录音，用文字跟我聊也一样');
      return;
    }
    try {
      recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      ctx.toast('没拿到麦克风权限，用文字跟我聊也一样');
      return;
    }
    const mime = pickMime();
    try {
      rec = mime ? new MediaRecorder(recStream, { mimeType: mime }) : new MediaRecorder(recStream);
    } catch {
      stopTracks();
      ctx.toast('录音没启动，用文字跟我聊也一样');
      return;
    }
    recChunks = [];
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) recChunks.push(ev.data); };
    rec.onerror = () => { stopRec(); };
    try {
      rec.start();
    } catch {
      stopTracks();
      rec = null;
      ctx.toast('录音没启动，用文字跟我聊也一样');
      return;
    }
    recording = true;
    micBtn.classList.add('recording');
    recHint.textContent = '正在听…松手就发送';
    clearTimeout(recTimeout);
    recTimeout = setTimeout(() => stopRec(), 60000);
  }

  async function stopRec() {
    if (!recording || !rec) return;
    recording = false;
    clearTimeout(recTimeout);
    micBtn.classList.remove('recording');
    recHint.textContent = '正在识别…';
    const mr = rec;
    rec = null;
    const stopped = new Promise((resolve) => { mr.onstop = resolve; });
    try { mr.stop(); } catch { /* 已经停了 */ }
    await stopped;
    stopTracks();
    const blob = new Blob(recChunks, { type: mr.mimeType || 'audio/webm' });
    recChunks = [];
    if (blob.size < 600) {
      recHint.textContent = '';
      ctx.toast('没听到声音，再按住说一次');
      return;
    }
    await sendVoice(blob);
  }

  async function sendVoice(blob) {
    const pending = addUserBubble('🎤 正在识别…');
    const typing = addTyping();
    setSending(true);
    try {
      const data = await api.voiceAsk(blob);
      typing.remove();
      pending.textContent = (data && data.userText) || '（语音）';
      addAiBubble((data && data.reply) || '这个我没答上来，你打店里电话 13359140982 问问店员吧。');
      playAudio(data && data.audioBase64, data && data.audioMime);
      history.push(
        { role: 'user', content: (data && data.userText) || '（语音）' },
        { role: 'assistant', content: (data && data.reply) || '' },
      );
      if (history.length > 20) history.splice(0, history.length - 20);
    } catch (err) {
      typing.remove();
      pending.textContent = '🎤 语音';
      addAiBubble(`语音没接上：${ctx.humanError(err)}\n你也可以直接打字，或打店里电话 13359140982。`);
    } finally {
      recHint.textContent = '';
      setSending(false);
    }
  }

  function playAudio(b64, mime) {
    if (!b64) return;
    try {
      const audio = new Audio(`data:${mime || 'audio/mpeg'};base64,${b64}`);
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自动播放被拦就静默 */ });
    } catch { /* 播放失败不影响文字 */ }
  }

  // ---------- 语音状态 ----------
  try {
    const st = await api.voiceStatus();
    statusEl.textContent = st && st.ready ? '语音就绪' : '语音休息中，可文字聊';
  } catch {
    statusEl.textContent = '语音休息中，可文字聊';
  }

  // ---------- cleanup ----------
  return () => {
    clearTimeout(recTimeout);
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* 忽略 */ }
    }
    stopTracks();
  };
}
