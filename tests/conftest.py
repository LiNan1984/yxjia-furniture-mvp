from pathlib import Path

import pytest
from playwright.sync_api import Page, sync_playwright


VIEWPORT = {"width": 390, "height": 844}
RESULTS_DIR = Path(__file__).parent.parent / "test-results"


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        yield browser
        browser.close()


@pytest.fixture
def page(browser, request):
    context = browser.new_context(viewport=VIEWPORT)
    current_page = context.new_page()
    yield current_page

    if getattr(request.node, "rep_call", None) and request.node.rep_call.failed:
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        current_page.screenshot(
            path=str(RESULTS_DIR / f"fail-{request.node.name}.png"),
            full_page=True,
        )
    context.close()


@pytest.hookimpl(hookwrapper=True, tryfirst=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    setattr(item, f"rep_{report.when}", report)
