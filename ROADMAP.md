# 🛣️ 银杏家具产品使用路书

> **核心目标**：让前端对**年轻人好看好玩**、对**老人能用后台随便改**。
> 任何人都好用，爸妈后台"想上架就上架、想下架就下架、想重拍就重拍"。

---

## 1. 设计原则（不可违反）

### 前端（顾客端）
| 维度 | 年轻人 | 老人 | 共存策略 |
|------|--------|------|----------|
| 字号 | 16px | 22px+ | **响应式**（小屏大字号） |
| 配色 | 暖橙+深咖 | 深咖+奶白 | **2 色调统一**（不花里胡哨） |
| 交互 | 鼠标悬浮、动效 | 点击区域 ≥56px | **大字大按钮为主**，动效辅助 |
| 图片 | 9:16 短视频 | 真实 4:3 照片 | **真实家具图为王**，不放装饰图 |
| 文案 | 网络化 | "发个照片" 口语 | **口语化优先** |
| 流程 | 一气呵成 | 3 步内必须完成 | **3 步完成试摆** |

### 后台（admin 端）
- **所有功能 1 屏内能完成**（不点来点去）
- **大按钮大字**（老人 50+ 能操作）
- **拖拽 / 扫码 / 一键**（不输字符）
- **所有改动可撤销**（30 秒内可恢复）
- **可批量**（多选 → 批量上下架 / 删除）

---

## 2. 完整后台能力清单

### ✅ 已实现（linter + 之前 agent 已写）

| 操作 | 端点 | 适用 |
|------|------|------|
| 上传图 + AI 识别命名 | `POST /api/admin/upload-and-identify` | 新商品上架 |
| 改任意字段 | `PATCH /api/admin/products/:id` | 改名/改价/改描述 |
| 上下架 | `POST /api/admin/products/:id/toggle` | 缺货下架/到货上架 |
| 删除（带图）| `DELETE /api/admin/products/:id` | 移除商品 |
| 上传顾客客厅照 | `POST /api/upload/room` | 用于试摆 |
| 后台登录 | `POST /api/admin/login` | 进入 |
| 查看订单 | `GET /api/orders` | 看客户下单 |
| 查上传历史 | `GET /api/users/:id/uploads` | 看哪些图 |

### 🆕 还需要加的（针对"重拍/重传/方便改"）

#### A. 商品图"重拍/重传"（**最高优先级**）

```js
// POST /api/admin/products/:id/retake-image
// 单图：替换商品的 image 字段
// 字段：file (multipart), mode: 'replace' | 'add'（添加多张）
app.post('/api/admin/products/:id/retake-image', requireAdmin, upload.single('file'), async (req, res) => {
  // 1. 删旧图（如果是 /uploads/products/ 路径）
  // 2. 存新图到 MinIO
  // 3. 更新 product.image / product.images[]
  // 4. 返回新图 URL
});
```

**产品结构升级**：
```json
{
  "id": "sofa-1",
  "name": "新中式三人沙发",
  "image": "/uploads/products/main.jpg",     // 主图（卡片显示）
  "images": [                                  // 详情页轮播（多角度）
    "/uploads/products/main.jpg",
    "/uploads/products/detail-1.jpg",
    "/uploads/products/detail-2.jpg"
  ],
  "status": "在售"
}
```

#### B. 批量操作（"一键下架 3 款"）

```js
// POST /api/admin/products/batch
// 字段：{ ids: ['sofa-1', 'sofa-2'], action: 'toggle' | 'delete' | 'status:在售/下架' }
```

#### C. 上架时选类别（"sofa/cabinet/bed/table"）

```js
// 已部分支持（product.category 字段）
// 主页试摆区可按类别筛选
```

#### D. 一键重命名所有商品（"AI 批量识别"）

```js
// POST /api/admin/products/batch-identify
// 遍历所有 status=在售 的商品，用 doubao 重新识别 + 自动填 name
```

#### E. 备份/恢复

```js
// GET /api/admin/backup — 返回 products + orders + uploads.json zip
// POST /api/admin/restore — 上传 zip 恢复
```

---

## 3. 前端关键页面改造

### A. 试摆区（年轻人+老人都用）

**当前**：选家具 + 上传图 + 立即生成（OK）
**改造**：
- 顶部加 **3 张"灵感图"**（年轻人想看效果时点开）
- 类别筛选：sofa / cabinet / bed / table
- "在售"状态：下架商品显示"暂不可用"

### B. 后台管理（核心）

**当前**：6 个分页面（upload / orders / tryon / ...）
**改造**：1 个总控页 + 4 大功能块

#### 总控后台（admin/index.html）

```
┌─────────────────────────────────────────────────┐
│ 🌳 银杏家具后台 · 11 件商品 · 今日 2 订单      │
├─────────────────────────────────────────────────┤
│ ① 上架新商品          │ ② 重拍商品图             │
│   📷 点这里上传         │   📸 选商品→换图       │
├─────────────────────────────────────────────────┤
│ ③ 上下架/编辑/删除    │ ④ 看订单/客户            │
│   11 件商品 表格       │   2 单今日 列表         │
│   □ □ sofa-1  ¥8.8k 在售 [改][拍][下]  │ │
│   □ □ sofa-2  ¥1.3w 在售 [改][拍][下]  │ │
│   □ □ 测试新沙发 ¥2.7k 在售 [改][拍][下]  │ │
│   [批量下架] [批量删除] [全部上架]           │
└─────────────────────────────────────────────────┘
```

#### 关键交互

| 老人操作 | 实际按钮 |
|----------|----------|
| "想下架这个" | 点 1 下 ✓（toggle） |
| "想改价格" | 点"改"→ 弹大数字键盘→确认 |
| "想重拍照片" | 点"拍"→ 拍照/选图→AI 自动命名 |
| "想全部下架过年" | 勾选 + "批量下架" 1 步 ✓ |
| "想删 5 个旧款" | 勾选 + "批量删除" 1 步 ✓ |
| "想看今天订单" | 4 号块直接看 ✓ |
| "想加 1 个新商品" | 1 号块拍照 → AI 命名 → 上架 |

**总控 1 屏 = 4 块 + 表格 + 按钮**。**没有任何下拉菜单**。

### C. 顾客端（年轻人主导）

**当前**：3 步完成试摆（OK）
**改造**：
- **首页首屏**：3 张"你可能会喜欢"的沙发（年轻人：美图快速感受）
- **试摆按钮加"先看看效果"**（不立即生成，先看默认示例图）
- **生成图分享**（"分享给朋友/朋友圈"按钮）
- **AI 写文案**："帮我写朋友圈"（一键写配文）

---

## 4. 父子协同实施（落地路径）

### Day 1：你（儿子）做

| 时间 | 任务 |
|------|------|
| 上午 | 加 retake-image / batch / restore 3 个新端点 |
| 下午 | 重写 admin/index.html 总控页 |
| 晚上 | 跑通 1 个新商品上架流程 |
| 当晚 | 把 ROADMAP.md 打印出来，**先给爸妈看一遍**（不进后台，让他们"看而不动"） |

### Day 2：爸妈先看

**只看不点**。给爸妈讲 30 分钟（"这是看店数据的地方"），但**不允许点**。

### Day 3：第一次操作

| 时 | 任务 | 谁 |
|----|------|------|
| 10:00 | 妈妈点"上架新商品" | 妈妈 |
| 10:05 | 拍店里一张沙发图 → 上传 | 妈妈 |
| 10:10 | AI 5 秒命名 "米白植物纹三人沙发" | 自动 |
| 10:12 | 看到新商品已上架 | ✓ |
| 11:00 | 爸爸点"下架 1 个旧款" | 爸爸 |
| 11:01 | 找 sofa-2，点[下] | 1 步 |
| 11:01 | 看到"已下架" | ✓ |

### Day 4-7：每天加 1 个新功能

| 日 | 教什么 |
|---|------|
| Day 4 | "重拍"商品图（点[拍]→ 选图→ AI 重新识别） |
| Day 5 | "批量操作"（勾选 + 一键） |
| Day 6 | "看订单"（点第 4 块） |
| Day 7 | 自由探索（不教，让爸妈自己试） |

### Day 8-30：爸妈独立运营

**儿子只**：每周 1 小时看数据 + 修 1 个 bug。

---

## 5. "重拍/重传"完整实现细节

### 后端 `POST /api/admin/products/:id/retake-image`

```js
const uploadProduct = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
app.post('/api/admin/products/:id/retake-image', requireAdmin, uploadProduct.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, 400, '请选一张图');
    const product = findProduct(req.params.id);
    if (!product) return fail(res, 404, '商品不存在');
    
    // 1. 删旧图
    if (product.image && product.image.startsWith('/uploads/products/')) {
      const oldName = product.image.replace('/uploads/products/', '');
      try { fs.unlinkSync(path.join(UPLOAD_DIRS.products, oldName)); } catch(_) {}
    }
    
    // 2. 存新图到 MinIO
    const ext = path.extname(req.file.originalname) || '.jpg';
    const filename = `${product.id}-${Date.now().toString(36)}${ext}`;
    const { url } = await saveImage(req.file.buffer, 'products', filename, req.file.mimetype);
    
    // 3. 更新 product.image（如有 images[] 数组，则追加）
    product.image = url;
    if (product.images && Array.isArray(product.images)) {
      product.images.push(url);
    }
    
    // 4. 写回 products.json
    const products = getProducts();
    const idx = products.findIndex(p => p.id === product.id);
    if (idx !== -1) products[idx] = product;
    const store = loadStore();
    if (Array.isArray(store)) {
      saveContainer(PRODUCTS_FILE, products);
    } else {
      store.products = products;
      saveContainer(PRODUCTS_FILE, store);
    }
    
    return ok(res, { product, url });
  } catch (err) {
    return fail(res, 500, `重传失败: ${err.message}`);
  }
});
```

### 后端 `POST /api/admin/products/batch`

```js
app.post('/api/admin/products/batch', requireAdmin, (req, res) => {
  const { ids, action } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return fail(res, 400, '请选商品');
  if (!['toggle', 'delete', 'set_on_sale', 'set_off_shelf'].includes(action)) {
    return fail(res, 400, 'action 必须是 toggle/delete/set_on_sale/set_off_shelf');
  }
  const products = getProducts();
  const updated = [];
  for (const id of ids) {
    const p = products.find(p => p.id === id);
    if (!p) continue;
    if (action === 'toggle') p.status = p.status === '下架' ? '在售' : '下架';
    if (action === 'delete') {
      // 删商品 + 删图
      if (p.image && p.image.startsWith('/uploads/products/')) {
        try { fs.unlinkSync(path.join(UPLOAD_DIRS.products, p.image.replace('/uploads/products/', ''))); } catch(_) {}
      }
      const idx = products.indexOf(p);
      products.splice(idx, 1);
    }
    if (action === 'set_on_sale') p.status = '在售';
    if (action === 'set_off_shelf') p.status = '下架';
    updated.push(p);
  }
  const store = loadStore();
  if (Array.isArray(store)) {
    saveContainer(PRODUCTS_FILE, products);
  } else {
    store.products = products;
    saveContainer(PRODUCTS_FILE, store);
  }
  return ok(res, { updated: updated.length, products: products });
});
```

### 后端 `GET /api/admin/backup` + `POST /api/admin/restore`

```js
app.get('/api/admin/backup', requireAdmin, (req, res) => {
  const products = readJSON(PRODUCTS_FILE);
  const orders = readJSON(ORDERS_FILE);
  const users = readJSON(USERS_FILE);
  const uploads = readJSON(UPLOADS_FILE);
  const backup = { products, orders, users, uploads, ts: new Date().toISOString() };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="yxjia-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(backup, null, 2));
});

app.post('/api/admin/restore', requireAdmin, multer({ storage: multer.memoryStorage() }).single('file'), (req, res) => {
  // 文件 → JSON.parse → 写回各 data 文件
  ...
});
```

---

## 6. 前端 admin 总控页（admin/index.html 重写版）

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>后台 · 银杏家具</title>
<style>
:root{--ink:#1a1a1a;--coffee:#3a2818;--paper:#faf6ef;--line:rgba(58,40,24,.15);--red:#d94f3e;--green:#1f7a3a}
*{margin:0;padding:0;box-sizing:border-box}
html{font-size:18px}
body{font-family:"Helvetica Neue","PingFang SC",sans-serif;background:var(--paper);color:var(--ink);font-size:1rem;padding-bottom:80px}
.nav{background:var(--coffee);color:var(--paper);padding:16px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:50}
.nav-title{font-size:1.2rem;font-weight:700}
.nav-actions a{color:var(--paper);padding:8px 14px;font-size:.95rem;font-weight:600;text-decoration:none}

.dashboard{padding:24px 20px;max-width:1200px;margin:0 auto}
.stats-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.stat{background:#fff;padding:20px;border:1px solid var(--line);border-radius:12px;text-align:center}
.stat .n{font-size:2.5rem;font-weight:800;color:var(--coffee);line-height:1}
.stat .l{font-size:.85rem;color:var(--ink);opacity:.6;margin-top:4px}

.blocks{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
@media(max-width:720px){.blocks{grid-template-columns:1fr}}
.block{background:#fff;padding:24px;border:1px solid var(--line);border-radius:14px}
.block h2{font-size:1.3rem;font-weight:800;margin-bottom:8px}
.block .desc{font-size:.9rem;opacity:.6;margin-bottom:16px}
.block button{width:100%;padding:20px;font-size:1.1rem;font-weight:700;background:var(--coffee);color:var(--paper);border-radius:12px;border:none;cursor:pointer}
.block button.green{background:var(--green)}
.block button.red{background:var(--red)}

.table-wrap{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
table{width:100%;border-collapse:collapse}
th,td{padding:14px 12px;text-align:left;border-bottom:1px solid var(--line);font-size:.95rem}
th{background:var(--paper);font-size:.8rem;text-transform:uppercase;letter-spacing:.1em;color:var(--ink);opacity:.6}
tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.75rem;font-weight:600}
.tag.sale{background:#e6f7eb;color:var(--green)}
.tag.off{background:#fef2f2;color:var(--red)}
.act-btn{padding:6px 10px;border:1px solid var(--line);background:#fff;font-size:.8rem;margin-right:4px;cursor:pointer;border-radius:6px}
.act-btn.danger{border-color:var(--red);color:var(--red)}

.bottom-bar{position:fixed;bottom:0;left:0;right:0;background:var(--paper);padding:12px 16px;display:flex;gap:8px;border-top:1px solid var(--line);z-index:100}
.bottom-bar button{flex:1;padding:16px;font-size:.95rem;font-weight:700;border-radius:10px;border:1px solid var(--ink);background:#fff;cursor:pointer}
.bottom-bar .primary{background:var(--coffee);color:var(--paper)}
</style>
</head>
<body>

<nav class="nav">
  <div class="nav-title">🌳 银杏家具后台</div>
  <div class="nav-actions">
    <a href="/">看首页</a>
    <a href="/api/admin/logout">退出</a>
  </div>
</nav>

<main class="dashboard">
  <!-- 数据快览 -->
  <div class="stats-row">
    <div class="stat"><div class="n" id="s-products">-</div><div class="l">在售商品</div></div>
    <div class="stat"><div class="n" id="s-orders">-</div><div class="l">总订单</div></div>
    <div class="stat"><div class="n" id="s-tryons">-</div><div class="l">试摆次数</div></div>
  </div>

  <!-- 4 大功能块 -->
  <div class="blocks">
    <div class="block">
      <h2>① 上架新商品</h2>
      <div class="desc">拍图 → AI 自动命名 → 立即上架</div>
      <button onclick="location.href='/admin/product.html'">📷 拍照上架</button>
    </div>
    <div class="block">
      <h2>② 重拍/重传商品图</h2>
      <div class="desc">替换现有商品的图片（重拍更清晰）</div>
      <button class="green" onclick="retakeFlow()">📸 选商品重拍</button>
    </div>
    <div class="block">
      <h2>③ 上下架/编辑/删除</h2>
      <div class="desc">单件操作或批量勾选</div>
      <button onclick="location.href='#products-table'">⚙️ 管理商品</button>
    </div>
    <div class="block">
      <h2>④ 今日订单</h2>
      <div class="desc">看哪些客户下单了</div>
      <button class="red" onclick="location.href='/admin/orders.html'">📋 看订单</button>
    </div>
  </div>

  <!-- 商品表（核心） -->
  <div class="table-wrap" id="products-table">
    <table>
      <thead>
        <tr>
          <th style="width:40px"><input type="checkbox" id="check-all"></th>
          <th>商品</th>
          <th>价格</th>
          <th>状态</th>
          <th style="width:240px">操作</th>
        </tr>
      </thead>
      <tbody id="products-tbody"></tbody>
    </table>
  </div>
</main>

<!-- 批量操作底部栏（仅勾选时出现） -->
<div class="bottom-bar" id="batch-bar" style="display:none">
  <button onclick="batchAction('set_on_sale')">批量上架</button>
  <button onclick="batchAction('set_off_shelf')">批量下架</button>
  <button onclick="batchAction('delete')" class="primary" style="background:var(--red)">批量删除</button>
  <button onclick="clearSelection()">取消</button>
</div>

<script>
// 数据
let PRODUCTS = [];
let SELECTED_IDS = new Set();

async function loadAll() {
  const r = await fetch('/api/products?all=1').then(r=>r.json());
  PRODUCTS = r.data?.products || [];
  render();
  document.getElementById('s-products').textContent = PRODUCTS.filter(p=>p.status!=='下架').length;
  document.getElementById('s-orders').textContent = (JSON.parse(localStorage.getItem('yxjia_orders')||'[]')).length;
  // 试摆数从 uploads.json
  try {
    const u = await fetch('/api/users/x/uploads').then(r=>r.json());
    document.getElementById('s-tryons').textContent = u.data?.uploads?.length || 0;
  } catch(_){}
}

function render() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = PRODUCTS.map(p => `
    <tr>
      <td><input type="checkbox" class="p-check" data-id="${p.id}" ${SELECTED_IDS.has(p.id)?'checked':''}></td>
      <td>
        <div style="display:flex;align-items:center;gap:12px">
          <img src="${p.image||''}" style="width:60px;height:60px;object-fit:cover;background:#eee">
          <div>
            <div style="font-weight:700">${p.name||''}</div>
            <div style="font-size:.8rem;opacity:.6">${p.subtitle||p.category||''}</div>
          </div>
        </div>
      </td>
      <td>${p.price||''}</td>
      <td><span class="tag ${p.status==='下架'?'off':'sale'}">${p.status||'在售'}</span></td>
      <td>
        <button class="act-btn" onclick="editProduct('${p.id}')">改</button>
        <button class="act-btn" onclick="retakeProduct('${p.id}')">拍</button>
        <button class="act-btn" onclick="toggleProduct('${p.id}')">下/上</button>
        <button class="act-btn danger" onclick="deleteProduct('${p.id}')">删</button>
      </td>
    </tr>
  `).join('');
  // 勾选监听
  document.querySelectorAll('.p-check').forEach(cb => {
    cb.addEventListener('change', e => {
      if (e.target.checked) SELECTED_IDS.add(e.target.dataset.id);
      else SELECTED_IDS.delete(e.target.dataset.id);
      document.getElementById('batch-bar').style.display = SELECTED_IDS.size ? 'flex' : 'none';
    });
  });
}

document.getElementById('check-all').addEventListener('change', e => {
  document.querySelectorAll('.p-check').forEach(cb => {
    cb.checked = e.target.checked;
    if (e.target.checked) SELECTED_IDS.add(cb.dataset.id);
    else SELECTED_IDS.delete(cb.dataset.id);
  });
  document.getElementById('batch-bar').style.display = SELECTED_IDS.size ? 'flex' : 'none';
});

function clearSelection(){ SELECTED_IDS.clear(); document.getElementById('check-all').checked=false; document.getElementById('batch-bar').style.display='none'; document.querySelectorAll('.p-check').forEach(cb=>cb.checked=false); }

async function toggleProduct(id) {
  if(!confirm('确定切换上下架？')) return;
  const r = await fetch(`/api/admin/products/${id}/toggle`, {method:'POST'}).then(r=>r.json());
  if(r.success) loadAll();
}
async function deleteProduct(id) {
  if(!confirm('确定删除？删了回不来！')) return;
  const r = await fetch(`/api/admin/products/${id}`, {method:'DELETE'}).then(r=>r.json());
  if(r.success) loadAll();
}
function editProduct(id) {
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  const newName = prompt('商品名', p.name);
  if(newName && newName!==p.name){
    fetch(`/api/admin/products/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:newName})}).then(r=>r.json()).then(d=>d.success&&loadAll());
  }
}
function retakeProduct(id) {
  const p = PRODUCTS.find(x=>x.id===id);
  if(!p) return;
  const input = document.createElement('input');
  input.type='file'; input.accept='image/*'; input.capture='environment';
  input.onchange = e => {
    if(!e.target.files[0]) return;
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    fetch(`/api/admin/products/${id}/retake-image`,{method:'POST',body:fd}).then(r=>r.json()).then(d=>{
      alert(d.success ? '✅ 重拍成功！' : '失败：'+d.error);
      d.success && loadAll();
    });
  };
  input.click();
}
function retakeFlow(){ alert('先勾选要重拍的产品，下方选【重拍】'); document.getElementById('products-table').scrollIntoView(); }
async function batchAction(action){
  if(!confirm('确认批量操作？')) return;
  const r = await fetch('/api/admin/products/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[...SELECTED_IDS],action})}).then(r=>r.json());
  if(r.success){ clearSelection(); loadAll(); }
}

loadAll();
</script>
</body>
</html>
```

---

## 7. 验收清单（每条要勾完）

| # | 项 | 状态 |
|---|----|------|
| 1 | 总控页 1 屏展示所有功能 | ☐ |
| 2 | 上架新商品（拍照） | ☐ |
| 3 | 重拍商品图（替换） | ☐ |
| 4 | 上下架（单件） | ☐ |
| 5 | 上下架（批量） | ☐ |
| 6 | 编辑商品名/价格 | ☐ |
| 7 | 删除商品 | ☐ |
| 8 | 看今日订单 | ☐ |
| 9 | 备份数据 | ☐ |
| 10 | 年轻人首页 3 张灵感图 | ☐ |
| 11 | AI 写朋友圈文案 | ☐ |
| 12 | 试摆结果可分享 | ☐ |

---

## 8. 一句话总结

> **前端要"两种人都好"**——年轻人看到美图 5 秒下单，老人看到大字一行能改价上下架。
> **后台要"1 屏全搞定"**——不点来点去，不输字符，**选+一键**完成所有事。

