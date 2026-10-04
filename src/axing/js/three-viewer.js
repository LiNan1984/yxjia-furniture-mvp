/**
 * 阿杏 AI 家居助手 · three.js 试摆 Viewer
 * 相机 / 灯光 / 地板 / 尺寸标注层 / 家具生命周期管理。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  buildFurniture,
  furnitureKinds,
  MATERIALS,
  textureFor,
  disposeSharedAssets,
} from './furniture.js';

const DEG = Math.PI / 180;
const BG_DEFAULT = '#F7F4EF';
const FLOOR_HEX = '#D9D4CD';
const LABEL_COLOR = '#77726C';
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** 3/4 视角：看得见正面也看得见右侧 */
const VIEW_DIR = new THREE.Vector3(0.62, 0.44, 1);
const DEFAULT_KIND = 'sofa3';

function fallbackKind(kind) {
  const k = furnitureKinds().find((x) => x.id === kind);
  return k || furnitureKinds().find((x) => x.id === DEFAULT_KIND) || furnitureKinds()[0];
}

/** WebGL 起不来时返回同形状空壳，调用方不必 try/catch */
function makeStub() {
  const noop = () => false;
  return {
    setFurniture: noop,
    setColor: noop,
    setMaterial: noop,
    setAutoRotate: noop,
    reset: noop,
    screenshot: () => null,
    getDimensions: () => ({ width: 0, depth: 0, height: 0 }),
    getFaceCount: () => 0,
    dispose: noop,
  };
}

function trianglesOf(object3d) {
  let tris = 0;
  object3d.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    const count = g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0);
    tris += count / 3;
  });
  return Math.round(tris);
}

function disposeObject(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
    else if (m && m.dispose) m.dispose();
  });
}

export function createViewer(container, opts = {}) {
  const isEl = container && (container.nodeType === 1 || typeof container.appendChild === 'function');
  if (!isEl) {
    if (typeof opts.onError === 'function') opts.onError(new Error('createViewer: container 不是 DOM 元素'));
    return makeStub();
  }

  const host = container;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;
  const onReady = typeof opts.onReady === 'function' ? opts.onReady : null;
  const background = typeof opts.background === 'string' && opts.background.trim() ? opts.background.trim() : BG_DEFAULT;

  let renderer;
  let canvas;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    canvas = renderer.domElement;
  } catch (err) {
    if (onError) onError(err instanceof Error ? err : new Error(String(err)));
    return makeStub();
  }

  /* ------------------------------------------------------------ 渲染器 */
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.touchAction = 'none';
  host.appendChild(canvas);
  if (typeof getComputedStyle === 'function' && getComputedStyle(host).position === 'static') {
    host.style.position = 'relative';
  }

  /* ------------------------------------------------------------ 场景 */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 72),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(FLOOR_HEX), roughness: 0.95, metalness: 0 }),
  );
  floor.name = 'axing-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const hemi = new THREE.HemisphereLight(0xffffff, new THREE.Color(FLOOR_HEX), 1.5);
  hemi.position.set(0, 6, 0);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(2.8, 3.8, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -3.2;
  key.shadow.radius = 4;
  key.shadow.normalBias = 0.02;
  key.shadow.bias = -0.0004;
  scene.add(key);
  scene.add(key.target); // 默认 target 在原点，随 framing 一起搬

  const fill = new THREE.DirectionalLight(0xffffff, 0.75);
  fill.position.set(-3.4, 2.4, -2.2);
  scene.add(fill);

  /* ------------------------------------------------------------ 相机 */
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.screenSpacePanning = false;
  controls.autoRotateSpeed = 1.2;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minPolarAngle = 0.05;
  controls.target.set(0, 0.4, 0);
  controls.cursor.set(0, 0.4, 0);
  controls.minTargetRadius = 0;
  controls.maxTargetRadius = 0.4; // 允许平移但锁在家具附近
  controls.update();

  /* ------------------------------------------------------------ 尺寸标注层 */
  const label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.left = '0';
  label.style.top = '0';
  label.style.padding = '4px 10px';
  label.style.borderRadius = '999px';
  label.style.background = 'rgba(250,246,239,0.86)';
  label.style.backdropFilter = 'blur(6px)';
  label.style.color = LABEL_COLOR;
  label.style.font = `300 11px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif`;
  label.style.letterSpacing = '0.06em';
  label.style.whiteSpace = 'nowrap';
  label.style.pointerEvents = 'none';
  label.style.userSelect = 'none';
  label.style.willChange = 'transform';
  label.style.zIndex = '2';
  host.appendChild(label);

  /* ------------------------------------------------------------ 家具 */
  let furniture = null;
  let currentKind = null;
  let currentDims = { width: 0, depth: 0, height: 0 };
  let currentColor = null;
  let currentMaterialId = MATERIALS[0].id;
  let disposed = false;
  let labelPoint = new THREE.Vector3();
  let labelMetricKey = '';
  let labelHalf = { w: 40, h: 14 };

  function paintableMaterials() {
    const set = new Set();
    if (!furniture) return set;
    furniture.traverse((o) => {
      if (o.isMesh && o.userData.paintable && o.material) set.add(o.material);
    });
    return set;
  }

  function box() {
    return new THREE.Box3().setFromObject(furniture);
  }

  /** 相机 framing：看向家具中心，距离按尺寸缩放 */
  function framing() {
    if (!furniture) return;
    const b = box();
    const center = b.getCenter(new THREE.Vector3());
    const size = b.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5 + Math.max(size.x, size.z) * 0.22 + 0.25;

    const vFov = camera.fov * DEG;
    const dist = radius / Math.sin(vFov / 2) * 1.06;
    const aspect = camera.aspect > 0 ? camera.aspect : 1;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distH = radius / Math.sin(hFov / 2) * 1.02;

    controls.cursor.copy(center);
    controls.target.copy(center);
    controls.minDistance = Math.max(0.6, Math.min(dist, distH) * 0.32);
    controls.maxDistance = Math.min(dist, distH) * 3.2;
    key.target.position.copy(center);
    camera.position.copy(center).addScaledVector(VIEW_DIR, Math.max(dist, distH));
    camera.updateProjectionMatrix();
    // 关掉阻尼跑一帧：清掉 autoRotate 残留在 _sphericalDelta 里的惯性，
    // 否则复位/换家具后相机还会漂上一小会儿
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    syncLabel();
  }

  function syncLabel() {
    if (!furniture) return;
    const b = box();
    const center = b.getCenter(new THREE.Vector3());
    labelPoint.set(center.x, b.max.y, center.z);
  }

  function paintLabel(force) {
    if (!furniture) return;
    const d = currentDims;
    const text = `宽 ${d.width.toFixed(1)} × 深 ${d.depth.toFixed(1)} × 高 ${d.height.toFixed(1)} m`;
    if (label.textContent !== text) {
      label.textContent = text;
      force = true;
    }
    const w = host.clientWidth || 0;
    const h = host.clientHeight || 0;
    if (!w || !h) return;
    // 只在文案变化时读 offsetWidth，避免每帧强制回流
    if (labelMetricKey !== text) {
      labelMetricKey = text;
      labelHalf = { w: label.offsetWidth / 2 + 6, h: label.offsetHeight / 2 + 6 };
    }
    const p = labelPoint.clone().project(camera);
    let x = (p.x * 0.5 + 0.5) * w;
    let y = (-p.y * 0.5 + 0.5) * h;
    x = Math.min(w - labelHalf.w, Math.max(labelHalf.w, x));
    y = Math.min(h - labelHalf.h, Math.max(labelHalf.h, y));
    const tx = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
    if (force || label.dataset.pos !== tx) {
      label.style.transform = tx;
      label.dataset.pos = tx;
    }
  }

  function setFurniture(kind, dims) {
    if (disposed) return false;
    const spec = fallbackKind(kind);
    const d = dims || {};
    const next = buildFurniture(spec.id, {
      width: d.width,
      depth: d.depth,
      height: d.height,
      color: currentColor,
      materialId: currentMaterialId,
    });
    if (furniture) {
      scene.remove(furniture);
      disposeObject(furniture);
    }
    furniture = next;
    furniture.rotation.set(0, 0, 0);
    scene.add(furniture);
    currentKind = spec.id;
    currentDims = { ...next.userData.dims };
    framing();
    paintLabel(true);
    return true;
  }

  function setColor(hex) {
    if (disposed || !furniture || !HEX_RE.test(String(hex || ''))) return false;
    currentColor = String(hex).trim();
    const c = new THREE.Color().set(currentColor);
    for (const mat of paintableMaterials()) mat.color.copy(c);
    return true;
  }

  function setMaterial(materialId) {
    const spec = MATERIALS.find((m) => m.id === materialId);
    if (disposed || !furniture || !spec) return false;
    currentMaterialId = spec.id;
    const tex = textureFor(spec.id);
    for (const mat of paintableMaterials()) {
      mat.roughness = spec.roughness;
      mat.metalness = spec.metalness;
      if ('sheen' in mat) mat.sheen = spec.sheen;
      // map 增删会改变 shader program，必须标脏
      if (mat.map !== tex) {
        mat.map = tex;
        mat.needsUpdate = true;
      }
    }
    return true;
  }

  function setAutoRotate(on) {
    if (disposed) return false;
    controls.autoRotate = on === true;
    return true;
  }

  function reset() {
    if (disposed || !furniture) return false;
    furniture.rotation.set(0, 0, 0);
    framing();
    paintLabel(true);
    return true;
  }

  function screenshot() {
    if (disposed) return null;
    render();
    try {
      return canvas.toDataURL('image/png');
    } catch (err) {
      return null;
    }
  }

  function getDimensions() {
    return { ...currentDims };
  }

  function getFaceCount() {
    if (disposed) return 0;
    return trianglesOf(scene);
  }

  /* ------------------------------------------------------------ 尺寸自适应 */
  let dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
  function resize() {
    const w = host.clientWidth || 0;
    const h = host.clientHeight || 0;
    if (!w || !h) return false;
    dpr = Math.min(2, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    return true;
  }

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      if (resize()) paintLabel(true);
    });
    ro.observe(host);
  } else {
    window.addEventListener('resize', resize);
  }

  /* ------------------------------------------------------------ 主循环 */
  let raf = 0;
  let running = true;
  let readySent = false;

  function render() {
    const w = host.clientWidth || 0;
    const h = host.clientHeight || 0;
    if (!w || !h) return;
    controls.update();
    renderer.render(scene, camera);
    if (!readySent) {
      readySent = true;
      if (onReady) {
        onReady({
          kind: currentKind,
          dims: getDimensions(),
          faceCount: getFaceCount(),
          webgl2: !!renderer.capabilities.isWebGL2,
        });
      }
    }
  }

  function loop() {
    if (!running) return;
    render();
    paintLabel(false);
    raf = requestAnimationFrame(loop);
  }

  // 初始家具：默认三人沙发，首屏不空
  setFurniture(DEFAULT_KIND, null);
  resize();
  raf = requestAnimationFrame(loop);

  /* ------------------------------------------------------------ 销毁 */
  function dispose() {
    if (disposed) return false;
    disposed = true;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (ro) ro.disconnect();
    else if (typeof window !== 'undefined') window.removeEventListener('resize', resize);
    ro = null;
    if (controls && controls.dispose) controls.dispose();
    if (furniture) {
      scene.remove(furniture);
      disposeObject(furniture);
      furniture = null;
    }
    scene.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
      else if (m && m.dispose) m.dispose();
    });
    disposeSharedAssets();
    renderer.dispose();
    if (renderer.forceContextLoss) renderer.forceContextLoss();
    if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (label.parentNode) label.parentNode.removeChild(label);
    return true;
  }

  return {
    setFurniture,
    setColor,
    setMaterial,
    setAutoRotate,
    reset,
    screenshot,
    getDimensions,
    getFaceCount,
    dispose,
  };
}
