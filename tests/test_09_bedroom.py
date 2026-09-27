# v3 卧室板块 + 品类 tab 的老人视角 UI 冒烟（不覆盖既有 py 测试）
# 依赖：BASE=3000 的 yxjia server（playwright.config 的 webServer 会起，或手动起）
# 覆盖 testcases-v3 的 TC-F.1/F.2/F.3、TC-X.2（hero）、TC-G（JS 异常）
# 注意：不要再在本文件内 sync_playwright().start() —— pytest 的 per-test asyncio 循环里
# 不能嵌套 Sync API（报 "using Playwright Sync API inside the asyncio loop"）。
# 统一复用 conftest.py 的 session 级 browser + page fixture（与 test_01/07/08 一致，390x844 老人视角）。
from playwright.sync_api import Page

BASE = "http://127.0.0.1:3000"


def test_bedroom_sections_tabs_and_bed_filter(page: Page):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/", wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#catalogSections section", timeout=8000)

    titles = " ".join(page.locator("#catalogSections .section-title").all_inner_texts())
    assert "沙发" in titles, f"应出现沙发板块，实际标题: {titles}"
    assert "卧室" in titles, f"应出现卧室板块，实际标题: {titles}"

    tabs = page.locator("#catTabs .cat-tab").all_inner_texts()
    assert "沙发" in tabs, f"应有沙发 tab: {tabs}"
    assert any("卧室" in t for t in tabs), f"应有卧室 tab: {tabs}"

    # 点床 tab → 试摆选择器只剩床
    page.click('#catTabs .cat-tab[data-cat="bed"]')
    page.wait_for_timeout(250)
    cats = page.locator("#furnGrid .furn-card .cat").all_inner_texts()
    assert len(cats) >= 1 and all("卧室" in c for c in cats), f"点床 tab 后应只剩床: {cats}"
    assert "卧室" in page.locator("#catTabs .cat-tab.active").inner_text(), "床 tab 应高亮"

    # 搬回家按钮（品类名词驱动）+ hero 不再引用已删图
    takehome = page.locator("#catalogSections .take-home-btn").all_inner_texts()
    assert any("搬回家" in t for t in takehome), f"应有搬回家按钮: {takehome}"
    hero_src = page.get_attribute("#heroImg", "src") or ""
    assert "sofa-zhongshi" not in hero_src, f"hero 不应引用已删图: {hero_src}"

    assert not errors, f"页面出现 JS 异常: {errors}"


def test_category_tabs_present(page: Page):
    page.goto(f"{BASE}/", wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#catTabs .cat-tab", timeout=8000)
    assert page.locator("#catTabs .cat-tab").count() >= 3  # 全部 + 沙发 + 卧室


def test_default_room_missing_falls_back_to_upload(page: Page):
    # TC-B.3（决策 4）：卧室默认图 default-room-bed.jpg 素材未到位时，
    # 「用默认图体验」禁用 + 引导上传；沙发默认图在 → 不受影响；上传主路径仍可用
    page.goto(f"{BASE}/", wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#catTabs .cat-tab", timeout=8000)

    page.click('#catTabs .cat-tab[data-cat="sofa"]')
    page.wait_for_timeout(500)
    assert page.locator("#useDefaultBtn").is_disabled() is False, "沙发默认图存在，按钮应可用"

    page.click('#catTabs .cat-tab[data-cat="bed"]')
    page.wait_for_timeout(800)
    label = page.locator("#defaultBtnLabel").inner_text()
    assert page.locator("#useDefaultBtn").is_disabled() is True, "卧室默认图缺失，按钮应禁用"
    assert "上传" in label and "卧室" in label, f"应引导上传卧室照片: {label}"
    assert "default-room-bed" not in (page.locator("#roomPreview").get_attribute("src") or ""), \
        "不应引用缺失的卧室默认图"

    # 主路径：上传自家卧室照后预览正常显示
    page.set_input_files(
        'input[name="room"]',
        "/Users/linan/Desktop/aicode/peilian/yxjia-mvp/src/images/bed-double.jpg",
    )
    page.wait_for_timeout(400)
    assert page.locator("#roomPreview").evaluate("e=>getComputedStyle(e).display") != "none", \
        "上传后预览应显示"

