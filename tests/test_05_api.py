import requests


def test_api_order_creation():
    """直接测 API，确认后端真的能创建订单"""
    response = requests.post(
        "http://127.0.0.1:3000/api/orders",
        json={
            "name": "测试",
            "phone": "13800138000",
            "productId": "sofa-1",
            "quantity": 1,
        },
        timeout=10,
    )
    assert response.status_code == 200, f"状态码 {response.status_code}: {response.text}"
    data = response.json()
    assert data.get("success") is True, f"响应: {data}"
    assert "data" in data and "order" in data["data"], f"订单数据缺失: {data}"
    order_id = data["data"]["order"]["id"]
    assert order_id.startswith("O"), f"订单 ID 格式不对: {order_id}"
    print(f"✓ 创建订单成功：{order_id}")

    # 按手机号查询订单
    r2 = requests.get(
        "http://127.0.0.1:3000/api/orders/by-phone/13800138000",
        timeout=10,
    )
    assert r2.status_code == 200
    orders = r2.json()["data"]["orders"]
    assert len(orders) > 0
    assert any(o["id"] == order_id for o in orders), "新建订单不在查询结果中"
    print(f"✓ 按手机号查询成功，找到 {len(orders)} 个订单")