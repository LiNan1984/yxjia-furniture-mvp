// view-home.js — 阿杏首页：阿杏问候 hero + 4 大入口 + 次级横排入口 + 「上次试摆结果」回看卡。
// 约定：export async function mount(root, ctx)，可 return cleanup 函数。
// 视觉对齐 src/axing/css/axing.css（奢华极简：杏色 #E8B27D 仅作强调）。

const TIPS = [
  '想要布艺沙发，三千左右，放我家客厅看看',
  '家有小孩也有猫，选什么面料好打理？',
  '客厅三米五，想摆个转角沙发，放得下吗？',
];

/** 大入口卡（≥64px 可点区域，主卡杏色填充） */
function entryCard(ctx, { icon, title, desc, primary, onclick }) {
  const { el } = ctx.ui;
  return el('button.card', {
    type: 'button',
    style: 'width:100%;display:block;text-align:left;min-height:76px;touch-action:manipulation;' +
      (primary ? 'background:var(--c-apricot);border-color:var(--c-apricot);' : ''),
    onclick,
  }, [
    el('div.card__body.row', { style: 'align-items:center;gap:14px;' }, [
      el('div', {
        style: 'width:46px;height:46px;border-radius:50%;flex:0 0 auto;display:flex;align-items:center;' +
          'justify-content:center;font-size:22px;background:rgba(232,178,125,.22);',
        text: icon,
      }),
      el('div.grow', {}, [
        el('div', { text: title, style: 'font-size:15px;letter-spacing:.08em;' }),
        el('div.tiny.muted', { text: desc, style: 'margin-top:2px;line-height:1.6;' }),
      ]),
      el('div.muted', { text: '›', style: 'font-size:24px;font-weight:200;line-height:1;' }),
    ]),
  ]);
}

/** 阿杏 tip 气泡：自动轮播 + 点一下换一句 */
function tipBubble(ctx, addCleanup) {
  const { el, avatar } = ctx.ui;
  let idx = Math.floor(Math.random() * TIPS.length);
  const text = el('div.ax-bubble.grow', { text: TIPS[idx] });
  text.style.cursor = 'pointer';
  text.style.minHeight = '44px';
  const hint = el('div.tiny.muted', { text: `可以这样跟阿杏说 · ${idx + 1}/${TIPS.length}` });
  const next = () => {
    idx = (idx + 1) % TIPS.length;
    text.textContent = TIPS[idx];
    hint.textContent = `可以这样跟阿杏说 · ${idx + 1}/${TIPS.length}`;
  };
  text.addEventListener('click', next);
  const timer = setInterval(next, 6000);
  addCleanup(() => clearInterval(timer));
  return el('div.ax-row', {}, [
    avatar('sm'),
    el('div.grow', { style: 'display:flex;flex-direction:column;gap:6px;min-width:0;' }, [text, hint]),
  ]);
}

/** 「上次试摆结果」小卡：点一下展开大图，再点收起 */
function lastTryonCard(ctx, url, addCleanup) {
  const { el } = ctx.ui;
  const img = el('img', {
    src: url,
    alt: '上次 AI 试摆结果',
    style: 'display:block;width:100%;height:132px;object-fit:cover;transition:height .3s;',
  });
  let big = false;
  const toggle = () => {
    big = !big;
    img.style.height = big ? 'auto' : '132px';
    hint.textContent = big ? '再点一下收起' : '点一下看大图';
  };
  img.addEventListener('click', toggle);
  const hint = el('div.tiny.muted', { text: '点一下看大图' });
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

export async function mount(root, ctx) {
  const { el, axingSay, avatar } = ctx.ui;
  const cleanups = [];
  const addCleanup = (fn) => cleanups.push(fn);

  const stack = el('div.stack');
  root.appendChild(stack);

  // ---------- hero ----------
  stack.appendChild(el('div.card', { style: 'box-shadow:var(--shadow-lux);' }, [
    el('div.card__body.stack', {}, [
      el('div.row', {}, [
        avatar('lg'),
        el('div.grow', {}, [
          el('h1.sec-title', { text: '你好，我是阿杏～', style: 'font-size:21px;margin:2px 0 4px;' }),
          el('div.tiny.muted', { text: '银杏家具 · AI 家居导购助手' }),
        ]),
      ]),
      el('p.sec-desc', {
        text: '我是提前把家具搬到你家的 AI 助手。把家具先搬进你家看看，再决定要不要。',
        style: 'margin:2px 0 0;line-height:1.8;',
      }),
      tipBubble(ctx, addCleanup),
    ]),
  ]));

  // ---------- 4 大入口 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: 'START HERE' }),
    el('div.stack.stack--sm', {}, [
      entryCard(ctx, {
        icon: '📷', title: '拍照试摆', desc: '拍一张客厅照，家具先摆进你家看看',
        primary: true,
        onclick: () => ctx.go('view-upload'),
      }),
      entryCard(ctx, {
        icon: '🎤', title: '语音导购', desc: '按着话筒说话，阿杏用话跟你聊',
        onclick: () => ctx.go('view-voice'),
      }),
      entryCard(ctx, {
        icon: '🛋', title: '浏览家具', desc: '店里在售的沙发、床、柜子、茶几',
        onclick: () => ctx.go('view-products'),
      }),
      entryCard(ctx, {
        icon: '✨', title: '我的方案', desc: '看过的、选中的家具都收在这儿',
        onclick: () => ctx.go('view-plans'),
      }),
    ]),
  ]));

  // ---------- 次级横排 ----------
  stack.appendChild(el('div', {}, [
    el('p.sec-eyebrow', { text: '还有这些' }),
    el('div.chip-row', {}, [
      el('button.chip', { type: 'button', text: '3D 看家具', onclick: () => ctx.go('view-3d') }),
      el('button.chip', { type: 'button', text: '材质科普', onclick: () => ctx.go('view-material') }),
      el('button.chip', { type: 'button', text: '预约到店', onclick: () => ctx.go('view-booking') }),
    ]),
  ]));

  // ---------- 上次试摆结果 ----------
  const tryonSlot = el('div');
  stack.appendChild(tryonSlot);

  function renderTryon(url) {
    tryonSlot.textContent = '';
    if (!url) return;
    tryonSlot.appendChild(el('div', {}, [el('p.sec-eyebrow', { text: 'LAST TIME' })]));
    tryonSlot.appendChild(lastTryonCard(ctx, url, addCleanup));
  }
  renderTryon(ctx.state.lastTryonUrl);

  // 试摆完成后 state 里会写入 lastTryonUrl，这里补一张回看卡
  const off = ctx.on('state:changed', (s) => {
    if (s.lastTryonUrl && !tryonSlot.firstChild) renderTryon(s.lastTryonUrl);
  });
  addCleanup(off);

  // ---------- 门店一句话 ----------
  stack.appendChild(el('p.tiny.muted.center', {
    text: '银杏家具体验店 · 柞水县乾佑街道农机路河西 · 13359140982',
    style: 'padding-top:4px;line-height:1.8;',
  }));

  return () => cleanups.forEach((fn) => { try { fn(); } catch { /* 忽略清理异常 */ } });
}
