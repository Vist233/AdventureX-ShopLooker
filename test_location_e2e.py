#!/usr/bin/env python3
"""Browser E2E coverage for the location step.

The default mode starts a local static server and replaces only the Tencent-map
HTTP boundary with deterministic responses.  Pass ``--base-url`` to exercise a
deployed build, and add ``--live-api`` to keep the real map endpoints enabled.

Run:
    eval "$(pyenv init - zsh)"
    pyenv shell Agent
    python test_location_e2e.py

Production smoke test:
    python test_location_e2e.py \
      --base-url https://yongge.zhangyvjing.com \
      --live-api
"""

from __future__ import annotations

import argparse
import json
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import (
    Browser,
    BrowserContext,
    Page,
    Route,
    TimeoutError as PlaywrightTimeoutError,
    expect,
    sync_playwright,
)


PROJECT_DIR = Path(__file__).resolve().parent
TEST_COORDINATES = {"latitude": 31.2304, "longitude": 121.4737}
TEST_CATEGORY = "咖啡"
TEST_ADDRESS = "上海市黄浦区南京东路300号"

MAP_CONTEXT = {
    "context": {
        "source": "腾讯位置服务",
        "coordinateSystem": "GCJ-02",
        "location": {
            "address": TEST_ADDRESS,
            "province": "上海市",
            "city": "上海市",
            "district": "黄浦区",
            "adcode": "310101",
        },
        "nearby": {
            "keyword": TEST_CATEGORY,
            "radiusMeters": 800,
            "count": 2,
            "places": [
                {"title": "测试咖啡一店", "category": "咖啡厅", "distance": 180},
                {"title": "测试咖啡二店", "category": "咖啡厅", "distance": 420},
            ],
        },
        "landmarks": [
            {"title": "人民广场", "category": "地名地址", "distance": 260}
        ],
    }
}

# The redundant top-level shapes intentionally make the boundary fixture
# compatible with both the original endpoint draft and its final normalized
# response.  The UI should still use the value only as an approximate prefill.
IP_LOCATION = {
    "source": "腾讯位置服务",
    "accuracy": "city",
    "precise": False,
    "location": {
        "province": "上海市",
        "city": "上海市",
        "district": "黄浦区",
        "label": "上海市黄浦区",
    },
    "approximate": {
        "province": "上海市",
        "city": "上海市",
        "district": "黄浦区",
        "label": "上海市黄浦区",
    },
    "context": {
        "accuracy": "city",
        "precise": False,
        "location": {
            "province": "上海市",
            "city": "上海市",
            "district": "黄浦区",
            "label": "上海市黄浦区",
        },
    },
}

REQUIRED_SELECTORS = (
    "#judge",
    '[data-stage="operating"]',
    "#category",
    "#locateButton",
    "#locationStatus",
    "#manualLocationDetails",
    "#manualLocation",
    "#useManualLocation",
    "#mapSummary",
    "#locationNext",
)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return


class LocalSite:
    def __init__(self, directory: Path) -> None:
        handler = partial(QuietHandler, directory=str(directory))
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        host, port = self.server.server_address
        return f"http://{host}:{port}/"

    def __enter__(self) -> "LocalSite":
        self.thread.start()
        return self

    def __exit__(self, *_args: Any) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class ApiFixture:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.unexpected: list[str] = []

    def handle(self, route: Route) -> None:
        parsed = urlparse(route.request.url)
        call = {
            "path": parsed.path,
            "query": parse_qs(parsed.query),
            "method": route.request.method,
        }
        self.calls.append(call)

        if parsed.path == "/api/map/context":
            self._json(route, MAP_CONTEXT)
            return
        if parsed.path == "/api/map/ip-location":
            self._json(route, IP_LOCATION)
            return
        if parsed.path == "/api/map/address-context":
            self._json(route, MAP_CONTEXT)
            return

        self.unexpected.append(parsed.path)
        self._json(
            route,
            {"code": "UNEXPECTED_TEST_ROUTE", "message": parsed.path},
            status=500,
        )

    @staticmethod
    def _json(route: Route, body: dict[str, Any], status: int = 200) -> None:
        route.fulfill(
            status=status,
            content_type="application/json; charset=utf-8",
            body=json.dumps(body, ensure_ascii=False),
        )

    def calls_for(self, path: str) -> list[dict[str, Any]]:
        return [call for call in self.calls if call["path"] == path]


def check_contract(page: Page) -> None:
    missing = [
        selector for selector in REQUIRED_SELECTORS
        if page.locator(selector).count() != 1
    ]
    if missing:
        raise AssertionError(
            "页面尚未满足定位 E2E 契约，缺少或重复的选择器："
            + ", ".join(missing)
        )


def collect_page_errors(page: Page) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error" else None,
    )
    return errors


def enter_location_step(page: Page) -> None:
    page.goto("/", wait_until="domcontentloaded")
    check_contract(page)
    page.locator('[data-stage="operating"]').click()
    expect(page.locator('[data-step="2"]')).to_be_visible()
    page.locator("#category").fill(TEST_CATEGORY)


def assert_no_errors(errors: list[str], flow: str) -> None:
    if errors:
        raise AssertionError(f"{flow} 出现浏览器错误：" + " | ".join(errors))


def run_gps_success(
    browser: Browser,
    base_url: str,
    live_api: bool,
    headed: bool,
) -> None:
    del headed  # The browser was already launched with this option.
    context = browser.new_context(
        base_url=base_url,
        permissions=["geolocation"],
        geolocation=TEST_COORDINATES,
        locale="zh-CN",
    )
    fixture = ApiFixture()
    if not live_api:
        context.route("**/api/map/**", fixture.handle)
    page = context.new_page()
    errors = collect_page_errors(page)

    try:
        enter_location_step(page)
        page.locator("#locateButton").click()

        expect(page.locator("#locationStatus")).to_have_class(
            re.compile(r"\bsuccess\b"), timeout=15_000
        )
        expect(page.locator("#mapSummary")).to_be_visible()
        expect(page.locator("#locationNext")).to_be_enabled()
        expect(page.locator("#mapAddress")).not_to_have_text("—")

        if not live_api:
            calls = fixture.calls_for("/api/map/context")
            if len(calls) != 1:
                raise AssertionError(f"GPS 流应调用一次地图上下文，实际 {len(calls)} 次")
            query = calls[0]["query"]
            if query.get("category") != [TEST_CATEGORY]:
                raise AssertionError(f"品类未传入地图接口：{query}")
            if "lat" not in query or "lng" not in query:
                raise AssertionError(f"GPS 经纬度未传入地图接口：{query}")
            if fixture.unexpected:
                raise AssertionError(f"出现未知地图请求：{fixture.unexpected}")

        assert_no_errors(errors, "GPS 成功流")
        print("✓ GPS 成功 → 地图上下文 → 下一步可用")
    finally:
        context.close()


def geolocation_error_script(code: int) -> str:
    return """
Object.defineProperty(window.navigator, "geolocation", {
  configurable: true,
  value: {
    getCurrentPosition: (_success, error) => {
      setTimeout(() => error({
        code: __CODE__,
        message: "Position unavailable",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3
      }), 0);
    },
    watchPosition: () => 1,
    clearWatch: () => {}
  }
});
""".replace("__CODE__", str(code))


def run_geolocation_fallback(
    browser: Browser,
    base_url: str,
    live_api: bool,
    headed: bool,
    test_address: str,
    error_code: int,
) -> None:
    del headed
    context: BrowserContext = browser.new_context(base_url=base_url, locale="zh-CN")
    context.add_init_script(geolocation_error_script(error_code))
    fixture = ApiFixture()
    if not live_api:
        context.route("**/api/map/**", fixture.handle)
    page = context.new_page()
    errors = collect_page_errors(page)

    try:
        enter_location_step(page)
        page.locator("#locateButton").click()

        page.wait_for_function(
            "document.querySelector('#manualLocationDetails')?.open === true",
            timeout=15_000,
        )
        manual = page.locator("#manualLocation")
        expect(manual).not_to_have_value("", timeout=15_000)
        approximate_value = manual.input_value()
        if live_api:
            if len(approximate_value.strip()) < 2:
                raise AssertionError("网络定位没有提供可用的城市级预填")
        elif not re.search(r"上海|黄浦", approximate_value):
            raise AssertionError(f"近似城市未预填到地址框：{approximate_value!r}")

        # City/IP approximation must not by itself authorize the next step.
        expect(page.locator("#locationNext")).to_be_disabled()
        page.locator("#useManualLocation").click()
        expect(page.locator("#locationNext")).to_be_disabled()
        expect(page.locator("#locationStatus")).to_have_class(
            re.compile(r"\bnotice\b")
        )
        if not live_api and fixture.calls_for("/api/map/address-context"):
            raise AssertionError("城市级网络预填不应触发店铺地址解析")

        manual.fill(test_address)
        page.locator("#useManualLocation").click()

        expect(page.locator("#locationStatus")).to_have_class(
            re.compile(r"\bsuccess\b"), timeout=15_000
        )
        expect(page.locator("#mapSummary")).to_be_visible()
        expect(page.locator("#locationNext")).to_be_enabled()
        expect(page.locator("#mapAddress")).not_to_have_text("—")

        if not live_api:
            ip_calls = fixture.calls_for("/api/map/ip-location")
            address_calls = fixture.calls_for("/api/map/address-context")
            if len(ip_calls) != 1:
                raise AssertionError(
                    f"定位 code-{error_code} 后应调用一次网络定位，实际 {len(ip_calls)} 次"
                )
            if len(address_calls) != 1:
                raise AssertionError(
                    f"精确地址应解析一次，实际 {len(address_calls)} 次"
                )
            query = address_calls[0]["query"]
            if query.get("address") != [test_address]:
                raise AssertionError(f"精确地址未传入地图接口：{query}")
            if query.get("category") != [TEST_CATEGORY]:
                raise AssertionError(f"品类未传入地址解析接口：{query}")
            if fixture.unexpected:
                raise AssertionError(f"出现未知地图请求：{fixture.unexpected}")

        assert_no_errors(errors, "定位失败降级流")
        print(
            f"✓ 定位 code-{error_code} → 城市级预填（不可直接放行）"
            " → 精确地址解析 → 下一步可用"
        )
    finally:
        context.close()


def normalize_base_url(url: str) -> str:
    return url if url.endswith("/") else f"{url}/"


def run(base_url: str, live_api: bool, headed: bool, test_address: str) -> None:
    if live_api and urlparse(base_url).hostname in {"127.0.0.1", "localhost"}:
        raise ValueError("--live-api 需要一个实现地图 API 的部署地址")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not headed)
        try:
            run_gps_success(browser, base_url, live_api, headed)
            error_codes = (2,) if live_api else (1, 2, 3)
            for error_code in error_codes:
                run_geolocation_fallback(
                    browser,
                    base_url,
                    live_api,
                    headed,
                    test_address,
                    error_code,
                )
        finally:
            browser.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="店判定位步骤的浏览器端到端测试"
    )
    parser.add_argument(
        "--base-url",
        help="待测部署地址；不传时自动启动本地静态站点",
    )
    parser.add_argument(
        "--live-api",
        action="store_true",
        help="使用部署中的真实腾讯地图接口，而不是确定性测试响应",
    )
    parser.add_argument(
        "--headed",
        action="store_true",
        help="显示浏览器窗口，便于观察交互",
    )
    parser.add_argument(
        "--test-address",
        default=TEST_ADDRESS,
        help="地址解析流程使用的测试地址",
    )
    args = parser.parse_args()

    try:
        if args.base_url:
            run(
                normalize_base_url(args.base_url),
                args.live_api,
                args.headed,
                args.test_address,
            )
        else:
            with LocalSite(PROJECT_DIR) as site:
                run(site.url, args.live_api, args.headed, args.test_address)
    except (AssertionError, PlaywrightTimeoutError, ValueError) as error:
        print(f"✗ E2E 失败：{error}")
        return 1

    print("定位 E2E 全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
