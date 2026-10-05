// view-home.js — 阿杏首页「聊天优先」单屏（视觉基准：docs/阿杏AI家居导购界面.png）
// 结构（从上到下）：hero 问候 → 聊天时间线 → 上传客厅照卡 → 你可以这样问 → 四大功能 → 上次试摆 → 打给店里
// 约定：export async function mount(root, ctx)，返回 cleanup；样式只取 css/axing.css 的 .ax-* 类。

/** 预置两轮对话（对齐参考图首批内容，之后靠 chat:message 事件续接）。
 *  阿杏那句压到参考图的三行内：首屏要塞进 hero + 对话 + 上传卡 + 四宫格，
 *  多一行就多推一档，老人要多滚一下。 */
const PRESET_CHAT = [
  { role: 'user', text: '想要布艺沙发，三千左右，放我家客厅看看' },
  {
    role: 'ai',
    text: '好的！先上传一张客厅照片，我来帮你挑合适的款式和尺寸，再生成真实的摆放效果。',
  },
];

/** 「你可以这样问」候选池：首批即参考图那批，换一换按 4 条一批往后翻 */
const ASKS = [
  '现代简约沙发', '三千左右的沙发', '北欧风格', '小户型沙发',
  '奶油风的床有推荐吗', '客厅三米五，转角沙发放得下吗',
  '家有小孩和猫，什么面料好打理', '一千五左右的电视柜',
  '布艺和真皮哪个更耐猫抓', '两人座还是三人座适合我家',
  '茶几和沙发怎么搭配', '实木家具会不会太老气',
];
const ASK_BATCH = 4;

/** 四大功能（参考图四宫格，顺序固定） */
const QUICK = [
  { go: 'view-upload', icon: 'camera', tone: 'apricot', label: '拍照试摆', desc: '把家具搬进你家' },
  { go: 'view-voice', icon: 'mic', tone: 'stone', label: '语音导购', desc: '说出你的需求' },
  { go: 'view-products', icon: 'sofa', tone: 'stone', label: '浏览家具', desc: '沙发 / 床 / 柜子' },
  { go: 'view-plans', icon: 'spark', tone: 'apricot', label: '我的方案', desc: '看过的都在这' },
];

/** 示例客厅兜底图：品类示例图缺失时先退到这里，再失败才换文字占位 */
const ROOM_FALLBACK = '/images/default-room.jpg';

// ---------------------------------------------------------------- 聊天气泡

/** avatar('sm') 补上时间线的头像类（尺寸/圆角/底色由 css .ax-msg__ava 管） */
function withAvaClass(node) {
  node.classList.add('ax-msg__ava');
  return node;
}

/** 一条聊天气泡：AI 侧阿杏头像，用户侧「我」字圆。
 *  参考图没有名字小字，且首屏要塞进 hero+对话+上传卡+四宫格，姓名标签只增噪不增量。 */
function chatRow(ctx, role, text) {
  const { el, avatar } = ctx.ui;
  const ai = role !== 'user';
  return el(`div.ax-msg.ax-msg--${ai ? 'ai' : 'user'}`, {}, [
    ai ? withAvaClass(avatar('sm')) : el('div.ax-msg__ava.ax-msg__ava--user', { text: '我', 'aria-hidden': 'true' }),
    el('div.ax-msg__col', {}, [
      el('div.ax-msg__bubble', { text }),
    ]),
  ]);
}

/** 「阿杏正在想」占位气泡：三个抖点 */
function typingRow(ctx) {
  const { el, avatar } = ctx.ui;
  return el('div.ax-msg.ax-msg--typing.ax-msg--ai', {}, [
    withAvaClass(avatar('sm')),
    el('div.ax-msg__col', {}, [
      el('div.ax-msg__bubble', {}, [el('span.ax-dots', {}, [el('i'), el('i'), el('i')])]),
    ]),
  ]);
}

// ---------------------------------------------------------------- 上传客厅照卡

/** 房间图：加载失败先退兜底图，再失败换文字占位（不留破图，也不会无限重试） */
function roomImg(ctx, url, alt, fallbackText) {
  const { el } = ctx.ui;
  const img = el('img', { src: url || ROOM_FALLBACK, alt, loading: 'lazy' });
  img.addEventListener('error', () => {
    if (img.getAttribute('src') !== ROOM_FALLBACK) {
      img.src = ROOM_FALLBACK;
      return;
    }
    img.replaceWith(el('div.ax-samples__label', {
      text: fallbackText,
      style: 'display:flex;align-items:center;justify-content:center;height:100%;padding:6px;text-align:center;',
    }));
  });
  return img;
}

/** 探测一张图是否真的加载得出来（示例房间图有数据债：bed 指向的 default-room-bed.jpg 不存在） */
function probeImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const im = new Image();
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = url;
  });
}

/** 上传客厅照卡（首页第一 CTA）：整卡进上传页，示例缩略图带品类直达 */
async function uploadCard(ctx, goView) {
  const { el, icon } = ctx.ui;
  let cats = [];
  let products = [];
  try {
    const [catData, prodData] = await Promise.all([
      ctx.api.categories(),
      ctx.api.products().catch(() => []),
    ]);
    const list = (catData && catData.categories) || (Array.isArray(catData) ? catData : []);
    products = (prodData && prodData.products) || (Array.isArray(prodData) ? prodData : []);
    cats = list.filter((c) => c && c.enabled !== false).slice(0, 4);
  } catch (err) {
    ctx.toast(ctx.humanError(err));
  }

  // 品类示例图按「声明房间图 → 该品类在售商品图 → 通用客厅图」逐级探测。
  // 不这么做的话，房间图缺失的品类会在 onerror 里塌成和主预览同一张图，并排两张一样的很像 bug。
  const resolveCatImage = async (c) => {
    const productImg = products.find((p) => p && p.category === c.id && p.image);
    for (const url of [c.defaultRoom, productImg && productImg.image, ROOM_FALLBACK]) {
      if (url && await probeImage(url)) return url;
    }
    return ROOM_FALLBACK;
  };

  const resolved = [];
  for (const c of cats) resolved.push({ c, url: await resolveCatImage(c) });

  // 主预览：第 1 个 enabled 品类的示例客厅；一个品类都没有时用兜底图
  const mainUrl = resolved.length ? resolved[0].url : ROOM_FALLBACK;
  const main = el('figure.ax-ucard__main', {}, [
    roomImg(ctx, mainUrl, '示例客厅', cats[0] ? cats[0].name : '示例客厅'),
    el('figcaption', { text: '示例客厅' }),
  ]);

  // 右侧示例列：与主预览同图的格子直接不放——没有第二张就别摆两张一样的占位
  const sampleCats = resolved.slice(1).filter((r) => r.url !== mainUrl).slice(0, 3);
  const grid = el('div.ax-samples__grid', {}, sampleCats.map(({ c, url }) => el('button.ax-sample', {
    type: 'button',
    'aria-label': `用${c.room || ''}示例：${c.name || c.id}`,
    onclick: () => {
      ctx.setState({ sampleRoom: url, sampleCategoryId: c.id });
      goView('view-upload');
    },
  }, [roomImg(ctx, url, c.name || c.id, c.name || c.id)])));
  const samples = el('div.ax-samples', { hidden: sampleCats.length === 0 }, [
    el('div.ax-samples__label', { text: '或者试试示例客厅' }),
    grid,
  ]);

  // css 没给 .ax-ucard__go svg 定尺寸，这里补 20px（否则 SVG 按 100% 撑爆布局）
  const chev = icon('chev');
  chev.style.cssText = 'width:20px;height:20px;display:block;';
  const card = el('div.ax-ucard', {
    role: 'button',
    tabindex: '0',
    'aria-label': '上传客厅照片，让阿杏提前把喜欢的家具为您搬回家',
    style: 'cursor:pointer;',
  }, [
    el('div.ax-ucard__head', {}, [
      el('div.ax-ucard__ico', {}, [icon('camera')]),
      el('div.grow', {}, [
        el('div.ax-ucard__title', { text: '上传客厅照片' }),
        el('div.ax-ucard__desc', { text: '让阿杏提前把喜欢的家具为您搬回家～' }),
      ]),
      el('div.ax-ucard__go', {}, [chev]),
    ]),
    el('div.ax-ucard__body', {}, [main, samples]),
    el('div.ax-ucard__hint', { text: '尽量拍到完整的墙面、地面和主要空间，试摆效果会更准确。' }),
  ]);
  // 点卡本身进上传页；点示例缩略图由按钮自己处理，别重复跳转
  card.addEventListener('click', (e) => {
    if (e.target.closest('.ax-sample')) return;
    goView('view-upload');
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goView('view-upload');
    }
  });
  return card;
}

// ---------------------------------------------------------------- 你可以这样问 / 四大功能

/** 「你可以这样问」：4 条一批，点 chip 以用户身份发进对话（接口由 Composer 负责） */
function askBlock(ctx) {
  const { el, icon } = ctx.ui;
  const chip = (text) => el('button.chip', { type: 'button', text, onclick: () => ctx.appendChat('user', text) });
  const chips = el('div.ax-ask__chips');
  let idx = 0;
  const paint = () => {
    chips.replaceChildren(...ASKS.slice(idx, idx + ASK_BATCH).map(chip));
  };
  paint();
  const more = el('button.ax-ask__more', { type: 'button', style: 'min-height:44px;' }, [
    icon('refresh'),
    el('span', { text: '换一换' }),
  ]);
  more.addEventListener('click', () => {
    idx = (idx + ASK_BATCH) % ASKS.length;
    paint();
  });
  return el('div', {}, [
    el('div.ax-ask__head', {}, [el('div.ax-ask__title', { text: '你可以这样问：' }), more]),
    chips,
  ]);
}

/** 四大功能入口（参考图四宫格） */
function quickBlock(ctx, goView) {
  const { el, icon } = ctx.ui;
  return el('div.ax-quick', {}, QUICK.map((q) => el('button.ax-quick__tile', {
    type: 'button',
    onclick: () => goView(q.go),
  }, [
    el(`div.ax-quick__ico.ax-quick__ico--${q.tone}`, {}, [icon(q.icon)]),
    el('div.ax-quick__label', { text: q.label }),
    el('div.ax-quick__desc', { text: q.desc }),
  ])));
}

// ---------------------------------------------------------------- 上次试摆结果

/** 「上次试摆结果」小卡：点一下展开大图，再点收起 */
function lastTryonCard(ctx, url) {
  const { el } = ctx.ui;
  const hint = el('div.tiny.muted', { text: '点一下看大图' });
  const img = el('img', {
    src: url,
    alt: '上次 AI 试摆结果',
    style: 'display:block;width:100%;height:132px;object-fit:cover;transition:height .3s;cursor:pointer;',
  });
  let big = false;
  img.addEventListener('click', () => {
    big = !big;
    img.style.height = big ? 'auto' : '132px';
    hint.textContent = big ? '再点一下收起' : '点一下看大图';
  });
  return el('div.card', {}, [
    el('div.card__body', { style: 'padding:14px 14px 12px;' }, [
      el('div.row.row--between', { style: 'margin-bottom:10px;' }, [
        el('div', { text: '上次的试摆结果', style: 'font-size:14px;letter-spacing:.08em;' }),
        hint,
      ]),
      img,
    ]),
  ]);
}

// ---------------------------------------------------------------- mount

export async function mount(root, ctx) {
  const { el, icon, axingHero } = ctx.ui;
  const cleanups = [];
  const addCleanup = (fn) => cleanups.push(fn);

  // 统一导航：走 ctx.go，并把地址栏 hash 同步成当前 view（app.js fromHash 认它，刷新可直入）
  const goView = (id) => {
    try {
      history.replaceState(null, '', `#${id}`);
    } catch { /* 隐私模式下忽略 */ }
    ctx.go(id);
  };

  const stack = el('div.stack');
  root.appendChild(stack);

  // ---------- hero：阿杏半身 + 问候 ----------
  stack.appendChild(el('div', {}, [
    el('div.ax-hero', {}, [
      axingHero(),
      el('div.ax-hero__text', {}, [
        el('h1.ax-hero__title', {}, ['你好，我是', el('em', { text: '阿杏' }), '～']),
        el('div.ax-hero__sub', { text: '银杏家具 · AI 家居导购助手' }),
      ]),
    ]),
    el('p.ax-hero__intro', {
      text: '我是提前把家具搬到你家的 AI 助手。把家具先搬进你家看看，再决定要不要。',
    }),
  ]));

  // ---------- 聊天时间线：预置两轮 + 监听新消息 ----------
  const timeline = el('div.ax-timeline');
  PRESET_CHAT.forEach((m) => timeline.appendChild(chatRow(ctx, m.role, m.text)));
  stack.appendChild(timeline);

  let typing = null;
  const scrollToEnd = () => {
    const views = document.getElementById('views');
    if (views) views.scrollTop = views.scrollHeight;
  };
  // 新消息 append 到末尾并滚到底，「阿杏正在想」占位气泡顺手撤掉
  addCleanup(ctx.on('chat:message', (m) => {
    if (typing) {
      typing.remove();
      typing = null;
    }
    const text = (m && m.text) || '';
    if (text) timeline.appendChild(chatRow(ctx, (m && m.role) || 'ai', text));
    scrollToEnd();
  }));
  addCleanup(ctx.on('chat:thinking', () => {
    if (typing) return;
    typing = typingRow(ctx);
    timeline.appendChild(typing);
    scrollToEnd();
  }));

  // ---------- 上传客厅照卡（第一 CTA，等 categories 回来后插入） ----------
  stack.appendChild(await uploadCard(ctx, goView));

  // ---------- 你可以这样问 + 四大功能 ----------
  stack.appendChild(askBlock(ctx));
  stack.appendChild(quickBlock(ctx, goView));

  // ---------- 上次试摆结果 ----------
  const tryonSlot = el('div');
  stack.appendChild(tryonSlot);
  const renderTryon = (url) => {
    tryonSlot.textContent = '';
    if (url) tryonSlot.appendChild(lastTryonCard(ctx, url));
  };
  renderTryon(ctx.state.lastTryonUrl);
  // 试摆完成后 state 写入 lastTryonUrl，这里补一张回看卡
  addCleanup(ctx.on('state:changed', (s) => {
    if (s.lastTryonUrl && !tryonSlot.firstChild) renderTryon(s.lastTryonUrl);
  }));

  // ---------- 门店兜底：打给店里是老人卡住时的最终解法，做成全宽主按钮 ----------
  const phone = icon('phone');
  phone.style.cssText = 'width:19px;height:19px;flex:0 0 auto;';
  stack.appendChild(el('div.stack.stack--sm', {}, [
    el('a.btn.btn--apricot.btn--block.btn--lg', {
      href: 'tel:13359140982',
      'aria-label': '打给店里 13359140982',
      style: 'text-decoration:none;min-height:48px;',
    }, [phone, '打给店里 13359140982']),
    el('p.tiny.muted.center', {
      text: '银杏家具体验店 · 柞水县乾佑街道农机路河西',
      style: 'line-height:1.8;',
    }),
  ]));

  return () => cleanups.forEach((fn) => {
    try {
      fn();
    } catch { /* 忽略清理异常 */ }
  });
}
