// view-products.js — 阿杏 · 挑选家具
// 约定：mount(root, ctx) 首次切到该 view 时调用一次，可返回 cleanup。
// 数据只来自 ctx.api / ctx.ui / ctx.state；不碰壳代码与别人的 view 文件。
//
// 页面：搜索 + 品类筛选 + 价格上限 + 商品网格（就地展开详情）+ 选中后的大入口。

const CAT_LABEL = { sofa: '沙发', bed: '床', cabinet: '柜子', table: '桌几' };
const CAT_ORDER = ['sofa', 'bed', 'cabinet', 'table'];

/** app.js 目前把 api.js 的命名空间（{ ApiError, api }）注入 ctx.api，
 *  这里兼容「包装器」和「命名空间」两种形状，壳改回去也不用动 view。 */
function resolveApi(ctx) {
  const a = (ctx && ctx.api) || {};
  const wrapped = a.api;
  if (wrapped && typeof wrapped === 'object' && typeof wrapped.products === 'function') return wrapped;
  return typeof a.products === 'function' ? a : wrapped || a;
}

export async function mount(root, ctx) {
  const { el, skeleton, productCard, parsePrice, priceText } = ctx.ui;
  const api = resolveApi(ctx);

  // ---------- 本地筛选状态 ----------
  /** @type {any[]} */
  let all = [];
  let openId = null;        // 就地展开详情的商品 id
  let cat = 'all';          // 当前品类
  let maxPrice = null;      // 价格上限（null = 不限）；解析不出价格的品始终显示

  // ---------- 工具 ----------
  // 老人友好：把卡片内按钮撑到 ≥44px 可点高度（只加行内样式，不改共享 css）
  const bumpTouch = (node) => node.querySelectorAll('button').forEach((b) => {
    b.style.minHeight = '44px';
  });

  const specRow = (label, value) =>
    el('div.spec-row', {}, [el('span', { text: label }), el('span', { text: value })]);

  const skeletonCard = () => el('div.p-card', {}, [
    el('div.p-card__img', {}, [skeleton('position:absolute;inset:0;')]),
    el('div.p-card__body', {}, [
      skeleton('height:14px;width:82%;border-radius:4px;'),
      skeleton('height:11px;width:56%;border-radius:4px;'),
      skeleton('height:18px;width:42%;border-radius:4px;'),
    ]),
  ]);

  // ---------- 页面骨架 ----------
  root.appendChild(el('p.sec-eyebrow', { text: 'STEP 01 · 先看看店里的' }));
  root.appendChild(el('h2.sec-title', { text: '挑一件搬进你家' }));
  root.appendChild(el('p.sec-desc', {
    text: '都是店里现货。看中了点「选它」，再拍张客厅照，我帮你摆进去看看。',
  }));

  const kwInput = el('input', {
    type: 'search', placeholder: '搜一下：布艺沙发、电视柜…', autocomplete: 'off',
  });
  kwInput.setAttribute('aria-label', '搜索家具');
  root.appendChild(el('label.field', {}, [el('span', { text: '找一找' }), kwInput]));

  const catRow = el('div.chip-row');
  root.appendChild(catRow);

  const priceLabel = el('span.tiny.muted', { text: '价格上限：不限' });
  const priceRange = el('input', { type: 'range', min: '0', max: '10000', step: '500', value: '10000' });
  priceRange.setAttribute('aria-label', '价格上限');
  priceRange.style.cssText = 'width:100%;min-height:44px;';
  root.appendChild(el('div.field', {}, [priceLabel, priceRange]));

  const statusLine = el('p.tiny.muted', { text: '' });
  const grid = el('div.p-grid');
  const loadingBox = el('div.p-grid');
  for (let i = 0; i < 6; i += 1) loadingBox.appendChild(skeletonCard());
  const emptyBox = el('div.empty', { text: '没有符合条件的家具，换个条件试试。', hidden: true });

  root.appendChild(statusLine);
  root.appendChild(loadingBox);
  root.appendChild(grid);
  root.appendChild(emptyBox);

  // 选中商品后浮出的大入口
  const actionBar = el('div.card', { hidden: true, style: 'margin-top:16px;' });
  const actionBody = el('div.card__body');
  actionBar.appendChild(actionBody);
  root.appendChild(actionBar);

  // ---------- 筛选逻辑 ----------
  function visible() {
    const kw = (kwInput.value || '').trim().toLowerCase();
    return all.filter((p) => {
      if (cat !== 'all' && p.category !== cat) return false;
      const price = parsePrice(p.price);
      if (price != null && maxPrice != null && price > maxPrice) return false;
      if (kw) {
        const hay = [p.name, p.subtitle, p.description].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }

  function buildCats() {
    const present = CAT_ORDER.filter((c) => all.some((p) => p.category === c));
    catRow.replaceChildren(...[
      { id: 'all', name: `全部 ${all.length}` },
      ...present.map((c) => ({ id: c, name: CAT_LABEL[c] || c })),
    ].map((c) => {
      const b = el('button.chip', { text: c.name });
      b.style.minHeight = '40px';
      b.addEventListener('click', () => {
        cat = c.id;
        paintCats();
        render();
      });
      b.dataset.cat = c.id;
      return b;
    }));
    paintCats();
  }

  function paintCats() {
    catRow.querySelectorAll('button').forEach((b) => {
      b.className = `chip${b.dataset.cat === cat ? ' active' : ''}`;
    });
  }

  function paintPrice() {
    priceLabel.textContent = maxPrice == null ? '价格上限：不限' : `价格上限：¥${maxPrice} 以下`;
  }

  function detailPanel(p) {
    const box = el('div.card', { style: 'grid-column:1/-1;' });
    const body = el('div.card__body');
    body.appendChild(el('h3', { text: p.name, style: 'font-size:18px;font-weight:300;margin:0 0 4px;' }));
    if (p.subtitle) body.appendChild(el('p.tiny.muted', { text: p.subtitle, style: 'margin:0 0 10px;' }));
    body.appendChild(el('div', {}, [
      specRow('品类', CAT_LABEL[p.category] || p.category || '家具'),
      specRow('材质 / 面料', p.material || p.subtitle || '到店看实物更准'),
      specRow('尺寸', p.size || '到店量尺'),
      specRow('库存', p.stock || '现货'),
      specRow('价格', priceText(p.price)),
    ]));
    if (p.description) {
      body.appendChild(el('p', { text: p.description, style: 'font-size:13px;color:var(--c-gray);margin:12px 0 0;' }));
    }
    const hl = (p.highlights || []).filter(Boolean);
    if (hl.length) {
      body.appendChild(el('p.tiny.muted', { text: '亮点', style: 'margin:14px 0 6px;letter-spacing:.24em;' }));
      body.appendChild(el('div.stack--sm', {}, hl.map((h) => el('div', { text: `· ${h}` }))));
    }
    body.appendChild(el('div.stack--sm', { style: 'margin-top:16px;' }, [
      el('button.btn.btn--apricot.btn--lg.btn--block', {
        text: '📷 拍客厅照试摆',
        onclick: () => ctx.go('view-upload'),
      }),
      el('button.btn.btn--lg.btn--block', {
        text: '◍ 3D 看看',
        onclick: () => ctx.go('view-3d'),
      }),
    ]));
    box.appendChild(body);
    return box;
  }

  function render() {
    const list = visible();
    statusLine.textContent = list.length ? `找到 ${list.length} 件，点「选它」就能试摆` : '';
    emptyBox.hidden = list.length > 0;
    emptyBox.textContent = all.length ? '没有符合条件的家具，换个条件试试。' : '商品还没读出来，稍等一下再试。';

    const cards = new Map();
    const nodes = list.map((p) => {
      const card = productCard(p, {
        onDetail: () => {
          openId = openId === p.id ? null : p.id;
          render();
        },
        onPick: () => pick(p),
      });
      bumpTouch(card);
      cards.set(p.id, card);
      return card;
    });
    grid.replaceChildren(...nodes);

    const open = openId ? all.find((p) => p.id === openId) : null;
    if (open && list.includes(open)) {
      const panel = detailPanel(open);
      const anchor = cards.get(open.id);
      if (anchor) anchor.after(panel); else grid.appendChild(panel);
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function pick(p) {
    ctx.pickProduct(p);
    ctx.toast(`已选：${p.name}`);
    updateActionBar();
    actionBar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateActionBar() {
    const s = ctx.state;
    if (!s.productId) {
      actionBar.hidden = true;
      return;
    }
    actionBar.hidden = false;
    actionBody.replaceChildren(
      el('p.tiny.muted', { text: '已选好了', style: 'margin:0 0 6px;letter-spacing:.24em;' }),
      el('div.row--between', {}, [
        el('strong', { text: s.productName || '已选商品', style: 'font-weight:400;' }),
        el('span', { text: priceText(s.productPrice), style: 'color:var(--c-apricot-deep);' }),
      ]),
      el('div.stack--sm', { style: 'margin-top:12px;' }, [
        el('button.btn.btn--apricot.btn--lg.btn--block', {
          text: '📷 拍客厅照试摆',
          onclick: () => ctx.go('view-upload'),
        }),
        el('button.btn.btn--lg.btn--block', {
          text: '◍ 3D 看看',
          onclick: () => ctx.go('view-3d'),
        }),
      ]),
    );
  }

  // ---------- 事件 ----------
  kwInput.addEventListener('input', render);
  kwInput.addEventListener('search', render);
  priceRange.addEventListener('input', () => {
    const v = Number(priceRange.value);
    maxPrice = v >= Number(priceRange.max) ? null : v;
    paintPrice();
    render();
  });
  const offSelected = ctx.on('product:selected', updateActionBar);
  const offState = ctx.on('state:changed', () => updateActionBar());

  // ---------- 首屏数据 ----------
  try {
    const data = await api.products();
    all = ((data && data.products) || []).filter((p) => (p.status || '在售') !== '下架');
  } catch (err) {
    all = [];
    ctx.toast(ctx.humanError(err));
  }
  loadingBox.remove();

  const prices = all.map((p) => parsePrice(p.price)).filter((n) => n != null);
  if (prices.length) {
    maxPrice = null;
    const top = Math.ceil(Math.max(...prices) / 1000) * 1000;
    priceRange.setAttribute('max', String(top));
    priceRange.value = String(top);
    priceRange.setAttribute('step', String(top > 6000 ? 1000 : 500));
  } else {
    priceRange.closest('.field').hidden = true;
  }
  paintPrice();
  buildCats();
  render();
  updateActionBar();

  return () => { offSelected(); offState(); };
}
