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

// ---------------------------------------------------------------- 「猜您还想问」（§1-7 样式二）
// 追问 chip 是**纯前端启发式**，不再打一次 LLM：一轮问答已经花掉 5-10 秒，
// 让顾客再等一轮才能看到「你可能还想问」，这条引导就失去意义了。
//
// 产出顺序：先从本轮回复正文里抽（表格数据行 / 列表项 / 加粗词）→ 包成问句；
// 不足 2 条就按用户这句话的关键词退到静态池；再不足才用通用池。
// 三层都会和「已发过的 user 消息」以及「上一轮已经出过的追问」做集合去重。

/** 通用兜底池：顺序即轮换顺序，够长才不会三轮就重复 */
const GENERIC_ASK_POOL = [
  '有没有便宜点的',
  '这个怎么保养',
  '适合小户型吗',
  '能到店试坐吗',
  '尺寸能不能定制',
  '发货要多久',
  '和真皮比哪个划算',
  '放三米二的客厅够吗',
];

/** 按用户这句话的关键词给针对性追问 */
const TOPIC_ASK = [
  { re: /沙发/, asks: ['三人位还是两人座适合我家', '布艺和真皮哪个更耐猫抓'] },
  { re: /床/, asks: ['床架材质怎么选', '一米八的床配多大床垫'] },
  { re: /柜|电视柜/, asks: ['柜子要不要做到顶', '电视柜多长合适'] },
  { re: /桌|茶几/, asks: ['茶几选圆还是长方', '桌子多高坐着舒服'] },
  { re: /风格|北欧|现代|奶油/, asks: ['这个风格配什么灯', '墙面刷什么色不撞'] },
];

/** 表头/字段名不该被当成商品名抽出来 */
const NON_TERM = /^(商品|价格|编号|项目|详情|材质|库存|好处|要注意|适合谁|怎么保养|提示|建议|到店提示|常规尺寸|现货|推荐理由|卖点|主要卖点|结论|合计|小计|适合场景|保养方法|注意事项|门店信息|门店联系方式|联系方式|电话|地址|营业时间|微信|内容|类别|类型|名称|说明|服务|权益|优惠|活动)$/i;
/** 一看就不是商品名的词：抽出来包成「××多少钱」会很可笑 */
const NOT_A_PRODUCT = /(试坐|推荐|提示|建议|结论|说明|注意|保养|优惠|活动|到店|来店|来电|拨打|咨询|免费|登录|网站|官网|点击|选择|看看|帮您|可以|需要|欢迎|拍打|清理|避免|别用|记得|长期|定期|实付|起售|库存|现货|尺寸|颜色|面料|日常|防污|妙招|实际|坐一坐|感受|体验|服务)/;
/** 价格/数字串：`¥2999起`、`2899`、`1.8米` 都不能当商品名 */
const IS_PRICE = /^[¥￥$]|\d/;

/** 一个词能不能拿来包成「××多少钱」。isTable=true 时放宽（表格首列基本就是商品名）。 */
function usableTerm(raw, isTable) {
  const t = String(raw || '')
    .replace(/[*_`>]/g, '')
    .replace(/^[-+]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[：:，,。；;、!！?？]+$/, '');
  if (t.length < 2 || t.length > 16) return null;
  if (NON_TERM.test(t)) return null;
  if (IS_PRICE.test(t)) return null;                      // ¥2999起 / 2899
  if (t.includes('：') || t.includes(':')) return null;   // 「卖点：粗纺…」这种字段行
  if (!isTable && NOT_A_PRODUCT.test(t)) return null;     // 非表格来源从严
  return t;
}

/**
 * 从回复正文里抽「能接着问」的词。
 *
 * 关键约束：只从**商品表**的首列抽。后端 GUIDE_INSTRUCTIONS 规定商品表表头是
 * 「商品 | 价格 | 编号」，但同一个回复里也常有「| 门店信息 | 电话 |」这种信息表。
 * 不认表头就会抽出「门店信息」「营业时间」当商品名，包成「××多少钱」很可笑。
 * 所以先看表头里有没有 商品/款式/名称，没有就整张表跳过。
 *
 * 拿不到商品表才退到加粗词 → 列表项，最后才轮到静态池。
 */
function extractTerms(reply) {
  const fromTable = [];
  const fromBold = [];
  const fromList = [];
  let inProductTable = false;      // 当前表格是不是商品表

  for (const rawLine of String(reply || '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('|')) {
      if (/^\|[\s\-:|]+\|?$/.test(line)) continue;              // | --- | 分隔行
      const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
      const head = cells.join(' ');
      if (/商品|款式|名称|货号/.test(head)) { inProductTable = true; continue; }
      if (/电话|地址|营业|联系|微信|门店/.test(head)) { inProductTable = false; continue; }
      if (!inProductTable) continue;                            // 信息表的数据行一律跳过
      const ok = usableTerm((cells[0] || '').replace(/[*`]/g, '').trim(), true);
      if (ok) fromTable.push(ok);
      continue;
    }

    inProductTable = false;                                     // 出了表格就重置
    const bullet = line.replace(/^[-*+]\s+/, '').replace(/^\d+[.、)]\s*/, '');
    if (bullet !== line) {
      const ok = usableTerm(bullet.split(/[：:，,。]/)[0], false);
      if (ok) fromList.push(ok);
    }
    for (const m of line.matchAll(/\*\*([^*]{2,16})\*\*/g)) {
      const ok = usableTerm(m[1], false);
      if (ok) fromBold.push(ok);
    }
  }
  // 有商品表就**只用商品表**：散文里的加粗/列表项动辄是「立刻用干布或纸巾吸干」
  // 这种操作说明，包成「××多少钱」很怪。商品表一个都没有，才退到散文来源。
  if (fromTable.length) return [...new Set(fromTable)];
  return [...new Set([...fromBold, ...fromList])];
}

/** 拿一个词包成问句；同一轮里别和已用过的问句撞 */
function askAround(term, used) {
  const variants = [`「${term}」多少钱`, `看看${term}的细节`, `${term}适合小户型吗`, `${term}怎么保养`];
  return variants.find((q) => !used.has(q)) || null;
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
  let streamError = '';          // 后端 onError 送来的具体原因（例：问题超过 500 字）

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
    if (ai) row.__mdReady = paintMarkdown(bubble, m.text);
    else bubble.textContent = m.text;
    return row;
  }

  function scrollToEnd() {
    const views = document.getElementById('views');
    if (views) views.scrollTop = views.scrollHeight;
  }

  // 追问 chip 必须让人看见。它在气泡**下方**另起一行，而气泡里的 markdown 是异步画完
  // 继续长高的（messageNode 里 paintMarkdown 返回 promise，appendAi 那一刻气泡还是空的）。
  // 所以 appendAi 里那次 scrollToEnd 滚的是「还没有答案」的高度；等 markdown 画完，
  // 这一行能再长 100px+，chips 就被顶到固定 Composer 底下。ResizeObserver 有
  // distanceFromBottom<80 的防拽阈值（见 watchHostHeight），长答案时它到这一步已经放弃。
  // 这里在 markdown 画完之后单独补一刀。只在顾客还停在底部时才补——他已经划上去看
  // 历史的话不能被拽回来。
  function revealFollowups(row) {
    const views = document.getElementById('views');
    const chipRow = row && row.querySelector('.ax-msg__followups');
    if (!views || !chipRow) return;
    const distance = views.scrollHeight - views.scrollTop - views.clientHeight;
    if (distance > 240) return;
    const vr = views.getBoundingClientRect();
    const cr = chipRow.getBoundingClientRect();
    const delta = cr.bottom - vr.bottom;
    if (delta > 0) views.scrollTop += delta;
  }

  // 气泡是**异步长高**的：paintMarkdown 要 await 引擎模块，流式 delta 一段段来，图片也要加载。
  // 只在 append 的那一刻 scrollToEnd()，滚的是「当时的高度」，等 markdown 画完高度才定型
  // ——实测滚完仍差 162px，顾客最新的那句话又在屏幕外（C 组 C2）。
  // 用 ResizeObserver 补偿：宿主一变高就再滚一次。
  // ⚠️ 判据不能是「离底部多远」：一条正常回复就能长高 100+px，用距离阈值会把该滚的那次
  // 也当成「用户在看历史」而跳过（第一版用了 80px，实测 gap 107px 就再也不滚了）。
  // 正确判据是「用户有没有主动往上滑」——程序性滚动后 dist≈0，会把 pinned 保持为 true；
  // 用户自己滑上去才会把它置 false，之后就不再拽他回来。
  let pinnedToBottom = true;
  let pinWatcher = null;
  function watchUserScrollIntent() {
    const views = document.getElementById('views');
    if (!views || typeof views.addEventListener !== 'function') return;
    if (pinWatcher) views.removeEventListener('scroll', pinWatcher);
    pinWatcher = () => {
      const dist = views.scrollHeight - views.scrollTop - views.clientHeight;
      pinnedToBottom = dist < 60;
    };
    views.addEventListener('scroll', pinWatcher, { passive: true });
  }

  /** 有新内容贴上时间线就重新pin。注意 app.js 的 setActive() 每次切 view 都把
   *  views.scrollTop 置 0，scroll 事件随之触发、被 pinWatcher 读成「用户上滑」——
   *  不在这里复位的话，接下来所有补偿滚动都会被那道判断拦住，最新气泡永远差一截。 */
  function pinToBottom() {
    pinnedToBottom = true;
    scrollToEnd();
  }

  let hostRO = null;
  function watchHostHeight() {
    if (typeof ResizeObserver !== 'function' || !host) return;
    if (hostRO) hostRO.disconnect();
    hostRO = new ResizeObserver(() => {
      const views = document.getElementById('views');
      if (!views || !pinnedToBottom) return;
      views.scrollTop = views.scrollHeight;
    });
    hostRO.observe(host);
    watchUserScrollIntent();
  }

  function renderAll() {
    if (!host) return;
    host.textContent = '';
    messages.forEach((m) => host.appendChild(messageNode(m)));
    if (typingEl) host.appendChild(typingEl);
    // 刚进店（只有阿杏播种的那句问候、顾客还没说过话）时**不要**滚到底。
    // 时间线排在 hero / 上传卡 / 四大功能 / 「你可以这样问」的下面，一进来就
    // scrollToEnd 会把上面全部顶出屏幕——实测 views.scrollTop=194，顾客第一眼看到的是
    // 中间的对话气泡，反而看不到阿杏的脸和第一 CTA「上传客厅照片」。
    // 顾客一旦说过话，这里就该滚到底（他在接着之前的聊）。
    const started = messages.some((m) => m.role === 'user');
    pinnedToBottom = started;
    if (started) scrollToEnd();
    else {
      const views = document.getElementById('views');
      if (views) views.scrollTop = 0;
    }
    watchHostHeight();
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
    const followups = (opts.followups || []).filter(Boolean).slice(0, 3);
    if (followups.length) {
      // 追问 chip 在气泡**下方**另起一行，不进气泡本体——气泡纯白、chips 是引导动作，
      // 混在一起会让人以为是阿杏说的话。头像和 timestamp 都在 .ax-msg__col 里，自然跟着走。
      const chipRow = el('div.ax-msg__followups');
      followups.forEach((q) => chipRow.appendChild(el('button.chip', {
        type: 'button',
        text: q,
        onclick: () => send(q),
      })));
      col.appendChild(chipRow);
    }
    host.appendChild(row);
    scrollToEnd();
    // 等 markdown 画完再把 chips 兜进来（气泡此刻还是空的，直接兜会兜个错的高度）
    if (followups.length) {
      const ready = row.__mdReady;
      if (ready && typeof ready.then === 'function') {
        ready.then(() => revealFollowups(row)).catch(() => {});
      } else revealFollowups(row);
    }
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
    if (host) { host.appendChild(row); pinToBottom(); }
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
   * 包一层 handlers，把「settle 一次」和「abort 闸门」管起来。
   *
   * 曾经这里有个运行时兜底：onError 时若一个业务事件都没收到，就判成
   * 「签名不匹配」并让上层换个调用形式重试一次。**这个兜底是错的，已删。**
   * 实测：顾客贴了 800 字 → 后端 400「问题太长」→ 一个事件都没收到 →
   * 被误判成签名不匹配 → 又发了一次请求，后端再回 400「请输入问题」。
   * 一条 400 变成两条请求，白扣一次限流额度，还把真正的错误信息盖掉了。
   * 签名形状用 `String(fn)` 静态探测一次就够了（见 streamCalls），
   * 那两种形状都是确定的，不需要、也不该靠运行时重试去猜。
   */
  function tryStream(callWith, handlers) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const wrap = {
        onStatus: (i) => handlers.onStatus && handlers.onStatus(i),
        onThinking: (t) => handlers.onThinking && handlers.onThinking(t),
        onTool: (n) => handlers.onTool && handlers.onTool(n),
        onDelta: (d) => handlers.onDelta && handlers.onDelta(d),
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
   * 注意：归一化只在这一层做。调用方一律传 (message, history, handlers) 三件套，
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
    streamError = '';
    const collected = { full: '' };
    // 注意：这里不再 openStreamBubble()。流式气泡由第一个 delta 懒建，
    // 否则 reasoning 阶段会在时间线上挂一个空白气泡（见 openStreamBubble 注释）。

    const handlers = {
      onStatus: () => {},
      onThinking: () => setTypingHint(''),
      onTool: (name) => setTypingHint(TOOL_HINT[name] || '正在想办法…'),
      onDelta: async (delta) => { if (!stopped) { collected.full += delta; await streamPush(delta); } },
      onDone: (reply) => { if (reply) collected.full = reply; },
      // 后端已经把话说清楚了，前端不该丢。api.js 对非 200 会取 body.error 送到这里
      // （例：贴了 600 字 → 400「问题太长，请控制在 500 字以内」）。
      // 原来是空实现，这句话被吞掉，顾客只看到「阿杏没说出话来」，完全不知道自己贴太长了。
      onError: (msg) => { if (msg) streamError = String(msg); },
    };

    // new Promise(executor) 同步执行，tryStream 返回时 streamSettle 已就位，
    // 随后 armTimeout() 才能在超时/停止时把 await 解开（否则 abort 后永远卡在「正在想」）。
    const runStream = (call) => {
      const promise = tryStream((h) => call(t, recentHistory(), h), handlers);
      armTimeout();
      return promise;
    };

    try {
      if (streamCalls) {
        const form = streamCalls.isPositional ? 'positional' : 'contract';
        const call = streamCalls[form];
        // 只发一次。曾有个「换个形式再发一次」的兜底，已删：它把每条
        // 首事件前的 400/429 都误判成签名不匹配，一条错变成两条请求
        // （白扣一次限流）还把真正的错误信息盖掉。静态探测见 streamCalls。
        await runStream(call);
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
        // 顾客可能在第一个 delta 之前就按了停止（LLM 还在 reasoning），
        // 那时 openStreamBubble() 没跑过、typing 行还在，得在这里收掉。
        hideTyping();
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
      // 只有「正常答完」这一处出追问。打断和兜底话术都不出——
      // 顾客已经打断/失败了，弹「猜您还想问」等于在错误时机推销（验收标准 3/4）。
      appendAi(finalText, { followups: pickFollowups(t, finalText) });
    } catch (err) {
      clearTimeout(timer);
      timer = null;
      job = null;
      const streamed = closeStreamBubble();
      // 先把「阿杏正在想」收掉，再 append 兜底/半截气泡。
      // hideTyping() 原先只在 openStreamBubble() 里调，而 LLM 一个 delta 都不给时
      // （报错 / 空回复）openStreamBubble() 根本不执行，typing 行就会和兜底气泡
      // 同时在时间线上挂一会儿，视觉上是重复占位。
      // finally 里的 setThinking(false) 也会 hideTyping()，但它在 appendAi **之后**才跑，
      // 收不住这一帧。所以这里显式先收（hideTyping 幂等，重复调无害）。
      hideTyping();
      if (stopped) {
        // 用户主动停止 / 超时：保留已生成的部分，别把顾客的话甩在半空
        if (streamed.trim()) { remember('ai', streamed); appendAi(streamed); }
        else { remember('ai', '（回答被打断）'); appendAi('（阿杏说到这里被打断了，你接着问就行）'); }
        if (!/等太久/.test((err && err.message) || '')) ctx.toast('已经让阿杏停下了');
      } else {
        // 后端给的具体原因优先（太长 / 今日次数用完 / 缺 key…），
        // 翻不成人话时才退回 err 的人话。toast 说清卡在哪，时间线那句也要带上原因。
        const reason = streamError || ctx.humanError(err);
        ctx.toast(reason);
        if (streamed.trim()) { remember('ai', streamed); appendAi(streamed); }
        else {
          // 时间线不能出现问了没答的空洞（§3-2），但至少要说清为什么没答。
          const line = `${FALLBACK_TEXT}\n\n> 原因：${reason}`;
          remember('ai', line);
          appendAi(line);
        }
      }
    } finally {
      clearTimeout(timer);
      timer = null;
      job = null;
      streamSettle = null;
      stopped = false;
      setThinking(false);      // 内部也会 hideTyping()，幂等；兜住上面每条 return 路径
    }
  }

  function stop() { stopNow(); }

  // ---------------------------------------------------------------- 追问 chip 的产出
  // 每轮 AI 回复都出（§1-7「补充和延续用户意图」），但同一会话里不重复同一组：
  // - 和顾客已经发过的话重复 → 不要（再问一遍显得没在听）
  // - 和上一轮已经出过的追问重复 → 不要（连问三轮同样两条很傻）
  const askedByUser = () => new Set(
    messages.filter((m) => m.role === 'user').map((m) => m.text.trim()).filter(Boolean),
  );
  let lastFollowups = [];
  let genericCursor = 0;

  function pickFollowups(userText, replyText) {
    const banned = askedByUser();
    lastFollowups.forEach((q) => banned.add(q));
    const picked = [];

    const add = (q) => {
      if (!q || picked.length >= 3) return;
      if (banned.has(q) || picked.includes(q)) return;
      picked.push(q);
      banned.add(q);
    };

    // 1) 从本轮回复正文抽词，包成问句
    for (const term of extractTerms(replyText)) {
      if (picked.length >= 2) break;
      add(askAround(term, banned));
    }
    // 2) 按用户这句话的关键词退到针对性追问
    if (picked.length < 2) {
      for (const t of TOPIC_ASK) {
        if (!t.re.test(userText)) continue;
        t.asks.forEach(add);
        if (picked.length >= 2) break;
      }
    }
    // 3) 通用池轮换兜底
    for (let i = 0; i < GENERIC_ASK_POOL.length && picked.length < 2; i++) {
      const q = GENERIC_ASK_POOL[(genericCursor + i) % GENERIC_ASK_POOL.length];
      add(q);
    }
    genericCursor = (genericCursor + picked.length) % GENERIC_ASK_POOL.length;

    lastFollowups = picked;
    return picked;
  }

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
