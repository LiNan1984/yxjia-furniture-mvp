def test_homepage_loaded(page):
    page.goto("http://127.0.0.1:3000/")
    page.wait_for_timeout(1500)

    assert page.locator("text=银杏家具").count() > 0
    # 主页 v3 把产品列表改在 #furnGrid，至少要看到家具相关字样
    assert page.locator("text=沙发").count() > 0
