def test_call_button(page):
    page.goto("http://127.0.0.1:3000/")
    page.wait_for_timeout(800)

    call_btn = page.locator('a[href="tel:13359140982"]').first
    assert call_btn.is_visible()
    assert call_btn.get_attribute("href") == "tel:13359140982"
