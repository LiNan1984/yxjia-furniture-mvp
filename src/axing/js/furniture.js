/**
 * 阿杏 AI 家居助手 · 家具几何库
 * 纯参数化生成，无外部资源；所有尺寸单位为米。
 * 约定：可换色部件 mesh.userData.paintable = true，固定色部件（木腿/金属件）为 false。
 */
import * as THREE from 'three';

export const COLOR_SWATCHES = [
  { id: 'ivory', name: '杏白', hex: '#EDE3D2' },
  { id: 'cream', name: '奶油', hex: '#F2E6D8' },
  { id: 'greige', name: '浅灰', hex: '#C9C2B8' },
  { id: 'rust', name: '焦糖', hex: '#A9683C' },
  { id: 'sage', name: '鼠尾草绿', hex: '#9BA88E' },
  { id: 'navy', name: '雾霾蓝', hex: '#5E7183' },
  { id: 'charcoal', name: '炭黑', hex: '#3A3835' },
];

export const MATERIALS = [
  { id: 'fabric', name: '布艺', roughness: 0.92, metalness: 0.0, sheen: 0.4 },
  { id: 'leather', name: '真皮', roughness: 0.45, metalness: 0.0, sheen: 0.8 },
  { id: 'tech', name: '科技布', roughness: 0.6, metalness: 0.0, sheen: 0.2 },
  { id: 'wood', name: '实木', roughness: 0.55, metalness: 0.0, sheen: 0.0 },
];

/** 户型目录：dims 为该品类的默认真实尺寸（米） */
const KINDS = [
  { id: 'sofa3', name: '三人沙发', dims: { width: 2.2, depth: 0.95, height: 0.85 } },
  { id: 'sofaL', name: 'L 型沙发', dims: { width: 2.6, depth: 1.65, height: 0.85 } },
  { id: 'sofaSingle', name: '单人沙发', dims: { width: 0.85, depth: 0.85, height: 0.8 } },
  { id: 'coffee', name: '茶几', dims: { width: 1.2, depth: 0.6, height: 0.42 } },
  { id: 'tvCabinet', name: '电视柜', dims: { width: 1.8, depth: 0.4, height: 0.5 } },
  { id: 'bed', name: '双人床', dims: { width: 1.8, depth: 2.0, height: 0.95 } },
];

const WOOD_HEX = '#8A6A4A';   // 木腿固定色
const METAL_HEX = '#3A2818';  // 金属件固定深咖
const CLOTH_HEX = '#F2E6D8';  // 枕头等固定软装

const MIN_EDGE = 0.15;
const MAX_EDGE = 8;

/** 尺寸兜底：非法/缺省时回落到该品类默认尺寸，避免退化成 1m 立方体 */
function clampDim(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(MAX_EDGE, Math.max(MIN_EDGE, n));
}

function materialSpec(materialId) {
  return MATERIALS.find((m) => m.id === materialId) || MATERIALS[0];
}

function isValidColor(hex) {
  return typeof hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex.trim());
}

/* ------------------------------------------------------------------ 纹理 */

const TEX_CACHE = new Map();

// node 侧冒烟没有 document，纹理只能懒生成
function hasCanvas() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function makeCanvasTexture(paint, repeat) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  paint(g, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // ExtrudeGeometry 默认 UV 就是「米」，所以 repeat 直接等价于 每多少米一循环
  tex.repeat.set(repeat, repeat);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function paintWeave(g, S) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  for (let p = 0; p < S; p += 8) {
    g.fillStyle = 'rgba(40,32,24,0.060)';
    g.fillRect(0, p, S, 4);
    g.fillRect(p, 0, 4, S);
    g.fillStyle = 'rgba(255,255,255,0.30)';
    g.fillRect(0, p + 4, S, 4);
    g.fillRect(p + 4, 0, 4, S);
  }
}

// 科技布：更细的编织格
function paintTech(g, S) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  for (let p = 0; p < S; p += 4) {
    g.fillStyle = 'rgba(40,32,24,0.050)';
    g.fillRect(0, p, S, 2);
    g.fillRect(p, 0, 2, S);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(0, p + 2, S, 2);
    g.fillRect(p + 2, 0, 2, S);
  }
}

function paintWood(g, S) {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 2) {
    const wave = Math.sin(y * 0.35) * 0.5 + Math.sin(y * 0.11 + 1.3) * 0.5;
    const a = 0.04 + 0.05 * (wave * 0.5 + 0.5);
    g.fillStyle = `rgba(58,44,32,${a.toFixed(3)})`;
    g.fillRect(0, y, S, 2);
  }
  g.fillStyle = '#3a2818';
  g.globalAlpha = 0.1;
  for (const [kx, ky, kr] of [[72, 58, 11], [158, 182, 15], [38, 214, 8]]) {
    g.beginPath();
    g.ellipse(kx, ky, kr, kr * 0.45, 0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

const PAINTERS = { fabric: paintWeave, tech: paintTech, wood: paintWood };
const TEX_REPEAT = { fabric: 1, tech: 1, wood: 0.45 };

/**
 * 取材质对应的程序化纹理；真皮光滑无织纹，返回 null。
 * viewer 切换材质时直接用它增删 material.map。
 */
export function textureFor(materialId) {
  const id = materialSpec(materialId).id;
  if (id === 'leather') return null;
  if (TEX_CACHE.has(id)) return TEX_CACHE.get(id);
  let tex = null;
  try {
    if (hasCanvas()) tex = makeCanvasTexture(PAINTERS[id], TEX_REPEAT[id]);
  } catch (err) {
    tex = null; // canvas 不可用时降级为纯色
  }
  TEX_CACHE.set(id, tex);
  return tex;
}

/** viewer.dispose() 时调用：释放模块级纹理缓存 */
export function disposeSharedAssets() {
  for (const tex of TEX_CACHE.values()) tex && tex.dispose && tex.dispose();
  TEX_CACHE.clear();
}

/* ------------------------------------------------------------------ 几何 */

/**
 * 圆角盒：rounded-rect Shape 沿 Z 挤出 + 端面倒角。
 * 注意 ExtrudeGeometry 的 bevel 会把轮廓向外扩出 2×bevelSize，所以先把形状缩回去，
 * 成品才刚好等于 w×h×d；Z 方向按 depth/2 居中。
 * 比 RoundedBoxGeometry 省三角面（<200 tri/件），UV 直接是米制、可平铺。
 */
function roundedBox(w, h, d, radius = 0.025, curveSegments = 4) {
  const bevel = Math.max(0.003, Math.min(0.012, radius * 0.5, w / 4, h / 4, d / 4));
  const sw = Math.max(w - bevel * 2, 0.004);
  const sh = Math.max(h - bevel * 2, 0.004);
  const depth = Math.max(d - bevel * 2, 0.004);
  const r = Math.min(radius, sw / 2 - 1e-4, sh / 2 - 1e-4);
  const hw = sw / 2;
  const hh = sh / 2;
  const shape = new THREE.Shape();
  if (r > 1e-3) {
    shape.moveTo(-hw + r, -hh);
    shape.lineTo(hw - r, -hh);
    shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
    shape.lineTo(hw, hh - r);
    shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
    shape.lineTo(-hw + r, hh);
    shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
    shape.lineTo(-hw, -hh + r);
    shape.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  } else {
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 1,
    curveSegments,
    steps: 1,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function addBox(parent, mat, w, h, d, x, y, z, paintable, radius) {
  const geo = radius > 0 ? roundedBox(w, h, d, radius) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.paintable = paintable === true;
  parent.add(m);
  return m;
}

/** 沿 X 或 Z 的圆柱拉手/横杆 */
function addBar(parent, mat, len, radius, x, y, z, axis) {
  const g = new THREE.CylinderGeometry(radius, radius, len, 12, 1);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  m.userData.paintable = false;
  parent.add(m);
  return m;
}

function addLeg(parent, mat, x, z, height, rTop, rBottom) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, height, 12, 1), mat);
  m.position.set(x, height / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.paintable = false;
  parent.add(m);
  return m;
}

/* ------------------------------------------------------------------ 沙发 */

// 比例全部由 w/d/h 推导：座面约在总高一半偏上，靠背到顶，改尺寸不成散架
function sofaFrame(g, c, seats) {
  const w = c.w;
  const d = c.d;
  const h = c.h;
  const legH = Math.min(0.09, h * 0.13);
  const seatTop = h * 0.53;                 // 座垫顶面 ≈0.45m，符合真实沙发座高
  const backTop = h;
  const armW = Math.max(0.085, Math.min(0.17, w * 0.08));
  const innerW = w - armW * 2;
  const R = 0.035;

  // 底盘（占满标称进深）
  const deckH = Math.max(0.1, seatTop - legH - 0.15);
  addBox(g, c.body, innerW, deckH, d, 0, legH + deckH / 2, 0, true, R);

  // 扶手（略高于座面，包住座垫）
  const armH = seatTop + 0.06 - legH;
  addBox(g, c.body, armW, armH, d, -(innerW / 2 + armW / 2), legH + armH / 2, 0, true, R);
  addBox(g, c.body, armW, armH, d, innerW / 2 + armW / 2, legH + armH / 2, 0, true, R);

  // 座垫：按位数分开，中间留缝才看得出是几个位
  const gap = Math.min(0.03, innerW / (seats * 6));
  const cw = (innerW - gap * (seats - 1)) / seats;
  const cushionH = 0.15;
  for (let i = 0; i < seats; i++) {
    const x = -innerW / 2 + cw / 2 + i * (cw + gap);
    addBox(g, c.body, cw, cushionH, d - 0.12, x, seatTop - cushionH / 2, 0, true, R);
  }

  // 靠背板 + 独立靠垫（略后倾）；靠背板比底盘退后 6mm，避免背面共面闪烁
  const backT = 0.11;
  const panelH = backTop - legH;
  const panelZ = -(d / 2 - backT / 2 - 0.006);
  addBox(g, c.body, innerW, panelH, backT, 0, legH + panelH / 2, panelZ, true, R);
  const bcH = Math.max(0.16, backTop - seatTop - 0.02);
  const bcD = 0.18;
  for (let i = 0; i < seats; i++) {
    const x = -innerW / 2 + cw / 2 + i * (cw + gap);
    const b = addBox(g, c.body, cw, bcH, bcD, x, seatTop + bcH / 2, panelZ + bcD / 2 - 0.02, true, R);
    b.rotation.x = -0.11;
  }

  // 腿
  const inset = Math.min(0.14, d * 0.16);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addLeg(g, c.wood, sx * (w / 2 - armW / 2), sz * (d / 2 - inset), legH, 0.022, 0.03);
    }
  }
}

function sofa3(g, c) {
  sofaFrame(g, c, 3);
}

function sofaSingle(g, c) {
  sofaFrame(g, c, 1);
}

function sofaL(g, c) {
  const { w, d, h } = c;
  const legH = Math.min(0.09, h * 0.13);
  const seatTop = h * 0.53;
  const mainW = w - 1.05;            // 主座位区宽
  const chaiseW = w - mainW;         // 脚踏区宽
  const mainD = Math.min(d, 0.95);   // 主座位区深
  const R = 0.035;
  const mainX = w / 2 - mainW / 2;
  const chaiseX = -w / 2 + chaiseW / 2;
  // 主区贴后、脚踏区贴前，深浅相差的半个量各退一半，整体进深正好是 d
  const mainZ = -(d - mainD) / 2;
  const chaiseZ = (d - mainD) / 2;
  const armW = Math.max(0.085, Math.min(0.16, w * 0.06));

  // 底盘：主区 + 脚踏区各一块，拼成 L
  const deckH = Math.max(0.1, seatTop - legH - 0.15);
  addBox(g, c.body, mainW, deckH, mainD, mainX, legH + deckH / 2, mainZ, true, R);
  addBox(g, c.body, chaiseW, deckH, mainD, chaiseX, legH + deckH / 2, chaiseZ, true, R);

  // 扶手：主区左右 + 脚踏区外侧；脚踏前沿敞开
  const armH = seatTop + 0.06 - legH;
  addBox(g, c.body, armW, armH, mainD, mainX + mainW / 2 - armW / 2, legH + armH / 2, mainZ, true, R);
  addBox(g, c.body, armW, armH, mainD, mainX - mainW / 2 + armW / 2, legH + armH / 2, mainZ, true, R);
  addBox(g, c.body, armW, armH, mainD, chaiseX - chaiseW / 2 + armW / 2, legH + armH / 2, chaiseZ, true, R);

  // 座垫：主区 2 位 + 脚踏区 2 位
  const gap = 0.03;
  const cushions = (count, x0, totalW, z) => {
    const cw = (totalW - gap * (count - 1)) / count;
    for (let i = 0; i < count; i++) {
      addBox(g, c.body, cw, 0.15, mainD - 0.12, x0 - totalW / 2 + cw / 2 + i * (cw + gap), seatTop - 0.075, z, true, R);
    }
  };
  const mainInner = mainW - armW * 2;
  cushions(2, mainX, mainInner, mainZ);
  const chaiseInner = chaiseW - armW * 2;
  cushions(2, chaiseX, chaiseInner, chaiseZ);

  // 靠背：只沿主座位区（脚踏区无靠背，这才是 L 型的由来）
  const backT = 0.11;
  const panelH = h - legH;
  const panelZ = mainZ - (mainD / 2 - backT / 2 - 0.006);
  addBox(g, c.body, mainW, panelH, backT, mainX, legH + panelH / 2, panelZ, true, R);
  const bcH = Math.max(0.16, h - seatTop - 0.02);
  const bcW = (mainInner - gap) / 2;
  for (let i = 0; i < 2; i++) {
    const b = addBox(g, c.body, bcW, bcH, 0.18, mainX - mainInner / 2 + bcW / 2 + i * (bcW + gap),
      seatTop + bcH / 2, panelZ + 0.09 - 0.02, true, R);
    b.rotation.x = -0.11;
  }

  // 腿只落在 L 轮廓实心处
  const legs = [
    [mainX - mainW / 2 + armW / 2, mainZ - mainD / 2 + 0.13],
    [mainX + mainW / 2 - armW / 2, mainZ - mainD / 2 + 0.13],
    [mainX + mainW / 2 - armW / 2, mainZ + mainD / 2 - 0.13],
    [chaiseX - chaiseW / 2 + armW / 2, chaiseZ + mainD / 2 - 0.13],
    [chaiseX - chaiseW / 2 + armW / 2, chaiseZ - mainD / 2 + 0.13],
  ];
  for (const [x, z] of legs) addLeg(g, c.wood, x, z, legH, 0.022, 0.03);
}

/* ------------------------------------------------------------------ 几柜 */

function coffee(g, c) {
  const w = c.w;
  const d = c.d;
  const h = c.h;
  const topT = Math.min(0.05, h * 0.14);
  const r = Math.min(0.016, topT * 0.45);
  // 台面 + 下隔板（可换色）
  addBox(g, c.body, w, topT, d, 0, h - topT / 2, 0, true, r);
  const shelfT = 0.025;
  addBox(g, c.body, w - 0.16, shelfT, d - 0.12, 0, h * 0.42, 0, true, r);
  const inset = Math.min(0.13, w * 0.1);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addLeg(g, c.wood, sx * (w / 2 - inset), sz * (d / 2 - inset), h - topT, 0.022, 0.03);
    }
  }
}

function tvCabinet(g, c) {
  const w = c.w;
  const d = c.d;
  const h = c.h;
  const legH = Math.min(0.07, h * 0.16);
  const bodyH = h - legH;
  addBox(g, c.body, w, bodyH, d, 0, legH + bodyH / 2, 0, true, 0.02);

  // 中缝（两扇门）——凹进正面 1mm，不参与换色
  const seam = 0.008;
  addBox(g, c.metal, seam, bodyH - 0.03, 0.012, 0, legH + bodyH / 2, d / 2 - 0.006, false, 0);

  // 拉手
  const hw = Math.min(0.16, w * 0.11);
  for (const sx of [-1, 1]) {
    addBar(g, c.metal, hw, 0.012, sx * w * 0.25, legH + bodyH * 0.46, d / 2 + 0.004, 'x');
  }

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      addLeg(g, c.metal, sx * (w / 2 - 0.1), sz * (d / 2 - 0.05), legH, 0.014, 0.017);
    }
  }
}

function bed(g, c) {
  const w = c.w;
  const d = c.d;
  const h = c.h;
  const plinthH = Math.min(0.1, h * 0.13);
  const mattressH = Math.min(0.26, Math.max(0.16, h * 0.24));
  const mattressTop = plinthH + mattressH;

  addBox(g, c.body, w - 0.04, plinthH, d - 0.04, 0, plinthH / 2, 0, true, 0.02);
  addBox(g, c.body, w - 0.1, mattressH, d - 0.1, 0, plinthH + mattressH / 2, 0, true, 0.03);

  // 被子只铺到床尾挡板前
  const duvetD = d * 0.55;
  const duvetT = Math.min(0.12, h * 0.14);
  addBox(g, c.body, w - 0.14, duvetT, duvetD, 0, mattressTop + duvetT / 2, d / 2 - 0.15 - duvetD / 2, true, 0.03);

  // 床头板顶到整体高度 h；床尾挡板矮一截
  const hbH = h - mattressTop;
  if (hbH > 0.05) addBox(g, c.body, w, hbH, 0.12, 0, mattressTop + hbH / 2, -d / 2 + 0.06, true, 0.03);
  const fbH = Math.min(0.3, h * 0.3);
  if (fbH > 0.05) addBox(g, c.body, w, fbH, 0.1, 0, mattressTop + fbH / 2, d / 2 - 0.05, true, 0.03);

  // 枕头算固定软装，奶油色不随换色变
  const pillow = new THREE.MeshStandardMaterial({ color: new THREE.Color(CLOTH_HEX), roughness: 0.95, metalness: 0 });
  const pw = Math.min(0.6, w * 0.34);
  const pd = Math.min(0.36, d * 0.2);
  for (const sx of [-1, 1]) {
    addBox(g, pillow, pw, 0.13, pd, sx * w * 0.22, mattressTop + 0.065, -d / 2 + 0.32, false, 0.05);
  }
}

/* ------------------------------------------------------------------ 出口 */

const BUILDERS = { sofa3, sofaSingle, sofaL, coffee, tvCabinet, bed };

export function furnitureKinds() {
  return KINDS.map((k) => ({ id: k.id, name: k.name, dims: { ...k.dims } }));
}

export function buildFurniture(kind, opts = {}) {
  const spec = KINDS.find((k) => k.id === kind) || KINDS[0];
  const width = clampDim(opts.width, spec.dims.width);
  const depth = clampDim(opts.depth, spec.dims.depth);
  const height = clampDim(opts.height, spec.dims.height);
  const color = isValidColor(opts.color) ? opts.color.trim() : COLOR_SWATCHES[0].hex;
  const mspec = materialSpec(opts.materialId);

  // 主体一件材质，靠丢 userData.paintable 的 mesh 共享，换色/换材质都是一处改动
  const body = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: mspec.roughness,
    metalness: mspec.metalness,
    sheen: mspec.sheen,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#fff8f0'),
    map: textureFor(mspec.id),
  });
  const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(WOOD_HEX), roughness: 0.6, metalness: 0.04 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(METAL_HEX), roughness: 0.36, metalness: 0.7 });

  const group = new THREE.Group();
  BUILDERS[spec.id](group, { w: width, d: depth, h: height, body, wood, metal });

  group.userData.dims = { width, depth, height };
  group.userData.kind = spec.id;
  group.userData.name = spec.name;
  return group;
}
