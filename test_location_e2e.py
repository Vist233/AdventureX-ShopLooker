#!/usr/bin/env python3
"""Local browser E2E for 店判 2.1.

The test keeps map/case APIs deterministic and deliberately denies microphone
access for the full-flow case. This verifies the required no-dead-end fallback
without sending audio or using production credentials.
"""

from __future__ import annotations

import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from playwright.sync_api import Page, Route, expect, sync_playwright


ROOT = Path(__file__).resolve().parent
ADDRESS = "上海市黄浦区南京东路300号"
API_COUNTS = {"turns": 0, "review": 0, "asr": 0}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: Any) -> None:
        return


class LocalSite:
    def __init__(self) -> None:
        handler = partial(QuietHandler, directory=str(ROOT))
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


def fulfill_json(route: Route, body: dict[str, Any], status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type="application/json; charset=utf-8",
        body=json.dumps(body, ensure_ascii=False),
    )


def api_fixture(route: Route) -> None:
    path = route.request.url.split("?", 1)[0]
    if path.endswith("/api/map/context") or path.endswith("/api/map/address-context"):
        fulfill_json(
            route,
            {
                "context": {
                    "location": {
                        "address": ADDRESS,
                        "city": "上海市",
                        "district": "黄浦区",
                    },
                    "nearby": {
                        "count": 2,
                        "places": [
                            {"title": "测试咖啡一店", "distance": 180},
                            {"title": "测试咖啡二店", "distance": 420},
                        ],
                    },
                    "landmarks": [{"title": "人民广场", "distance": 260}],
                }
            },
        )
        return
    if path.endswith("/api/map/ip-location"):
        fulfill_json(route, {"approximate": {"label": "上海市黄浦区"}})
        return
    if path.endswith("/api/cases") and route.request.method == "POST":
        fulfill_json(
            route,
            {
                "case": {"id": "case_e2e", "version": 1},
                "caseToken": "token_e2e",
            },
            201,
        )
        return
    if path.endswith("/api/cases/case_e2e/location"):
        fulfill_json(
            route,
            {
                "version": 2,
                "firstQuestion": {
                    "field": "goal",
                    "text": "你现在最想解决什么？",
                },
            },
        )
        return
    if path.endswith("/api/tts"):
        route.fulfill(status=204, body="")
        return
    if path.endswith("/api/cases/case_e2e/turns") and route.request.method == "POST":
        API_COUNTS["turns"] += 1
        payload = route.request.post_data_json
        expected_version = 1 + API_COUNTS["turns"]
        assert payload.get("expectedVersion") == expected_version
        if payload.get("questionId") == "goal":
            fact = {
                "id": "goal", "field": "goal", "kind": "text",
                "value": payload["answer"], "status": "provisional",
                "source": "voice", "evidence": "C",
                "transcript": payload["answer"],
            }
            next_question = {
                "field": "monthlyRevenue",
                "text": "这家店一个月大约收多少钱？",
                "kind": "money",
            }
        else:
            fact = {
                "id": "monthlyRevenue", "field": "monthlyRevenue",
                "kind": "money", "value": 120_000, "period": "month",
                "status": "provisional", "source": "voice", "evidence": "C",
                "transcript": payload["answer"],
            }
            next_question = {
                "field": "ordersDaily",
                "text": "普通一天大约有多少单？",
                "kind": "count",
            }
        fulfill_json(
            route,
            {
                "version": expected_version + 1,
                "extractedFacts": [fact],
                "nextQuestion": next_question,
                "complete": False,
            },
        )
        return
    if path.endswith("/api/cases/case_e2e/publish") and route.request.method == "POST":
        fulfill_json(route, {"publicId": "pub_e2e", "manageToken": "manage_e2e"}, 201)
        return
    if path.endswith("/api/cases/case_e2e/review") and route.request.method == "POST":
        API_COUNTS["review"] += 1
        payload = route.request.post_data_json
        assert payload.get("caseVersion") == 5
        fulfill_json(
            route,
            {
                "caseId": "case_e2e",
                "version": 6,
                "facts": payload.get("corrections", []),
            },
        )
        return
    if path.endswith("/api/cases/case_e2e/analyze") and route.request.method == "POST":
        # An empty successful response deliberately exercises the deterministic
        # local result renderer without producing an expected console error.
        fulfill_json(route, {})
        return
    fulfill_json(route, {"code": "UNEXPECTED", "message": path}, 500)


def attach_error_collection(page: Page) -> list[str]:
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on(
        "console",
        lambda message: errors.append(message.text) if message.type == "error" else None,
    )
    return errors


def confirm_manual_location(page: Page) -> None:
    page.locator('[data-stage="operating"]').click()
    page.locator("#category").fill("咖啡")
    page.locator("#manualLocation").fill(ADDRESS)
    page.locator("#useManualLocation").click()
    expect(page.locator("#mapSummary")).to_be_visible()
    expect(page.locator("#mapAddress")).to_have_text(ADDRESS)
    page.locator("#confirmLocation").click()
    expect(page.locator("#beginInterview")).to_be_enabled()


def enter_workspace(page: Page) -> None:
    page.locator('[data-testid="hero-start"]').click()
    expect(page.locator("body")).to_have_attribute("data-product-view", "workspace")
    expect(page.locator('[data-testid="location-step"]')).to_be_visible()


def test_landing_and_workspace_are_separate(browser, base_url: str) -> None:
    context = browser.new_context(base_url=base_url, locale="zh-CN")
    page = context.new_page()
    page.goto("/", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_attribute("data-product-view", "landing")
    expect(page.locator(".hero")).to_contain_text("5.8 万亿元")
    expect(page.locator(".hero")).to_contain_text("339 万家")
    expect(page.locator(".hero")).to_contain_text("65.1%")
    expect(page.locator("#judge")).to_be_hidden()
    enter_workspace(page)
    expect(page.locator(".hero")).to_be_hidden()
    context.close()


def test_location_and_text_fallback(browser, base_url: str) -> None:
    API_COUNTS["turns"] = 0
    API_COUNTS["review"] = 0
    context = browser.new_context(base_url=base_url, locale="zh-CN")
    context.route("**/api/**", api_fixture)
    page = context.new_page()
    errors = attach_error_collection(page)
    page.goto("/", wait_until="domcontentloaded")
    enter_workspace(page)

    confirm_manual_location(page)

    page.locator("#beginInterview").click()
    expect(page.locator('[data-panel="interview"]')).to_be_visible()
    expect(page.locator("#textFallback")).to_be_visible(timeout=8_000)
    expect(page.locator("#currentQuestion")).to_contain_text("最想解决")
    expect(page.locator("#questionProgress")).to_contain_text("第 1 / 6-12")

    page.locator("#fallbackAnswer").fill("最近亏损，想先止损")
    page.locator("#textFallback button[type=submit]").click()
    expect(page.locator("#currentQuestion")).to_contain_text("一个月", timeout=5_000)
    expect(page.locator("#questionProgress")).to_contain_text("第 2 / 6-12")
    page.locator("#previousQuestion").click()
    expect(page.locator("#currentQuestion")).to_contain_text("最想解决")
    expect(page.locator("#questionProgress")).to_contain_text("第 1 / 6-12")
    page.locator("#fallbackAnswer").fill("最近亏损，想先止损")
    page.locator("#textFallback button[type=submit]").click()
    expect(page.locator("#currentQuestion")).to_contain_text("一个月", timeout=5_000)
    expect(page.locator("#questionProgress")).to_contain_text("第 2 / 6-12")
    page.locator("#fallbackAnswer").fill("一个月大约十二万")
    page.locator("#textFallback button[type=submit]").click()
    page.evaluate("() => finishInterview()")
    expect(page.locator('[data-panel="review"]')).to_be_visible()

    rows = page.locator('[data-testid="fact-review-row"]')
    expect(rows).to_have_count(19)
    revenue_row = rows.filter(has_text="月营业额")
    category_row = rows.filter(has_text="经营品类")
    expect(revenue_row).to_be_visible()
    expect(category_row).to_be_visible()
    category_row.locator('input[value="unknown"]').check()
    revenue_row.locator('[data-role="edit-text"]').fill("大概不少")
    page.locator("#submitReview").click()
    expect(revenue_row.locator('[data-role="error"]')).to_contain_text("没有读到数字")
    assert API_COUNTS["review"] == 0
    revenue_row.locator('[data-role="edit-text"]').fill("一个月十到十二万")
    page.locator("#submitReview").click()
    expect(page.locator("#reviewSummary")).to_be_visible()
    assert API_COUNTS["review"] == 1, API_COUNTS
    reviewed = page.evaluate(
        """() => Object.fromEntries(state.facts.map((fact) => [fact.id, fact]))"""
    )
    assert reviewed["category"]["status"] == "unknown"
    assert reviewed["category"]["value"] is None
    assert reviewed["monthlyRevenue"]["range"] == {"min": 100_000, "max": 120_000}
    assert reviewed["monthlyRevenue"]["source"] == "typed"
    assert reviewed["monthlyRevenue"]["rawTranscript"] == "一个月十到十二万"
    assert API_COUNTS["turns"] == 3
    expect(page.locator('[data-panel="interview"]')).to_be_hidden()

    page.locator("#startAnalysis").click()
    expect(page.locator('[data-panel="result"]')).to_be_visible()
    expect(page.locator("#result")).to_be_visible(timeout=8_000)
    expect(page.locator(".plan-card")).to_have_count(2)
    page.locator(".plan-detail").first.click()
    expect(page.locator("#planDetailDialog")).to_be_visible()
    expect(page.locator("#planDetailMarkdown")).to_contain_text("成功线")
    assert API_COUNTS["review"] == 1
    if errors:
        raise AssertionError("页面产生错误：" + " | ".join(errors))
    context.close()


def test_gps_and_number_semantics(browser, base_url: str) -> None:
    context = browser.new_context(
        base_url=base_url,
        locale="zh-CN",
        permissions=["geolocation"],
        geolocation={"latitude": 31.2304, "longitude": 121.4737},
    )
    context.route("**/api/**", api_fixture)
    page = context.new_page()
    errors = attach_error_collection(page)
    page.goto("/", wait_until="domcontentloaded")
    enter_workspace(page)
    page.locator('[data-stage="preopen"]').click()
    page.locator("#category").fill("快餐")
    page.locator("#locateButton").click()
    expect(page.locator("#mapSummary")).to_be_visible()
    expect(page.locator("#mapCompetitors")).to_have_text("2 个")

    semantic = page.evaluate(
        """() => {
          const gross = parseNumericAnswer('毛利45%', 'rate');
          const range = parseNumericAnswer('十到十二万', 'money');
          const q = document.getElementById('currentQuestion');
          q.dataset.factId = 'rent';
          q.dataset.factKind = 'money';
          q.dataset.factLabel = '租金';
          const yearly = extractLocalFact('12万一年');
          return { gross, range, yearly };
        }"""
    )
    assert semantic["gross"]["value"] == 55
    assert semantic["range"]["range"] == {"min": 100_000, "max": 120_000}
    assert semantic["yearly"]["value"] == 120_000
    assert semantic["yearly"]["period"] == "year"
    spoken = page.evaluate(
        """() => ({
          monthly: parseNumericAnswer('一天大约四千，按一个月三十天大约十二万。', 'money'),
          earn: parseNumericAnswer('我一个月挣一万块', 'money'),
          labor: parseNumericAnswer('人工一个月一万八到一万九', 'money'),
          rentShorthand: parseNumericAnswer('房租一年两万七，不是一个月', 'money'),
          invest: parseNumericAnswer('一开始总共投了十三万左右。', 'money')
        })"""
    )
    assert spoken["monthly"]["value"] == 120_000
    assert spoken["earn"]["value"] == 10_000
    assert spoken["labor"]["range"] == {"min": 18_000, "max": 19_000}
    assert spoken["rentShorthand"]["value"] == 27_000
    assert spoken["invest"]["value"] == 130_000
    monthly_edit = page.evaluate(
        """() => parseEditedFact({
          id: 'rent', label: '租金', kind: 'money', value: 120000,
          period: 'year', status: 'confirmed'
        }, '每月一万元')"""
    )
    assert monthly_edit["value"] == 10_000
    assert monthly_edit["period"] == "month"
    if errors:
        raise AssertionError("页面产生错误：" + " | ".join(errors))
    context.close()


def test_mobile_review_layout(browser, base_url: str) -> None:
    context = browser.new_context(
        base_url=base_url,
        locale="zh-CN",
        viewport={"width": 390, "height": 844},
    )
    page = context.new_page()
    errors = attach_error_collection(page)
    page.goto("/", wait_until="domcontentloaded")
    enter_workspace(page)
    page.evaluate(
        """() => {
          state.stage = 'operating';
          state.facts = [
            { id: 'category', label: '经营品类', kind: 'text', value: '咖啡', status: 'confirmed', source: 'typed', evidence: 'B', raw: '咖啡' },
            { id: 'monthlyRevenue', label: '月营业额', kind: 'money', value: 120000, period: 'month', status: 'confirmed', source: 'voice', evidence: 'C', raw: '一个月十二万' },
            { id: 'cashReserve', label: '可用现金', kind: 'money', value: null, status: 'unknown', source: 'voice', evidence: 'U', raw: '' }
          ];
          prepareReview();
        }"""
    )
    expect(page.locator('[data-testid="fact-review-row"]')).to_have_count(19)
    expect(page.locator('[data-role="edit-text"]').first).to_have_attribute(
        "placeholder", "点这里直接改"
    )
    layout = page.evaluate(
        """() => ({
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          submitVisible: document.getElementById('submitReview').getBoundingClientRect().width > 0
        })"""
    )
    assert layout["scrollWidth"] <= layout["viewport"], layout
    assert layout["submitVisible"] is True
    if errors:
        raise AssertionError("手机查证页产生错误：" + " | ".join(errors))
    context.close()


def test_subtitle_case_demo(browser, base_url: str) -> None:
    context = browser.new_context(base_url=base_url, locale="zh-CN")
    page = context.new_page()
    errors = attach_error_collection(page)
    page.goto("/?demo=1&demoSpeed=40", wait_until="domcontentloaded")
    expect(page.locator("body")).to_have_class("demo-mode")
    expect(page.locator("#category")).to_have_value("私房小碗菜")
    expect(page.locator('[data-stage="operating"]')).to_have_class("selected")
    page.locator("#locateButton").click()
    expect(page.locator("#locationProof")).to_be_visible(timeout=3_000)
    expect(page.locator("#mapAddress")).to_contain_text("稷山县")
    page.locator("#beginInterview").click()
    expect(page.locator('[data-panel="review"]')).to_be_visible(timeout=12_000)
    rows = page.locator('[data-testid="fact-review-row"]')
    expect(rows).to_have_count(19)
    first_row = rows.first
    first_row.locator('input[value="unknown"]').click(force=True)
    expect(first_row).to_have_attribute("data-mode", "correct")
    page.locator("#submitReview").click()
    expect(page.locator("#result")).to_be_visible(timeout=10_000)
    expect(page.locator("#decisionTitle")).to_contain_text("座位与外卖")
    expect(page.locator(".plan-card")).to_have_count(2)
    if errors:
        raise AssertionError("Demo 页面产生错误：" + " | ".join(errors))
    context.close()


def main() -> None:
    with LocalSite() as site, sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            test_landing_and_workspace_are_separate(browser, site.url)
            test_location_and_text_fallback(browser, site.url)
            test_gps_and_number_semantics(browser, site.url)
            test_mobile_review_layout(browser, site.url)
            test_subtitle_case_demo(browser, site.url)
        finally:
            browser.close()
    print("browser E2E: location, fallback, full review, mobile layout, subtitle demo, Top3 and number semantics passed")


if __name__ == "__main__":
    main()
