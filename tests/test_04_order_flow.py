def test_create_order(page):
    # v3 首页把产品列表改成 #furnGrid，点选不跳转；直接访问详情页
    page.goto("http://127.0.0.1:3000/product/sofa-1")
    page.wait_for_timeout(1500)

    order_btn = page.get_by_text("我要这个", exact=True).first
    assert order_btn.is_visible()
    page.wait_for_timeout(1000)
    order_btn.click()
    page.wait_for_timeout(800)

    page.locator("#name").fill("李大爷")
    page.locator("#phone").fill("13800138000")

    submit = page.locator('button[type="submit"]').first
    assert submit.is_visible()
    page.wait_for_timeout(1200)
    submit.click()
    page.wait_for_timeout(2000)

    assert "order" in page.url or page.locator("text=成功").count() > 0
