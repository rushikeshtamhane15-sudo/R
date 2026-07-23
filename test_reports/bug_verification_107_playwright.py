from pathlib import Path
from playwright.async_api import expect

PREVIEW_URL = "https://dining-pass-scan.preview.emergentagent.com"
PHONE = "9333333333"
SESSION_TOKEN = Path("/app/test_reports/bug107_session_token.txt").read_text().strip()


async def run(page):
    results = {"checks": [], "failures": [], "measurements": {}, "routes": {}}

    def ok(name, data=None):
        print(f"PASS: {name} {data or ''}")
        results["checks"].append({"name": name, "data": data})

    def fail(name, data=None):
        print(f"FAIL: {name} {data or ''}")
        results["failures"].append({"name": name, "data": data})

    async def dismiss_overlays():
        try:
            await page.evaluate("sessionStorage.setItem('efc_splash_seen_v2','1')")
        except Exception:
            pass
        for sel in [
            '[data-testid="restaurant-closed-modal"] button',
            'button:has-text("Close")',
            'button[aria-label="Close"]',
            '[data-testid="drawer-close"]',
        ]:
            try:
                loc = page.locator(sel).first
                if await loc.count() and await loc.is_visible(timeout=500):
                    await loc.click(force=True)
                    await page.wait_for_timeout(250)
            except Exception:
                pass

    async def ensure_drawer_open():
        await dismiss_overlays()
        btn = page.get_by_test_id("menu-toggle-button")
        await expect(btn).to_be_visible(timeout=10000)
        await btn.click(force=True)
        await page.wait_for_timeout(700)
        await expect(page.get_by_test_id("menu-drawer")).to_be_visible(timeout=10000)

    async def ensure_drawer_closed():
        try:
            if await page.get_by_test_id("menu-drawer").is_visible(timeout=500):
                await page.get_by_test_id("drawer-close").click(force=True)
                await page.wait_for_timeout(350)
        except Exception:
            pass

    try:
        await page.set_viewport_size({"width": 360, "height": 780})
        # OTP UI was exercised first, but the shared preview phone hit the OTP
        # rate-limit. For the focused frontend bug verification, continue with
        # an authenticated session seeded for the exact required user.
        await page.context.add_cookies([{
            "name": "session_token",
            "value": SESSION_TOKEN,
            "domain": "dining-pass-scan.preview.emergentagent.com",
            "path": "/",
            "httpOnly": True,
            "secure": True,
            "sameSite": "None",
        }])
        await page.goto(PREVIEW_URL + "/dashboard", wait_until="domcontentloaded")
        await page.evaluate("sessionStorage.setItem('efc_splash_seen_v2','1')")
        await page.wait_for_load_state("networkidle", timeout=20000)
        try:
            await page.wait_for_selector('[data-testid="splash-screen"]', state='detached', timeout=4000)
        except Exception:
            pass
        await dismiss_overlays()
        ok("authenticated seeded subscriber session reached dashboard", {"url": page.url, "phone": PHONE})

        # Header: tagline and mess pill should be present and not clipped at 360w.
        await expect(page.get_by_test_id("app-header")).to_be_visible(timeout=10000)
        await expect(page.get_by_test_id("header-tagline")).to_be_visible(timeout=10000)
        await expect(page.get_by_test_id("mess-switcher-pill")).to_be_visible(timeout=15000)
        header_metrics = await page.evaluate("""() => {
            const m = (sel) => {
              const el = document.querySelector(sel);
              if (!el) return null;
              const r = el.getBoundingClientRect();
              const cs = getComputedStyle(el);
              return {text: el.textContent.trim(), x:r.x, y:r.y, w:r.width, h:r.height,
                      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
                      fontSize: cs.fontSize, overflow: cs.overflow, textOverflow: cs.textOverflow};
            };
            const pill = document.querySelector('[data-testid="mess-switcher-pill"] span');
            const header = document.querySelector('[data-testid="app-header"]').getBoundingClientRect();
            return {tagline:m('[data-testid="header-tagline"]'), brand:m('[data-testid="header-brand-name"]'),
                    mess:m('[data-testid="mess-switcher-pill"]'), messText:m('[data-testid="mess-switcher-pill"] span'),
                    wallet:m('[data-testid="wallet-pill"]'), menu:m('[data-testid="menu-toggle-button"]'), headerW:header.width,
                    pillTitle: document.querySelector('[data-testid="mess-switcher-pill"]')?.getAttribute('title') || null,
                    pillSpanText: pill?.textContent?.trim() || null};
        }""")
        results["measurements"]["header"] = header_metrics
        tagline_ok = header_metrics["tagline"] and "GHAR SE ACHHA KHANA" in header_metrics["tagline"]["text"].upper() and header_metrics["tagline"]["scrollWidth"] <= header_metrics["tagline"]["clientWidth"] + 1
        mess_text = (header_metrics.get("messText") or {}).get("text", "")
        mess_ok = "Amravati" in mess_text and header_metrics["messText"]["scrollWidth"] <= header_metrics["messText"]["clientWidth"] + 1
        wallet_text = await page.get_by_test_id("wallet-pill-balance").inner_text(timeout=10000)
        wallet_ok = "2,707" in wallet_text or "2707" in wallet_text.replace(",", "")
        if tagline_ok:
            ok("header tagline visible without overflow", header_metrics["tagline"])
        else:
            fail("header tagline clipped/missing", header_metrics["tagline"])
        if mess_ok:
            ok("mess switcher shows full Amravati without overflow", header_metrics["messText"])
        else:
            fail("mess switcher does not show full Amravati", header_metrics)
        if wallet_ok:
            ok("wallet pill shows subscribed balance", {"text": wallet_text})
        else:
            fail("wallet pill balance incorrect", {"text": wallet_text})

        # Dashboard alignment: QR ticket and wallet card same max width/centered.
        await expect(page.get_by_test_id("qr-ticket")).to_be_visible(timeout=15000)
        await expect(page.get_by_test_id("wallet-card")).to_be_visible(timeout=15000)
        dash_metrics = await page.evaluate("""() => {
            const q = document.querySelector('[data-testid="qr-ticket"]');
            const w = document.querySelector('[data-testid="wallet-card"]');
            const parentQ = q?.parentElement?.getBoundingClientRect();
            const parentW = w?.parentElement?.getBoundingClientRect();
            const qr = q?.getBoundingClientRect();
            const wallet = w?.getBoundingClientRect();
            return {qr:{x:qr.x,y:qr.y,w:qr.width,h:qr.height,cx:qr.x+qr.width/2},
                    wallet:{x:wallet.x,y:wallet.y,w:wallet.width,h:wallet.height,cx:wallet.x+wallet.width/2},
                    parentQ:{x:parentQ.x,w:parentQ.width,cx:parentQ.x+parentQ.width/2},
                    parentW:{x:parentW.x,w:parentW.width,cx:parentW.x+parentW.width/2}, viewport: window.innerWidth};
        }""")
        results["measurements"]["dashboard"] = dash_metrics
        width_ok = abs(dash_metrics["qr"]["w"] - dash_metrics["wallet"]["w"]) <= 2 and dash_metrics["qr"]["w"] <= 282 and dash_metrics["wallet"]["w"] <= 282
        center_ok = abs(dash_metrics["qr"]["cx"] - 180) <= 3 and abs(dash_metrics["wallet"]["cx"] - 180) <= 3 and abs(dash_metrics["qr"]["cx"] - dash_metrics["wallet"]["cx"]) <= 2
        if width_ok and center_ok:
            ok("dashboard QR and wallet are same constrained centered width", dash_metrics)
        else:
            fail("dashboard QR/wallet alignment mismatch", dash_metrics)

        await page.screenshot(path="/app/test_reports/bug_verification_107_dashboard_header.jpg", quality=40, full_page=False)

        # Drawer sizing.
        await ensure_drawer_open()
        drawer_metrics = await page.evaluate("""() => {
            const row = document.querySelector('[data-testid="drawer-item-restaurant"] > span');
            const icon = document.querySelector('[data-testid="drawer-item-restaurant"] > span > span');
            const text = document.querySelector('[data-testid="drawer-item-restaurant"] > span > span:nth-child(2)');
            const section = document.querySelector('[data-testid="drawer-section-eat"] > p');
            const quick = document.querySelector('[data-testid="drawer-quick-pass"] > span');
            const drawer = document.querySelector('[data-testid="menu-drawer"]');
            const rect = (el) => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
            const cs = (el) => { const s = getComputedStyle(el); return {fontSize:s.fontSize,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,gap:s.gap}; };
            return {drawer:rect(drawer), row:{...rect(row), ...cs(row)}, icon:rect(icon), text:{...rect(text), ...cs(text)}, section:{...rect(section), ...cs(section)}, quick:rect(quick)};
        }""")
        results["measurements"]["drawer"] = drawer_metrics
        drawer_size_ok = (
            abs(drawer_metrics["icon"]["w"] - 28) <= 1 and abs(drawer_metrics["icon"]["h"] - 28) <= 1 and
            abs(float(drawer_metrics["text"]["fontSize"].replace("px", "")) - 13) <= 0.6 and
            abs(float(drawer_metrics["section"]["fontSize"].replace("px", "")) - 11) <= 0.6 and
            abs(drawer_metrics["quick"]["h"] - 60) <= 1 and
            abs(float(drawer_metrics["row"]["paddingTop"].replace("px", "")) - 10) <= 1 and
            abs(float(drawer_metrics["row"]["paddingBottom"].replace("px", "")) - 10) <= 1
        )
        if drawer_size_ok:
            ok("hamburger drawer mobile sizing is tightened", drawer_metrics)
        else:
            fail("hamburger drawer sizing does not match expected compact metrics", drawer_metrics)
        await page.screenshot(path="/app/test_reports/bug_verification_107_drawer.jpg", quality=40, full_page=False)

        # Routing from each drawer item. Reopen drawer after every navigation.
        route_expectations = [
            ("drawer-item-restaurant", "/restaurant", ""),
            ("drawer-item-plans", "/plans", ""),
            ("drawer-item-mess-menu", "/dashboard", ""),
            ("drawer-item-tiffin-prefs", "/dashboard", ""),
            ("drawer-item-emeal-pass", "/dashboard", ""),
            ("drawer-item-orders", "/restaurant/orders", ""),
            ("drawer-item-edit-profile", "/profile", "?edit=1"),
            ("drawer-item-branches", "/contact", ""),
            ("drawer-item-rider", "/become-a-rider", ""),
            ("drawer-item-about", "/about", ""),
            ("drawer-item-contact", "/contact", ""),
            ("drawer-item-privacy", "/privacy", ""),
            ("drawer-item-refund", "/refund", ""),
        ]
        await ensure_drawer_closed()
        await page.goto(PREVIEW_URL + "/dashboard", wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle", timeout=20000)
        await dismiss_overlays()
        for testid, expected_path, expected_search in route_expectations:
            await ensure_drawer_open()
            terms_count = await page.get_by_test_id("drawer-item-terms").count()
            if terms_count == 0:
                results["routes"]["drawer-item-terms"] = "removed"
            else:
                fail("drawer-item-terms still present", {"count": terms_count})
            item = page.get_by_test_id(testid)
            await expect(item).to_be_visible(timeout=10000)
            await item.click(force=True)
            await page.wait_for_timeout(900)
            await page.wait_for_load_state("domcontentloaded", timeout=15000)
            loc = await page.evaluate("() => ({pathname: window.location.pathname, search: window.location.search, href: window.location.href})")
            results["routes"][testid] = loc
            if loc["pathname"] == expected_path and (not expected_search or loc["search"] == expected_search):
                ok(f"{testid} routes correctly", loc)
            else:
                fail(f"{testid} route mismatch", {"expected_path": expected_path, "expected_search": expected_search, "actual": loc})
            await page.goto(PREVIEW_URL + "/dashboard", wait_until="domcontentloaded")
            await page.evaluate("sessionStorage.setItem('efc_splash_seen_v2','1')")
            await page.wait_for_load_state("networkidle", timeout=20000)
            await dismiss_overlays()

        # Final explicit terms removal verification.
        await ensure_drawer_open()
        terms_count = await page.get_by_test_id("drawer-item-terms").count()
        if terms_count == 0:
            ok("drawer-item-terms removed")
        else:
            fail("drawer-item-terms still present at final check", {"count": terms_count})

        # Get error messages using specific selectors
        error_text = await page.evaluate("""() => {
        const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
        return errorElements.map(el => el.textContent).join(", ");
        }""")
        if error_text:
            print(f"Found error message: {error_text}")
            results["error_text"] = error_text
        else:
            print("No error messages found on the page")

    except Exception as e:
        fail("test script exception", repr(e))

    print("RESULT_JSON_START")
    import json
    print(json.dumps(results, indent=2, sort_keys=True))
    print("RESULT_JSON_END")
    if results["failures"]:
        raise AssertionError(f"Failures: {results['failures']}")
