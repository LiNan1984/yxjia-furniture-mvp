"""后台管理 + 用户系统 + 上传 + AI 试摆 测试套件"""

import re
import time
import requests

BASE = "http://127.0.0.1:3000"


def _user_session():
    """试摆接口要求登录（设计原则 5），先登录一个测试用户拿会话"""
    sess = requests.Session()
    r = sess.post(f"{BASE}/api/auth/login",
                  json={"phone": "13900139888", "code": "123456"}, timeout=10)
    assert r.status_code == 200, r.text
    return sess


def test_admin_login_success():
    """admin / 123456 登录应成功，并写入 cookie"""
    r = requests.post(
        f"{BASE}/api/admin/login",
        json={"username": "admin", "password": "123456"},
        timeout=10,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("success") is True
    assert data["data"]["ok"] is True
    assert "yxjia_sid" in r.cookies
    print(f"✓ admin 登录成功")


def test_admin_login_wrong_password():
    r = requests.post(
        f"{BASE}/api/admin/login",
        json={"username": "admin", "password": "wrong"},
        timeout=10,
    )
    assert r.status_code == 401
    assert r.json()["success"] is False
    print("✓ admin 错密码返回 401")


def test_admin_pages_all_load():
    """/admin 系列页面全部 200"""
    for path in ["/admin", "/admin/login", "/admin/index",
                 "/admin/product", "/admin/room",
                 "/admin/tryon", "/admin/orders"]:
        r = requests.get(BASE + path, timeout=10)
        assert r.status_code == 200, f"{path} returned {r.status_code}"
        assert "银杏家具" in r.text or "后台" in r.text or "添加" in r.text or "试摆" in r.text
    print("✓ /admin 系列 7 个页面全部 200")


def test_user_login_with_fixed_code():
    """手机号 + 验证码 123456 登录，自动创建用户"""
    session = requests.Session()
    # 用一个独立测试手机号（避免污染历史数据）
    phone = "13900139999"
    r = session.post(f"{BASE}/api/auth/login",
                     json={"phone": phone, "code": "123456"}, timeout=10)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    assert data["data"]["user"]["phone"] == phone
    assert data["data"]["user"]["id"].startswith("u-")
    assert "yxjia_sid" in session.cookies
    print(f"✓ 用户登录成功：{data['data']['user']['id']}")


def test_user_login_wrong_code():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"phone": "13900139998", "code": "000000"}, timeout=10)
    assert r.status_code == 400
    assert r.json()["success"] is False
    print("✓ 错验证码返回 400")


def test_user_login_invalid_phone():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"phone": "abc", "code": "123456"}, timeout=10)
    assert r.status_code == 400
    print("✓ 错手机号返回 400")


def test_send_code():
    r = requests.post(f"{BASE}/api/auth/send-code",
                      json={"phone": "13900139997"}, timeout=10)
    assert r.status_code == 200
    assert r.json()["success"] is True
    print("✓ send-code 接口返回成功")


def test_auth_me_requires_login():
    r = requests.get(f"{BASE}/api/auth/me", timeout=10)
    assert r.status_code == 401
    print("✓ 未登录访问 /api/auth/me 返回 401")


def test_auth_me_with_session():
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login",
           json={"phone": "13900139996", "code": "123456"}, timeout=10)
    r = s.get(f"{BASE}/api/auth/me", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["data"]["user"]["phone"] == "13900139996"
    print("✓ 登录后 /api/auth/me 返回用户")


def test_logout_clears_session():
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login",
           json={"phone": "13900139995", "code": "123456"}, timeout=10)
    # 已登录
    assert s.get(f"{BASE}/api/auth/me").status_code == 200
    # 登出
    r = s.post(f"{BASE}/api/auth/logout", timeout=10)
    assert r.status_code == 200
    # 登出后失效
    r2 = s.get(f"{BASE}/api/auth/me", timeout=10)
    assert r2.status_code == 401
    print("✓ 登出后 session 失效")


def test_users_uploads_only_self_or_admin():
    s = requests.Session()
    s.post(f"{BASE}/api/auth/login",
           json={"phone": "13900139994", "code": "123456"}, timeout=10)
    me = s.get(f"{BASE}/api/auth/me").json()
    my_id = me["data"]["user"]["id"]

    # 自己
    r = s.get(f"{BASE}/api/users/{my_id}/uploads", timeout=10)
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert isinstance(r.json()["data"]["uploads"], list)
    # 别人
    r2 = s.get(f"{BASE}/api/users/u-other-12345/uploads", timeout=10)
    assert r2.status_code == 403
    print("✓ /api/users/:id/uploads 权限隔离正确")


def test_upload_room_image_returns_url():
    """上传顾客客厅图，应返回 /uploads/rooms/{uuid}.jpg 形式 URL"""
    # 用一张已知的测试图（沙发商品图当客厅图也可，验证接口本身）
    img_path = "/Users/linan/Desktop/aicode/peilian/yxjia-mvp/public/images/sofa-zhongshi.jpg"
    with open(img_path, "rb") as f:
        r = requests.post(
            f"{BASE}/api/upload/room",
            files={"file": ("test.jpg", f, "image/jpeg")},
            timeout=30,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    url = data["data"]["url"]
    assert url.startswith("/uploads/rooms/"), url
    assert re.match(r"^/uploads/rooms/[0-9a-f]{16}\.jpg$", url), f"URL 格式不对：{url}"
    # 验证文件可访问
    r2 = requests.get(BASE + url, timeout=10)
    assert r2.status_code == 200
    assert r2.headers["content-type"].startswith("image/")
    print(f"✓ 上传客厅图成功：{url}")


def test_upload_product_image_creates_product():
    """上传新商品图，应自动追加到 products.json"""
    img_path = "/Users/linan/Desktop/aicode/peilian/yxjia-mvp/public/images/sofa-corner.jpg"
    with open(img_path, "rb") as f:
        r = requests.post(
            f"{BASE}/api/upload/product-image",
            files={"file": ("corner.jpg", f, "image/jpeg")},
            data={
                "name": "测试新沙发 pytest",
                "price": "¥2xxx 起",
                "size": "2.0 米",
                "category": "沙发",
            },
            timeout=30,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    p = data["data"]["product"]
    assert p["name"] == "测试新沙发 pytest"
    assert p["price"] == "¥2xxx 起"
    assert p["subtitle"] == "沙发"  # category
    assert p["size"] == "2.0 米"
    assert p["image"].startswith("/uploads/products/")

    # 校验产品已添加
    products = requests.get(f"{BASE}/api/products").json()["data"]["products"]
    assert any(pp["id"] == p["id"] for pp in products)
    print(f"✓ 上传商品成功：{p['id']} {p['name']}")


def test_tryon_ai_with_real_api():
    """调用 /api/tryon/ai，预期返回 compositionBase64 + compositionUrl

    有 TWO_FISH_API_KEY 时应返回 AI 出图；无 key 时进入兜底（保存原图）
    """
    room_path = "/Users/linan/Desktop/aicode/peilian/yxjia-mvp/public/images/sofa-zhongshi.jpg"
    sofa_path = "/Users/linan/Desktop/aicode/peilian/yxjia-mvp/public/images/sofa-corner.jpg"
    sess = _user_session()
    with open(room_path, "rb") as room_f, open(sofa_path, "rb") as sofa_f:
        r = sess.post(
            f"{BASE}/api/tryon/ai",
            files={
                "room": ("room.jpg", room_f, "image/jpeg"),
                "sofa": ("sofa.jpg", sofa_f, "image/jpeg"),
            },
            data={"productId": "sofa-1"},
            timeout=180,
        )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["success"] is True
    payload = data["data"]
    # 有 API key 时返回 AI 图；无 key 时 aiError 非空，compositionUrl=None 但兜底文件已落盘
    has_ai_result = payload["compositionBase64"] is not None or payload["compositionUrl"] is not None
    has_fallback = payload["aiError"] is not None
    assert has_ai_result or has_fallback, f"既无 AI 出图也无兜底：{payload}"
    print(f"✓ /api/tryon/ai: compositionUrl={payload['compositionUrl']}, aiError={payload['aiError']}, b64_len={len(payload.get('compositionBase64') or '')}")


def test_tryon_ai_missing_file():
    """缺文件应 400（已登录才轮到参数校验）"""
    r = _user_session().post(
        f"{BASE}/api/tryon/ai",
        data={"productId": "sofa-1"},
        timeout=10,
    )
    assert r.status_code == 400
    print("✓ 缺文件 /api/tryon/ai 返回 400")


def test_tryon_ai_missing_product_id():
    """缺 productId 应 400"""
    r = _user_session().post(
        f"{BASE}/api/tryon/ai",
        files={
            "room": ("a.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
            "sofa": ("b.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
        },
        timeout=10,
    )
    assert r.status_code == 400
    print("✓ 缺 productId 返回 400")


def test_tryon_ai_unknown_product():
    """未知 productId 应 404"""
    r = _user_session().post(
        f"{BASE}/api/tryon/ai",
        files={
            "room": ("a.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
            "sofa": ("b.jpg", b"\xff\xd8\xff\xe0", "image/jpeg"),
        },
        data={"productId": "no-such-product"},
        timeout=10,
    )
    assert r.status_code == 404
    print("✓ 未知商品返回 404")


def test_admin_login_page_renders_chinese():
    """/admin 页面含中文大字标题"""
    r = requests.get(f"{BASE}/admin", timeout=10)
    assert r.status_code == 200
    assert "后台登录" in r.text
    assert "登 录" in r.text
    print("✓ /admin 登录页大字标题正确")