// view-3d：3D 看家具（three.js 舞台）
// 契约依赖 ./three-viewer.js + ./furniture.js（裸导入 'three'，importmap 见 index.html）
import { createViewer } from './three-viewer.js';
import { COLOR_SWATCHES, MATERIALS, furnitureKinds } from './furniture.js';

const KIND_FALLBACK_DIMS = {
  sofa3: { width: 2.2, depth: 0.95, height: 0.85 },
  sofaL: { width: 3.2, depth: 1.8, height: 0.85 },
  sofaSingle: { width: 1.1, depth: 0.95, height: 0.85 },
  coffee: { width: 1.2, depth: 0.6, height: 0.45 },
  tvCabinet: { width: 2.0, depth: 0.45, height: 0.5 },
  bed: { width: 1.8, depth: 2.0, height: 0.55 },
};

export async function mount(root, ctx) {
  const ui = ctx.ui;
  const { el: h } = ui;
  let product0 = ctx.state.productId
    ? (await ctx.api.product(ctx.state.productId).catch(() => null))?.product || null
    : null;

  function kindFromProduct(p) {
    if (!p) return 'sofa3';
    const name = `${p.name || ''} ${p.subtitle || ''}`;
    if (p.category === 'bed') return 'bed';
    if (p.category === 'cabinet') return 'tvCabinet';
    if (p.category === 'table') return 'coffee';
    if (/转角|L\s*形|L形/i.test(name)) return 'sofaL';
    if (/单人/.test(name)) return 'sofaSingle';
    return 'sofa3';
  }
  // "3.2 米 × 1.8 米" → { width, depth }（height 用家具默认）
  function dimsFromProduct(p, kind) {
    const base = { ...KIND_FALLBACK_DIMS[kind] } || { width: 2.2, depth: 0.95, height: 0.85 };
    if (!p || !p.size) return base;
    const m = String(p.size).match(/([\d.]+)\s*[米m]\s*[×xX\*]\s*([\d.]+)/);
    if (!m) return base;
    const width = parseFloat(m[1]);
    const depth = parseFloat(m[2]);
    if (!width || !depth || width > 8 || depth > 8) return base;
    return { width, depth, height: base.height };
  }

  const kinds = furnitureKinds();
  const kindMeta = (id) => kinds.find((k) => k.id === id) || { id, name: id, dims: KIND_FALLBACK_DIMS[id] };

  let kind = kindFromProduct(product0);
  let dims = dimsFromProduct(product0, kind);
  let color = COLOR_SWATCHES[0].hex;
  let materialId = MATERIALS[0].id;
  let autoRotate = true;
  let viewer = null;

  // ---------- 结构 ----------
  root.appendChild(h('p.sec-eyebrow', { text: '3D SHOWROOM' }));
  root.appendChild(h('h2.sec-title', { text: '3D 看家具' }));
  root.appendChild(h('p.sec-desc', { text: '转一圈、换个颜色材质，细节看清楚再决定。' }));

  const stage = h('div.stage');
  const hint = h('div.stage__hint.stack.stack--sm', {}, [h('div', { text: '3D 加载中…' })]);
  stage.appendChild(hint);
  root.appendChild(stage);

  const infoName = h('strong');
  const infoDims = h('span.muted.tiny');
  root.appendChild(h('div.card', { style: 'margin-top:16px;' }, [
    h('div.card__body.stack.stack--sm', {}, [
      h('div.row.row--between', {}, [h('span.muted.tiny', { text: '当前家具' }), infoName]),
      h('div.row.row--between', {}, [h('span.muted.tiny', { text: '实测尺寸（米）' }), infoDims]),
    ]),
  ]));

  const kindRow = h('div.chip-row', { style: 'margin-top:12px;' });
  kinds.forEach((k) => {
    const chip = h('button.chip', { text: k.name });
    chip.dataset.kind = k.id;
    chip.addEventListener('click', () => selectKind(k.id));
    kindRow.appendChild(chip);
  });
  root.appendChild(h('p.sec-eyebrow', { text: '款式', style: 'margin-top:20px;' }));
  root.appendChild(kindRow);

  const swatchRow = h('div.swatches', { style: 'margin-top:12px;' });
  COLOR_SWATCHES.forEach((c) => {
    const b = h('button.swatch', { title: c.name, 'aria-label': c.name });
    b.style.background = c.hex;
    b.dataset.hex = c.hex;
    b.addEventListener('click', () => selectColor(c.hex));
    swatchRow.appendChild(b);
  });
  root.appendChild(h('p.sec-eyebrow', { text: '颜色', style: 'margin-top:20px;' }));
  root.appendChild(swatchRow);

  const matRow = h('div.chip-row', { style: 'margin-top:12px;' });
  MATERIALS.forEach((m) => {
    const chip = h('button.chip', { text: m.name });
    chip.dataset.material = m.id;
    chip.addEventListener('click', () => selectMaterial(m.id));
    matRow.appendChild(chip);
  });
  root.appendChild(h('p.sec-eyebrow', { text: '材质', style: 'margin-top:20px;' }));
  root.appendChild(matRow);

  const rotateBtn = h('button.btn.btn--ghost.grow', { text: '自动旋转：开' });
  rotateBtn.addEventListener('click', () => {
    autoRotate = !autoRotate;
    if (viewer) viewer.setAutoRotate(autoRotate);
    rotateBtn.textContent = `自动旋转：${autoRotate ? '开' : '关'}`;
  });
  const resetBtn = h('button.btn.btn--ghost.grow', { text: '复位视角' });
  resetBtn.addEventListener('click', () => viewer && viewer.reset());
  const shotBtn = h('button.btn.btn--ghost.btn--block', { text: '⬇ 保存这张图' });
  shotBtn.addEventListener('click', () => {
    if (!viewer) { ctx.toast('3D 还没准备好'); return; }
    const url = viewer.screenshot();
    if (!url) { ctx.toast('截图失败了，再试一次'); return; }
    const a = h('a', { href: url, download: '阿杏-3D看家具.png' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    ctx.toast('图已保存');
  });
  const addSceneBtn = h('button.btn.btn--apricot.btn--block.btn--lg', { text: '✧ 把我选的加进方案' });
  addSceneBtn.addEventListener('click', async () => {
    if (!ctx.state.productId) { ctx.toast('先在上一步选一件家具'); return; }
    addSceneBtn.disabled = true;
    addSceneBtn.textContent = '保存中…';
    try {
      await ctx.api.saveScene({
        name: `我的家 · ${new Date().toLocaleDateString('zh-CN')}`,
        phone: ctx.state.phone,
        items: [{
          productId: ctx.state.productId,
          color: (COLOR_SWATCHES.find((c) => c.hex === color) || {}).id || null,
          materialId,
          dims,
        }],
      });
      ctx.toast('已加进「我的方案」');
      ctx.emit('plan:changed');
    } catch (err) {
      ctx.toast(ctx.humanError(err));
    } finally {
      addSceneBtn.disabled = false;
      addSceneBtn.textContent = '✧ 把我选的加进方案';
    }
  });
  root.appendChild(h('div.stack.stack--sm', { style: 'margin-top:24px;' }, [
    addSceneBtn,
    h('div.row', {}, [rotateBtn, resetBtn]),
    shotBtn,
  ]));

  // ---------- 交互 ----------
  function selectKind(k) {
    kind = k;
    dims = { ...kindMeta(k).dims };
    if (viewer) viewer.setFurniture(kind, dims);
    syncChips();
    syncInfo();
  }
  function selectColor(hex) {
    color = hex;
    if (viewer) viewer.setColor(hex);
    syncChips();
    ctx.emit('scene:style', { color, materialId });
  }
  function selectMaterial(id) {
    materialId = id;
    if (viewer) viewer.setMaterial(id);
    syncChips();
    ctx.emit('scene:style', { color, materialId });
  }
  function syncChips() {
    ui.$$('.chip[data-kind]', root).forEach((c) => c.classList.toggle('active', c.dataset.kind === kind));
    ui.$$('.swatch', root).forEach((s) => s.classList.toggle('active', s.dataset.hex === color));
    ui.$$('.chip[data-material]', root).forEach((c) => c.classList.toggle('active', c.dataset.material === materialId));
  }
  function syncInfo() {
    infoName.textContent = (product0 && kindFromProduct(product0) === kind && product0.name) || kindMeta(kind).name;
    infoDims.textContent = `${dims.width.toFixed(1)} × ${dims.depth.toFixed(1)} × ${dims.height.toFixed(1)}`;
  }

  // 商品页选了新家具后，3D 台跟着换
  const offProduct = ctx.on('product:selected', (p) => {
    product0 = p;
    selectKind(kindFromProduct(p));
    dims = dimsFromProduct(p, kind);
    if (viewer) viewer.setFurniture(kind, dims);
    syncInfo();
  });

  syncChips();
  syncInfo();

  // ---------- 3D 初始化（WebGL 失败给图片兜底） ----------
  const fallbackToImage = () => {
    hint.innerHTML = '';
    hint.appendChild(h('div', { text: '这台设备看不了 3D' }));
    hint.appendChild(h('div.tiny', { text: '先看看照片，到店摸实物' }));
    if (product0 && product0.image) {
      hint.appendChild(h('img', {
        src: product0.image, alt: product0.name || '家具图',
        style: 'max-height:56%;border-radius:8px;',
      }));
    }
  };
  try {
    viewer = createViewer(stage, { background: '#F7F4EF', onError: fallbackToImage });
    if (viewer) {
      viewer.setFurniture(kind, dims);
      viewer.setColor(color);
      viewer.setMaterial(materialId);
      viewer.setAutoRotate(autoRotate);
      if (typeof viewer.getFaceCount === 'function' && viewer.getFaceCount() > 60000) {
        console.warn('[axing][3d] 面数偏高', viewer.getFaceCount());
      }
      hint.remove();
    }
  } catch (err) {
    console.error('[axing][3d] viewer init failed', err);
    fallbackToImage();
  }

  return () => {
    offProduct();
    if (viewer) { try { viewer.dispose(); } catch { /* already */ } }
    viewer = null;
  };
}
