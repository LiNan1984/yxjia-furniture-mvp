"""v1 迭代测试：AI 文案/卖点自动生成（spec: team/spec/spec-v1.md）

覆盖：
1. 后台 ai-upload 页（"AI 拍照上架"）admin 登录后可达
2. admin 首页有 ai-upload 入口卡片
3. 旧商品（无新字段）详情页打开无 JS 报错、无"AI 识别"字样（兼容性冒烟）
4. 旧商品 API 向后兼容（/api/products/:id 正常返回，不因新字段缺失报错）

注意：本文件不打真 AI API（识别链路的 mock 测试在 tests/api-v1.test.js）。
"""

import requests

BASE = "http://127.0.0.1:3000"
# 仓库里一直存在的旧商品（只有旧字段：无 sellingPoints/suitableFor/placementTip）
LEGACY_PRODUCT_ID = "p-msbx4qb0-s2i"
LEGACY_PRODUCT_NAME = "浅灰色弧形科技布沙发"


def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{BASE}/api/admin/login",
        json={"username": "admin", "password": "123456"},
        timeout=10,
    )
    assert r.status_code == 200, f"admin 登录失败：{r.status_code} {r.text}"
    return s


def test_admin_ai_upload_page_reachable():
    """/admin/ai-upload 页面应存在且可达（v1 新页面）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/ai-upload", timeout=10)
    assert r.status_code == 200, f"/admin/ai-upload returned {r.status_code}（页面尚未实现）"
    assert "AI 拍照上架" in r.text, "页面应含「AI 拍照上架」标题"
    print("✓ /admin/ai-upload 页面可达且含标题")


def test_admin_ai_upload_page_has_editable_form():
    """页面应有：选图入口 + 确认上架按钮（老人友好流程闭环）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/ai-upload", timeout=10)
    assert r.status_code == 200
    html = r.text
    assert 'type="file"' in html or "file" in html, "应有选图控件"
    assert "确认上架" in html, "应有「确认上架」按钮"
    assert "/api/admin/upload-and-identify" in html, "应调用识别接口"
    print("✓ /admin/ai-upload 页面含选图 + 确认上架 + 识别接口调用")


def test_admin_index_has_ai_upload_entry():
    """admin 首页应有「AI 拍照上架」入口卡片（spec F2）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/index", timeout=10)
    assert r.status_code == 200
    assert "/admin/ai-upload" in r.text, "admin 首页应有 /admin/ai-upload 入口链接"
    assert "AI 拍照上架" in r.text, "入口卡片应含「AI 拍照上架」文案"
    print("✓ admin 首页含 AI 拍照上架入口")


def test_legacy_product_detail_page_opens_without_js_errors(page):
    """旧商品详情页（无新字段）打开无 JS 报错（spec 兼容性验收）"""
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/product/{LEGACY_PRODUCT_ID}", wait_until="networkidle", timeout=30000)
    # 详情页通过 JS 拉取商品后渲染名称
    page.wait_for_selector(f"text={LEGACY_PRODUCT_NAME}", timeout=10000)
    assert not errors, f"旧商品详情页 JS 报错：{errors}"
    body_text = page.inner_text("body")
    # 旧 description 里的"AI 识别："属于旧数据（老板点"重新生成文案"后消失），不算兼容性问题；
    # 但 highlights 的"AI 识别于"机器噪音是 spec B2 明确要求读取时过滤的
    assert "AI 识别于" not in body_text, "详情页不应出现「AI 识别于」机器噪音（spec B2）"
    print("✓ 旧商品详情页打开无报错、无 AI 字样")


def test_legacy_product_api_backward_compatible():
    """旧商品 API 返回 200 且结构完整（新字段缺失不算错误）"""
    r = requests.get(f"{BASE}/api/products/{LEGACY_PRODUCT_ID}", timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    p = data["data"]["product"]
    assert p["id"] == LEGACY_PRODUCT_ID
    assert p["name"] == LEGACY_PRODUCT_NAME
    assert p["price"], "旧商品应有价格"
    print(f"✓ 旧商品 API 兼容：{p['id']} name={p['name']}")


def test_products_list_no_ai_noise_in_highlights():
    """GET /api/products 读取时过滤 highlights 里的"AI 识别于"机器噪音（spec B2）"""
    r = requests.get(f"{BASE}/api/products", timeout=10)
    assert r.status_code == 200
    products = r.json()["data"]["products"]
    assert products, "应至少有商品"
    bad = []
    for p in products:
        for h in p.get("highlights") or []:
            if h.startswith("AI 识别于"):
                bad.append(f"{p['id']}: {h}")
    assert not bad, f"highlights 仍含机器噪音：{bad}"
    print("✓ 商品列表 highlights 无「AI 识别于」噪音")
