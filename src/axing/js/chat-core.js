// chat-core.js — 阿杏「常驻对话中枢」（交互规范 §1-6，P2 的根因修复）
//
// 为什么要有这个文件：改动前聊天气泡是 view-home.js 的本地变量，消息 append 进
// #view-home 内的 timeline。顾客一旦在别页（原先的 #view-upload、商品页…）发一句话，
// 消息就落进一个 display:none 的容器里——「我发的 query 用户看不到」就是这么来的。
// 现在时间线由 app shell 级中枢持有，任何 view 发消息都会先切回 view-home。
//
// 依赖约定（docs/阿杏交互规范-落地契约.md §1.1 / §1.3）：
//   - ./markdown.js            markdown agent 交付（renderMarkdown / createMarkdownStream）
//   - ctx.api.chatGuideStream  api agent 交付（SSE 流式，返回 { abort() }）
// 两者都用**动态 import + 能力探测**接入：同批 agent 未交付、或上线时文件缺失，
// 都自动降级（本地文本渲染 / 非流式 chatGuide），不会让整页脚本崩掉。

const TIMEOUT_MS = 20000;        // UI 层竞速超时（后端硬超时 60s，见 chat-guide-agent.js）
const MAX_TURNS = 6;             // 随身上下文轮数（1 轮 = user + assistant），支撑「换一个」这类指代
const MAX_MSGS = MAX_TURNS * 2;
const CONTENT_MAX = 2000;        // 单轮内容截断
const FALLBACK_TEXT = '阿杏刚刚走神了，没听清。你再说一遍好不好？';

/** 工具名 → 人话（豆包 reasoning_content 是内部推理，不上屏，只借 tool 事件占个文案） */
const TOOL_HINT = {
  list_on_sale_products: '正在把店里的在售家具列一遍…',
  search_products: '正在翻店里的在售家具…',
  get_store_info: '正在查门店地址和电话…',
};

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 首屏那句「你好呀！我是阿杏～」由 chat-core 播种：时间线和消息数组都归它持有，
// 首条消息放在这里，attachTimeline() 时会随其它消息一起渲染出来。
// view-home 只提供挂载点，不再自己 append（曾因此重复成两条）。
// 只有 AI 一条、没有伪造的用户轮次，所以不是「已经有人在聊」的假对话。
const GREETING = [
  '你好呀！我是阿杏～',
  '',
  '你可以上传一张你家的客厅照片，我会帮你把喜欢的家具搬进你家看看哦！',
].join('\n');

let mdModulePromise = null;
function loadMarkdown() {
  if (!mdModulePromise) mdModulePromise = import('./markdown.js').catch(() => null);
  return mdModulePromise;
}

export function initChat(ctx) {
  const { el, avatar } = ctx.ui;

  /** @type {{id:number,role:'ai'|'user',text:string,time:string}[]} */
  const messages = [];
  const history = [];            // {role, content}，最近 MAX_MSGS 条
  let host = null;
  let seq = 0;
  let busy = false;
  let typingEl = null;
  let pending = null;            // { bubble, row, assemble, stream, raf }
  let job = null;                // 当前 SSE job（只有它真能掐断底层请求）
  let streamSettle = null;       // 解开 await 的闸门：abort 时底层可能既不 resolve 也不 reject
  let timer = null;
  let stopped = false;

  function remember(role, content) {
    const text = String(content).slice(0, CONTENT_MAX);
    if (!text.trim()) return;
    history.push({ role, content: text });
    while (history.length > MAX_MSGS) history.shift();
  }
  const recentHistory = () => history.slice(-MAX_MSGS);

  // ---------------------------------------------------------------- DOM 基础件
  function aiAvatarNode() {
    const node = avatar('sm');
    node.classList.add('ax-msg__ava');
    return node;
  }
  function userAvatarNode() {
    return el('div.ax-msg__ava.ax-msg__ava--user', { text: '我', 'aria-hidden': 'true' });
  }

  /**
   * Markdown → 气泡内容。渲染器未就绪时按行降级成纯文本，
   * 至少不能把 `| 项目 | 详情 |` 这类表格骨架裸着吐给顾客。
   */
  async function paintMarkdown(target, markdownText) {
    const text = String(markdownText || '');
    const md = await loadMarkdown();
    if (md && typeof md.renderMarkdown === 'function') {
      target.textContent = '';
      target.appendChild(md.renderMarkdown(text));
      return;
    }
    target.textContent = '';
    text.split('\n').forEach((line, i) => {
      const t = line.trim();
      if (i) target.appendChild(el('br'));
      if (!t) return;
      target.appendChild(document.createTextNode(
        t.replace(/^#{1,6}\s*/, '').replace(/^\s*[-*]\s+/, '· ').replace(/\*\*/g, ''),
      ));
    });
  }

  function messageNode(m) {
    const ai = m.role !== 'user';
    const bubble = el('div.ax-msg__bubble');
    const row = el(`div.ax-msg.ax-msg--${ai ? 'ai' : 'user'}`, {}, [
      ai ? aiAvatarNode() : userAvatarNode(),
      el('div.ax-msg__col', {}, [bubble, el('div.ax-msg__time', { text: m.time })]),
    ]);
    if (ai) paintMarkdown(bubble, m.text);
    else bubble.textContent = m.text;
    return row;
  }

  function scrollToEnd() {
    const views = document.getElementById('views');
    if (views) views.scrollTop = views.scrollHeight;
  }

  function renderAll() {
    if (!host) return;
    host.textContent = '';
    messages.forEach((m) => host.appendChild(messageNode(m)));
    if (typingEl) host.appendChild(typingEl);
    scrollToEnd();
  }

  function attachTimeline(nextHost) {
    const prev = host;
    host = nextHost;
    renderAll();
    // 清掉 ensureHost() 自举出来的宿主，避免出现两条时间线
    if (prev && prev !== nextHost && prev.parentElement) prev.remove();
  }
  function detachTimeline() {
    host = null;
  }

  /**
   * 找不到宿主时自举一个。chat-core 持有时间线，就不能指望某个 view 一定先挂载——
   * 顾客可能在 view-home 挂载完成前就发了消息，那时也必须有地方显示。
   * view-home 挂载后会用自己的 host 调 attachTimeline()，自举节点会被顺手清掉。
   */
  function ensureHost() {
    if (host && document.contains(host)) return host;
    const existing = document.getElementById('chatHost');
    if (existing) { attachTimeline(existing); return host; }
    const home = document.getElementById('view-home');
    if (!home) return null;
    const box = el('div.ax-timeline', { id: 'chatHost' });
    const stack = home.querySelector('.stack');
    const first = stack ? stack.firstElementChild : null;
    if (stack && first && first.nextSibling) stack.insertBefore(box, first.nextSibling);
    else if (stack) stack.appendChild(box);
    else home.appendChild(box);
    attachTimeline(box);
    return host;
  }

  // ---------------------------------------------------------------- 塞消息
  function appendUser(text) {
    const t = String(text || '').trim();
    if (!t) return;
    const m = { id: ++seq, role: 'user', text: t, time: now() };
    messages.push(m);
    if (host) host.appendChild(messageNode(m));
    scrollToEnd();
  }

  function appendAi(markdown, opts = {}) {
    const t = String(markdown || '');
    const m = { id: ++seq, role: 'ai', text: t, time: now() };
    messages.push(m);
    if (!host) return;
    const row = messageNode(m);
    const col = row.querySelector('.ax-msg__col');
    (opts.followups || []).forEach((q) => {
      col.appendChild(el('button.chip', {
        type: 'button',
        text: q,
        style: 'min-height:44px;margin-top:8px;',
        onclick: () => send(q),
      }));
    });
    host.appendChild(row);
    scrollToEnd();
  }

  // ---------------------------------------------------------------- 「阿杏正在想」
  function showTyping(hint) {
    if (typingEl || !host) return;
    typingEl = el('div.ax-msg.ax-msg--typing.ax-msg--ai', {}, [
      aiAvatarNode(),
      el('div.ax-msg__col', {}, [
        el('div.ax-msg__bubble', {}, [
          el('span.ax-dots', {}, [el('i'), el('i'), el('i')]),
          el('span.ax-thinking-hint', { text: hint || '' }),
        ]),
      ]),
    ]);
    host.appendChild(typingEl);
    scrollToEnd();
  }
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }
  function setTypingHint(hint) {
    if (!typingEl) return;
    const span = typingEl.querySelector('.ax-thinking-hint');
    if (span) span.textContent = hint || '';
  }

  // ---------------------------------------------------------------- 发送键 / 停止生成键
  const sendBtn = () => document.getElementById('composerSend');
  const stopBtn = () => document.getElementById('composerStop');
  // .ax-composer__btn{display:flex} 会盖掉 UA 的 [hidden]{display:none}，两个会互相
  // 切换显隐的按钮必须显式写内联 display，否则会出现「发送与图片同显」这类老 bug。
  const setBtnHidden = (node, hidden) => {
    if (!node) return;
    node.hidden = hidden;
    node.style.display = hidden ? 'none' : '';
  };
  function syncGenerateButtons() {
    setBtnHidden(stopBtn(), !busy);
    if (busy) {
      setBtnHidden(sendBtn(), true);     // 生成中发送键让位给停止生成键
      return;
    }
    // 不生成时，发送/相册的显隐交回 chat-composer 的单一逻辑（它只看输入框有没有字），
    // 避免两个文件各自维护一套显隐状态互相打架。
    const input = document.getElementById('composerInput');
    if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function setThinking(on, hint) {
    busy = on;
    syncGenerateButtons();
    const input = document.getElementById('composerInput');
    if (input) {
      input.readOnly = on;
      if (!input.dataset.basePh) input.dataset.basePh = input.placeholder;
      input.placeholder = on ? '阿杏正在想…' : input.dataset.basePh;
    }
    if (on) showTyping(hint);
    else hideTyping();
  }

  // ---------------------------------------------------------------- 流式气泡
  function openStreamBubble() {
    if (pending) return pending;          // 幂等：第一个 delta 才建，之后复用同一个
    // 规范 §1-6.4：「阿杏正在想」占位是全对话流唯一的。setThinking(true) 已经挂了
    // ax-msg--typing，这里必须先收掉，否则抖点气泡和流式正文气泡会同时挂在时间线上。
    hideTyping();
    const bubble = el('div.ax-msg__bubble');
    const row = el('div.ax-msg.ax-msg--ai.ax-msg--streaming', {}, [
      aiAvatarNode(),
      el('div.ax-msg__col', {}, [bubble, el('div.ax-msg__time', { text: now() })]),
    ]);
    pending = { bubble, row, assemble: '', stream: null, raf: 0 };
    if (host) { host.appendChild(row); scrollToEnd(); }
    return pending;
  }

  /**
   * 流式气泡**懒建**：等第一个 delta 到了才建，之前一直只显示「阿杏正在想」。
   * step-3.7-flash 的 reasoning 阶段能拖好几秒，预先建一个空气泡会挂出一个
   * 空白的白色圆角块在时间线上，像坏了一样（实测复现过）。
   */

  async function streamPush(delta) {
    if (!pending) openStreamBubble();      // 懒建：第一个 delta 才挂气泡
    if (!pending) return;
    pending.assemble += delta;
    const md = await loadMarkdown();
    // 渲染器就绪：交给 ynet 的 key diff，只重画 stable=false 的未稳定节点，
    // 流式时表格/列表不会整块抖。
    if (md && typeof md.createMarkdownStream === 'function') {
      if (!pending.stream) pending.stream = md.createMarkdownStream(pending.bubble);
      pending.stream.push(delta);
      return;
    }
    // 未就绪：降级成整段 repaint，用 rAF 合帧，别把主线程打死
    if (pending.raf) return;
    pending.raf = requestAnimationFrame(async () => {
      pending.raf = 0;
      if (!pending) return;
      await paintMarkdown(pending.bubble, pending.assemble);
      scrollToEnd();
    });
  }

  /** 撤掉流式临时气泡，返回已收到的文本（转正由调用方决定） */
  function closeStreamBubble() {
    if (!pending) return '';
    const text = pending.assemble;
    const row = pending.row;
    pending = null;
    if (row.parentElement) row.remove();
    return text;
  }

  // ---------------------------------------------------------------- 跑一轮流式
  // 放在 initChat 作用域而非 send 里：stop() 是返回给外部调用的，必须能在 send() 之外掐断。
  const killJob = () => {
    clearTimeout(timer);
    timer = null;
    if (job && typeof job.abort === 'function') { try { job.abort(); } catch { /* 已结束 */ } }
    // 底层 abort 后可能既不 resolve 也不 reject（reader 直接抛且被 api 层吞掉），
    // 这里显式解开 await，否则用户点了「停止生成」界面还卡在正在想。
    if (streamSettle) { const s = streamSettle; streamSettle = null; s.resolve(); }
  };
  const stopNow = () => {
    if (!busy) return;
    stopped = true;               // onDelta 据此停止续拼，最终分支据此保留半截回答
    killJob();
  };
  const armTimeout = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stopped = true;             // 超时按「打断」处理：已生成部分保留，不强留空洞
      killJob();
    }, TIMEOUT_MS);
  };

  /**
   * api.chatGuideStream 的签名在两处实现间漂移过：契约是
   * ({message, history}, handlers)，api.js 交付的是 (message, history, handlers)。
   * 首调走契约式；若一个业务事件都没收到就报错（典型症状：首参被当成位置参数，
   * 请求体被拼成 {message:{...}, history:[]}，后端 400），自动按位置式重试一次。
   */
  function tryStream(callWith, handlers) {
    return new Promise((resolve, reject) => {
      let sawEvent = false;
      let settled = false;
      const wrap = {
        onStatus: (i) => { sawEvent = true; handlers.onStatus && handlers.onStatus(i); },
        onThinking: (t) => { sawEvent = true; handlers.onThinking && handlers.onThinking(t); },
        onTool: (n) => { sawEvent = true; handlers.onTool && handlers.onTool(n); },
        onDelta: (d) => { sawEvent = true; handlers.onDelta && handlers.onDelta(d); },
        onDone: (r) => {
          if (settled) return;
          settled = true;
          streamSettle = null;
          handlers.onDone && handlers.onDone(r);
          resolve();
        },
        onError: (m) => {
          if (settled) return;
          settled = true;
          streamSettle = null;
          if (!sawEvent) {
            const e = new Error(m);
            e.signatureMismatch = true;
            reject(e);
            return;
          }
          reject(new Error(m));
        },
      };
      streamSettle = { resolve, reject };
      job = callWith(wrap);
    });
  }

  /**
   * api.chatGuideStream 的签名在两处实现间漂移过：契约是
   * ({message, history}, handlers)，api.js 交付的是 (message, history, handlers)。
   *
   * 为什么不能「先按错的一次发出去、报了错再重试」：位置式包装会把第 2 个实参
   * （我们的 handlers）当成 history，第 3 个参数落默认值 {}，于是所有事件回调被吞掉，
   * 后端收到的也是拼错的请求体——既不 resolve 也不 onError，界面永远卡在「正在想」。
   * 函数源码是本地模块、可读，所以按它静态判断一次，两种调用形式都备好。
   *
   * 注意：规范化只在这一层做。调用方一律传 (message, history, handlers) 三件套，
   * 不要再自己判断形状——否则两层归一化互相抵消，又回到发错请求体那条路上去。
   */
  const streamCalls = (() => {
    const fn = (ctx.api && ctx.api.chatGuideStream) || null;
    if (typeof fn !== 'function') return null;
    let src = '';
    try { src = String(fn); } catch { /* 不允许序列化时按契约式 */ }
    const isPositional = /history\s*=\s*\[\]/.test(src) && /,\s*handlers\s*=/.test(src);
    return {
      isPositional,
      contract: (m, h, handlers) => fn({ message: m, history: h }, handlers),
      positional: (m, h, handlers) => fn(m, h, handlers),
    };
  })();

  async function send(text) {
    const t = String(text || '').trim();
    if (!t || busy) return;

    // §1-6 铁律 1：非对话页发消息，先切回对话流再上屏（P2 的修复点）
    if (ctx.current !== 'view-home') {
      try { await ctx.go('view-home'); } catch { /* 壳没就绪也要继续，不能丢消息 */ }
    }
    // 兜底：view-home 还没挂载 / attachTimeline 尚未跑完时，自己找到或自举宿主
    ensureHost();

    appendUser(t);
    remember('user', t);
    setThinking(true);
    stopped = false;
    const collected = { full: '' };
    // 注意：这里不再 openStreamBubble()。流式气泡由第一个 delta 懒建，
    // 否则 reasoning 阶段会在时间线上挂一个空白气泡（见 openStreamBubble 注释）。

    const handlers = {
      onStatus: () => {},
      onThinking: () => setTypingHint(''),
      onTool: (name) => setTypingHint(TOOL_HINT[name] || '正在想办法…'),
      onDelta: async (delta) => { if (!stopped) { collected.full += delta; await streamPush(delta); } },
      onDone: (reply) => { if (reply) collected.full = reply; },
      onError: () => {},
    };

    // new Promise(executor) 同步执行，tryStream 返回时 streamSettle 已就位，
    // 随后 armTimeout() 才能在超时/停止时把 await 解开（否则 abort 后永远卡在「正在想」）。
    const runStream = (form) => {
      const call = form === 'positional' ? streamCalls.positional : streamCalls.contract;
      const promise = tryStream((h) => call(t, recentHistory(), h), handlers);
      armTimeout();
      return promise;
    };

    try {
      if (streamCalls) {
        const first = streamCalls.isPositional ? 'positional' : 'contract';
        const second = streamCalls.isPositional ? 'contract' : 'positional';
        try {
          await runStream(first);
        } catch (err) {
          if (!err || !err.signatureMismatch) throw err;
          await runStream(second);   // 静态探测没认出来时的兜底
        }
      } else {
        // 过渡兜底：api agent 还没交付 chatGuideStream 时走非流式，链路照样通。
        // fetch 不接 signal，所以这里只能用 Promise.race 做 UI 层竞速，底层请求自行结束。
        job = null;
        armTimeout();
        const guard = new Promise((_, reject) => {
          clearTimeout(timer);
          timer = setTimeout(() => reject(new Error('等太久了，网络有点慢')), TIMEOUT_MS);
        });
        // ctx.api 而不是裸 api：initChat 只从 ctx.ui 解构了 el/avatar，
        // 裸 api 不在作用域里，这条兜底路径会抛 ReferenceError 并被 catch 吞成
        // 「网络错误」——顾客看到的就是「点了没反应」。
        const data = await Promise.race([ctx.api.chatGuide(t, recentHistory()), guard]);
        collected.full = (data && data.reply) || '';
      }

      clearTimeout(timer);
      timer = null;
      job = null;

      if (stopped) {
        const streamed = closeStreamBubble();
        if (streamed.trim()) { remember('ai', streamed); appendAi(streamed); }
        else remember('ai', '（回答被打断）');
        ctx.toast('已经让阿杏停下了');
        return;
      }

      // 先撤流式临时气泡，再挑正文。不能写成
      // (collected.full ? collected.full : closeStreamBubble())——
      // 那样 collected.full 非空时 closeStreamBubble() 根本不执行，
      // 流式那行会留在时间线上，和转正的消息重复一遍。
      const streamed = closeStreamBubble();
      const finalText = (collected.full.trim() ? collected.full : streamed).trim();
      if (!finalText) throw new Error('阿杏没说出话来，再试一次');
      remember('ai', finalText);
      appendAi(finalText);
    } catch (err) {
      clearTimeout(timer);
      timer = null;
      job = null;
      const streamed = closeStreamBubble();
      if (stopped) {
        // 用户主动停止 / 超时：保留已生成的部分，别把顾客的话甩在半空
        if (streamed.trim()) { remember('ai', streamed); appendAi(streamed); }
        else { remember('ai', '（回答被打断）'); appendAi('（阿杏说到这里被打断了，你接着问就行）'); }
        if (!/等太久/.test((err && err.message) || '')) ctx.toast('已经让阿杏停下了');
      } else {
        ctx.toast(ctx.humanError(err));               // 超时/断网/限流都翻成人话
        if (streamed.trim()) { remember('ai', streamed); appendAi(streamed); }
        else { remember('ai', FALLBACK_TEXT); appendAi(FALLBACK_TEXT); }  // 时间线不能有空洞
      }
    } finally {
      clearTimeout(timer);
      timer = null;
      job = null;
      streamSettle = null;
      stopped = false;
      setThinking(false);
    }
  }

  function stop() { stopNow(); }

  // ---------------------------------------------------------------- 初始化
  messages.push({ id: ++seq, role: 'ai', text: GREETING, time: now() });
  const stopEl = stopBtn();
  if (stopEl) stopEl.addEventListener('click', stop);

  return {
    send, stop, appendUser, appendAi, setThinking,
    isBusy: () => busy,
    attachTimeline, detachTimeline, ensureHost,
    get host() { return host; },
    get messages() { return messages.slice(); },
  };
}
