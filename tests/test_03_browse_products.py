def test_view_sofa(page):
    page.goto("http://127.0.0.1:3000/")
    # v3 把产品列表改在 #furnGrid，由 loadProducts() 异步填充
    page.wait_for_selector("#furnGrid .furn-card", timeout=15000)
    page.wait_for_timeout(1500)

    sofa_product = page.locator("#furnGrid .furn-card", has_text="沙发").first
    assert sofa_product.is_visible()
    product_name = sofa_product.locator("h4").inner_text()
    assert "沙发" in product_name, f"期望沙发产品，实际 {product_name!r}"
    print(f"✓ 看到沙发产品：{product_name}")