// view-home.js — 阿杏首页「聊天优先」单屏（视觉基准：docs/最新首页图.png）
// 结构（从上到下）：hero → 上传客厅照卡 → 上次试摆 → 四大功能 → 聊天时间线 → 你可以这样问（沉底）→ 打给店里
// 约定：export async function mount(root, ctx)，返回 cleanup；样式只取 css/axing.css + cards.css 的 .ax-* 类。
//
// 时间线不归本文件：聊天气泡由 app shell 级的 chat-core.js 持有（交互规范 §1-6 常驻对话），
// 这样顾客在任何页面发消息都能看到自己那条 + 阿杏回复，不会因为 view 卸载就丢了。
// 本文件只负责静态首屏结构，并在 hero 之后给 chat-core 一个挂载点。

/** 首条阿杏问候（参考图 docs/最新首页图.png 09:41 那条）。
 *  注意这跟 commit 438d831「首页不再摆预置的假对话」删掉的东西不是一回事：
 *  那次删的是预置的多轮假对话（让顾客以为已经有人在聊），单条 AI 问候是正常开场。
 *  老人需要这一句才知道该干什么。只放这一条，不放任何假用户消息。 */
const GREETING = '你好呀！我是阿杏～\n你可以上传一张你家的客厅照片，我会帮你把喜欢的家具搬进你家看看哦！';

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

/** 上传客厅照卡（首页第一 CTA）：整卡开上传浮窗，示例缩略图带品类直达。
 *  同步建壳、异步填图：卡本身不依赖任何请求，立即可点；图片和示例列由 fill() 回来后补。
 *  这样生产网络慢时首屏也不会缺第一 CTA，更不会把后面的 chips/四宫格一起堵住。
 *  §2-4：阿杏代言的卡片左边带头像，所以外面包一层 ui.axingCard。 */
function uploadCard(ctx, openUpload) {
  const { el, icon } = ctx.ui;

  const mainImg = roomImg(ctx, ROOM_FALLBACK, '示例客厅', '示例客厅');
  const main = el('figure.ax-ucard__main', {}, [
    mainImg,
    el('figcaption', { text: '示例客厅' }),
  ]);

  const grid = el('div.ax-samples__grid');
  const samples = el('div.ax-samples', { hidden: true }, [
    el('div.ax-samples__label', { text: '或者试试示例客厅' }),
    grid,
  ]);

  // css 没给 .ax-ucard__go svg 定尺寸，这里补 20px（否则 SVG 按 100% 撑爆布局）
  const chev = icon('chev');
  chev.style.cssText = 'width:20px;height:20px;display:block;';
  // 只放 body：标题行（相机图标 + 标题 + 副标题 + ›）由 axingCard 统一画，
  // 这里再画一遍就会重复出两个「上传客厅照片」（实测踩过）。
  // 点击/键盘可达性也由 axingCard 的 onClick 统一给，inner 自己不再绑——
  // 否则一次点击会冒泡成两次 openUpload。
  const inner = el('div.ax-ucard__inner', {}, [
    el('div.ax-ucard__body', {}, [main, samples]),
    el('div.ax-ucard__hint', { text: '尽量拍到完整的墙面、地面和主要空间，试摆效果会更准确。' }),
  ]);

  // 后台填图：取品类与商品，按「声明房间图 → 该品类在售商品图 → 通用客厅图」逐级探测，
  // 把主预览和示例格换成链上第一个真能加载的；和主预览撞成同一张的示例格不放。
  const fill = async () => {
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
    } catch { /* 接口挂就维持兜底图，卡照样能点 */ }

    // 数据债：示例房间图可能指向不存在的文件，所以不能只认声明图；
    // 也不能无脑退到通用图，否则会和主预览撞成同一张。
    const chainOf = (c) => {
      const hit = products.find((p) => p && p.category === c.id && p.image);
      return [c && c.defaultRoom, hit && hit.image, ROOM_FALLBACK].filter(Boolean);
    };
    const pickFirstOk = async (chain) => {
      for (const u of chain) if (await probeImage(u)) return u;
      return null;
    };

    const finalMain = (await pickFirstOk(cats.length ? chainOf(cats[0]) : [ROOM_FALLBACK])) || ROOM_FALLBACK;
    if (mainImg.getAttribute('src') !== finalMain) mainImg.src = finalMain;

    // 示例格先探测后建按钮：必然 404 的声明房间图若先渲染再换 src 会闪过一张破图、
    // 还白跑一次 404。探测完只给有真图的品类建格子，和主预览撞图的直接不放。
    const found = await Promise.all(cats.slice(1, 4).map(async (c) => ({
      c,
      url: await pickFirstOk(chainOf(c)),
    })));
    const btns = found
      .filter((x) => x.url && x.url !== finalMain)
      .map(({ c, url }) => el('button.ax-sample', {
        type: 'button',
        'aria-label': `用${c.room || ''}示例：${c.name || c.id}`,
        onclick: () => {
          ctx.setState({ sampleRoom: url, sampleCategoryId: c.id });
          openUpload();
        },
      }, [roomImg(ctx, url, c.name || c.id, c.name || c.id)]));
    grid.replaceChildren(...btns);
    samples.hidden = btns.length === 0;
  };

  // §2-4 起这张卡住进 axingCard 的头像卡里，但「这是一张卡」的语义钩子留在最外层：
  // axing-ui 的 A3/E1/F1/G1 与 Spec §70.1 都按 .ax-ucard 定位整张卡（含标题行），
  // 挂在 inner 上会让 .ax-ucard 的 innerText 丢失标题，那几条断言会假失败。
  const card = ctx.ui.axingCard({
    icon: 'camera',
    tone: 'apricot',
    title: '上传客厅照片',
    desc: '让阿杏提前把喜欢的家具为您搬回家～',
    trailing: el('div.ax-ucard__go', {}, [chev]),
    body: [inner],
    onClick: () => openUpload(),
  });
  card.classList.add('ax-ucard');
  const titleEl = card.querySelector('.ax-card-ava__title');
  if (titleEl) titleEl.classList.add('ax-ucard__title');   // 兼容既有 .ax-ucard__title 选择器

  return { card, fill };
}


// ---------------------------------------------------------------- 你可以这样问 / 四大功能

/** 「你可以这样问」：4 条一批，点 chip 以用户身份**真实发送**一条问答。
 *  以前这里只 ctx.appendChat('user', text)，等于只画个用户气泡就断了——
 *  顾客点了 chip 永远等不到阿杏回话（P3）。现在统一走 ctx.chat.send()，
 *  和 Composer 发送是同一条链路。 */
function askBlock(ctx) {
  const { el, icon } = ctx.ui;
  // ctx.chat 未就绪时退回 appendChat：首页至少还能把这句话显出来，不至于点了没反应
  const ask = (text) => (ctx.chat ? ctx.chat.send(text) : ctx.appendChat('user', text));
  const chip = (text) => el('button.chip', { type: 'button', text, onclick: () => ask(text) });
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
  // .ax-ask--bottom：交互规范 §1-7 样式一「沉在首页对话流最底部」
  return el('div.ax-ask--bottom', {}, [
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

/** 「上次试摆结果」小卡：点一下展开大图，再点收起。§2-4：带头像前缀。 */
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
  return ctx.ui.axingCard({
    title: '上次的试摆结果',
    body: [hint, img],
  });
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

  // ---------- 上传客厅照卡（第一 CTA）----------
  // uploadCard 同步建壳、异步填图：卡本身不依赖任何请求，立即可点；
  // 图片和示例列由 fill() 回来后补。这样生产 API 慢时首屏也不会缺这一块，
  // 更不会把后面的 chips / 四宫格一起堵住（曾经 await 它，首屏要等两个请求）。
  const openUpload = () => {
    if (typeof ctx.openUpload === 'function') ctx.openUpload();
    else goView('view-upload');   // app 壳还没注入 sheet 时的过渡兜底
  };
  const { card: ucard, fill: fillUcard } = uploadCard(ctx, openUpload);
  stack.appendChild(ucard);
  fillUcard().catch(() => {});

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

  // ---------- 四大功能（不依赖任何数据，立即渲染）----------
  stack.appendChild(quickBlock(ctx, goView));

  // ---------- 聊天时间线：归 app shell 的 chat-core 持有（交互规范 §1-6）----------
  // 位置有讲究：必须紧贴「你可以这样问」上方。chat-core 每来一条新消息就
  // views.scrollTop = views.scrollHeight，时间线若放在 hero 旁边，滚到底看到的是
  // 最底部的拨打按钮 + chips，最新那条气泡反而在屏幕外。贴着 Composer 长出来才对。
  // 消息本体和「正在想」占位都由 chat-core 管，本文件只提供挂载点；
  // 顾客在别的页面发消息时，chat-core.send() 会先切回 view-home 再 append，
  // 所以任何时候都不会出现「发了却看不到自己那条」（P2 修复）。
  const chatHost = el('div.ax-timeline');
  chatHost.id = 'chatHost';
  stack.appendChild(chatHost);

  if (ctx.chat && typeof ctx.chat.attachTimeline === 'function') {
    ctx.chat.attachTimeline(chatHost);
    addCleanup(() => ctx.chat.detachTimeline());
  }

  // 首条阿杏问候由 chat-core 在自己的消息数组里做首条（见 chat-core.js 的 GREETING），
  // attachTimeline 时会一起渲染出来，这里**不要再 append 一遍**（曾重复成两条）。
  // 只有 chat-core 缺失的降级路径才自己兜一条，保证老人永远看得到开场白。
  if (!(ctx.chat && typeof ctx.chat.attachTimeline === 'function')) {
    chatHost.appendChild(ctx.ui.axingSay(GREETING, { small: true }));
  }

  // ---------- 你可以这样问（沉底，交互规范 §1-7 样式一）----------
  stack.appendChild(askBlock(ctx));

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
