"""v2 迭代测试：AI 商品场景图——后台页 + 顾客端画廊兼容冒烟（spec: team/spec/spec-v2.md）

覆盖（spec 交接第 4 条）：
1. /admin/scene 场景图工厂页 admin 登录后可达，渲染 5 个风格按钮
2. admin 首页有「场景图工厂」入口卡片（spec F3）
3. 带 sceneImages 的商品详情页打开无 JS 报错、出现画廊与「AI 合成场景」小字（spec F4）
4. 无 sceneImages 的旧商品详情页不出现画廊区块、无 JS 报错（兼容性冒烟）

注意：本文件不打真 AI API；sceneImages 通过临时改 data/products.json 注入
（fixture 内备份/还原，server 每请求重读磁盘，对运行中的 3000 实例即时生效）。
"""

import json
from pathlib import Path

import pytest
import requests

BASE = "http://127.0.0.1:3000"
REPO = Path(__file__).parent.parent
PRODUCTS_FILE = REPO / "data" / "products.json"

# 仓库里一直存在的旧商品（无 sceneImages）
LEGACY_PRODUCT_ID = "p-msbx4qb0-s2i"
LEGACY_PRODUCT_NAME = "浅灰色弧形科技布沙发"
# 画廊注入用的占位图（详情页 <img>/<a> 只要求 URL 可拼，不要求真打开）
FAKE_SCENE_URL = "/uploads/products/2d484ab70cf1785a.jpg"


def admin_session() -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{BASE}/api/admin/login",
        json={"username": "admin", "password": "123456"},
        timeout=10,
    )
    assert r.status_code == 200, f"admin 登录失败：{r.status_code} {r.text}"
    return s


@pytest.fixture
def product_with_scene():
    """临时给一个在售商品注入 sceneImages，测试结束还原 products.json。"""
    original = PRODUCTS_FILE.read_text(encoding="utf-8")
    store = json.loads(original)
    products = store["products"] if isinstance(store, dict) else store
    target = next((p for p in products if p.get("status") != "下架"), None)
    assert target is not None, "应至少有一个在售商品可注入"
    target["sceneImages"] = [
        {
            "url": FAKE_SCENE_URL,
            "styleId": "daylight",
            "styleName": "明亮家居",
            "demoType": "ai-composition",
            "createdAt": "2026-09-18T12:00:00.000Z",
        }
    ]
    if isinstance(store, dict):
        store["products"] = products
    PRODUCTS_FILE.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")
    yield target["id"]
    PRODUCTS_FILE.write_text(original, encoding="utf-8")


def test_admin_scene_page_reachable_and_renders_styles():
    """/admin/scene 页面应存在且渲染 5 个风格按钮（v2 新页，spec F1）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/scene?productId={LEGACY_PRODUCT_ID}", timeout=10)
    assert r.status_code == 200, f"/admin/scene returned {r.status_code}（页面尚未实现）"
    html = r.text
    assert "场景图" in html, "页面应含「场景图」标题"
    # 5 个默认风格（data/scene-styles.json）
    for style_name in ("明亮家居", "暖光氛围", "夜晚温馨", "极简留白", "家庭生活"):
        assert style_name in html, f"风格按钮缺失：{style_name}"
    print("✓ /admin/scene 页面可达且含 5 个风格按钮")


def test_admin_index_has_scene_factory_entry():
    """admin 首页应有「场景图工厂」入口卡片（spec F3）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/index", timeout=10)
    assert r.status_code == 200
    assert "/admin/scene" in r.text, "admin 首页应有 /admin/scene 入口链接"
    assert "场景图" in r.text, "入口卡片应含「场景图工厂」文案"
    print("✓ admin 首页含场景图工厂入口")


def test_admin_products_list_has_scene_entry():
    """后台商品列表卡片区应有「场景图」操作入口（spec F2）"""
    s = admin_session()
    r = s.get(f"{BASE}/admin/products", timeout=10)
    assert r.status_code == 200
    assert "/admin/scene" in r.text, "商品列表应有跳转 /admin/scene 的入口"
    print("✓ 后台商品列表含场景图入口")


def test_product_detail_with_scene_images_shows_gallery(page, product_with_scene):
    """带 sceneImages 的详情页：画廊出现 + 「AI 合成场景」小字 + 无 JS 报错（spec F4）"""
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/product/{product_with_scene}", wait_until="networkidle", timeout=30000)
    page.wait_for_selector("text=摆进家里", timeout=10000)
    assert not errors, f"带场景图的详情页 JS 报错：{errors}"
    body_text = page.inner_text("body")
    assert "摆进家里" in body_text, "应出现「摆进家里是什么样」画廊标题"
    assert "AI 合成场景" in body_text, "画廊底部应有「AI 合成场景，仅供参考」小字（诚实性硬线）"
    print(f"✓ 详情页 {product_with_scene} 渲染场景图画廊 + AI 标注小字")


def test_legacy_product_detail_no_gallery_block(page):
    """无 sceneImages 的旧商品详情页：画廊区块不渲染、无 JS 报错（兼容冒烟）"""
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/product/{LEGACY_PRODUCT_ID}", wait_until="networkidle", timeout=30000)
    page.wait_for_selector(f"text={LEGACY_PRODUCT_NAME}", timeout=10000)
    assert not errors, f"旧商品详情页 JS 报错：{errors}"
    body_text = page.inner_text("body")
    assert "摆进家里" not in body_text, "无场景图的旧商品不应出现画廊空区块"
    print("✓ 旧商品详情页无画廊区块、无报错（兼容）")
