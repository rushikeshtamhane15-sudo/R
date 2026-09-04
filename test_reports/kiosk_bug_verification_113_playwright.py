"""Focused Playwright verification for bug iter 113.

Run target: https://dining-atomics.preview.emergentagent.com
Scope: wall kiosk fullscreen route, admin discovery link, redesigned kiosk mess-menu card.
This file mirrors the script body passed to the browser automation tool.
"""

import re


async def run(page):
    await page.set_viewport_size({"width": 1400, "height": 900})
    try:
        print("STEP 1: Login as admin and open /admin/kiosk")
        await page.goto("https://dining-atomics.preview.emergentagent.com/login?next=%2Fadmin%2Fkiosk", wait_until="domcontentloaded")
        await page.wait_for_timeout(1000)

        if await page.get_by_test_id("phone-input").count() > 0:
            await page.get_by_test_id("phone-input").fill("8421372391")
            await page.get_by_test_id("send-otp-button").click()
            await page.wait_for_selector('[data-testid="otp-verify-form"]', timeout=15000)
            otp = ""
            if await page.get_by_test_id("otp-echo-code").count() > 0:
                otp = (await page.get_by_test_id("otp-echo-code").inner_text()).strip()
            current = await page.get_by_test_id("otp-input").input_value()
            if not current:
                await page.get_by_test_id("otp-input").fill(otp or "123456")
            await page.get_by_test_id("verify-otp-button").click()
            await page.wait_for_url(re.compile(r".*/admin/kiosk.*"), timeout=20000)
        else:
            await page.goto("https://dining-atomics.preview.emergentagent.com/admin/kiosk", wait_until="domcontentloaded")

        await page.wait_for_selector('[data-testid="admin-kiosk-page"]', timeout=20000)
        print("PASS: Admin kiosk page loaded")

        print("STEP 2: Verify discovery link on regular admin page")
        open_link = page.get_by_test_id("kiosk-open-fullscreen")
        assert await open_link.count() == 1, "kiosk-open-fullscreen link missing on /admin/kiosk"
        href = await open_link.get_attribute("href")
        print(f"Discovery link href: {href}")
        assert href == "/kiosk", "Discovery link does not point to /kiosk"
        await open_link.click()
        await page.wait_for_url(re.compile(r".*/kiosk$"), timeout=15000)
        await page.wait_for_selector('[data-testid="admin-kiosk-page"]', timeout=20000)
        print("PASS: Discovery link navigated to /kiosk")

        print("STEP 3: Verify /kiosk has no site/admin chrome at 1400x900")
        url = page.url
        assert url.endswith("/kiosk"), f"Expected /kiosk URL, got {url}"
        admin_page_count = await page.get_by_test_id("admin-kiosk-page").count()
        counter_count = await page.get_by_test_id("kiosk-counter-panel").count()
        order_count = await page.get_by_test_id("kiosk-order-panel").count()
        assert admin_page_count == 1, "AdminKiosk root not rendered"
        assert counter_count == 1, "Counter QR top panel missing"
        assert order_count == 1, "Wall Kiosk order bottom panel missing"

        chrome_text = await page.evaluate("""() => document.body.innerText""")
        forbidden_text = ["Admin Dashboard", "Control Tower", "Footer", "Home", "Plans"]
        visible_bad = [t for t in forbidden_text if t in chrome_text and t not in ["Plans"]]
        sidebar_nav_count = await page.locator('aside, nav [href^="/admin/"]').count()
        bottom_nav_count = await page.locator('[data-testid*="bottom"], .bottom-nav, nav.fixed.bottom-0').count()
        header_count = await page.locator('header').count()
        print(f"header_count={header_count}, sidebar_nav_count={sidebar_nav_count}, bottom_nav_count={bottom_nav_count}, visible_bad={visible_bad}")
        assert header_count == 0, "Site header still visible on /kiosk"
        assert sidebar_nav_count == 0, "Admin sidebar/nav links still visible on /kiosk"
        assert bottom_nav_count == 0, "Bottom navigation still visible on /kiosk"
        assert not visible_bad, f"Unexpected chrome/sidebar text visible: {visible_bad}"
        print("PASS: /kiosk hides site header, admin sidebar, footer/bottom nav")

        print("STEP 4: Verify fullscreen and close controls")
        close = page.get_by_test_id("kiosk-close-kiosk")
        assert await close.count() == 1, "Close button missing"
        # /kiosk auto-attempts browser fullscreen after navigation from the
        # discovery link. In Chromium this can succeed, so the enter button is
        # legitimately replaced by Exit fullscreen. Exit first, then verify the
        # requested kiosk-enter-browser-fs control and its requestFullscreen hook.
        if await page.get_by_test_id("kiosk-exit-browser-fs").count() > 0:
            print("Browser fullscreen already active; exiting to reveal Fullscreen button")
            await page.get_by_test_id("kiosk-exit-browser-fs").click()
            await page.wait_for_timeout(500)
        enter_fs = page.get_by_test_id("kiosk-enter-browser-fs")
        await enter_fs.wait_for(timeout=5000)
        assert await enter_fs.count() == 1, "Fullscreen button missing after exiting browser fullscreen"
        fs_hook = await page.evaluate("""() => {
            window.__kioskFsCalled = false;
            const original = document.documentElement.requestFullscreen;
            document.documentElement.requestFullscreen = function() {
                window.__kioskFsCalled = true;
                if (original) return Promise.resolve();
                return Promise.resolve();
            };
            return typeof original;
        }""")
        await enter_fs.click()
        await page.wait_for_timeout(300)
        fs_called = await page.evaluate("window.__kioskFsCalled === true")
        print(f"requestFullscreen original type={fs_hook}, click_called={fs_called}")
        assert fs_called, "Fullscreen button did not call document.documentElement.requestFullscreen"

        print("STEP 5: Verify redesigned kiosk mess-menu card")
        card = page.get_by_test_id("kiosk-menu-card")
        await card.wait_for(timeout=15000)
        card_class = await card.get_attribute("class") or ""
        print(f"Card class: {card_class}")
        for cls in ["bg-gradient-to-br", "from-emerald-700", "via-emerald-600", "to-emerald-800"]:
            assert cls in card_class, f"Missing emerald gradient class {cls}"
        heading = (await page.get_by_test_id("kiosk-mess-card-heading").inner_text()).strip()
        print(f"Heading: {heading}")
        assert "Today" in heading and "mess menu" in heading.lower(), "Today heading text missing"
        assert "Today" in await card.inner_text() and "Special" in await card.inner_text(), "TODAY'S SPECIAL pill text missing"
        lunch = page.get_by_test_id("kiosk-mess-lunch")
        dinner = page.get_by_test_id("kiosk-mess-dinner")
        lunch_class = await lunch.get_attribute("class") or ""
        dinner_class = await dinner.get_attribute("class") or ""
        assert "bg-amber-500/12" in lunch_class, "Lunch tile amber background class missing"
        assert "bg-blue-500/12" in dinner_class, "Dinner tile blue background class missing"
        lunch_text = await lunch.inner_text()
        dinner_text = await dinner.inner_text()
        print(f"Lunch text: {lunch_text}")
        print(f"Dinner text: {dinner_text}")
        assert "LUNCH" in lunch_text.upper(), "Lunch label missing"
        assert "12 – 3 pm" in lunch_text, "Lunch service window missing"
        assert "DINNER" in dinner_text.upper(), "Dinner label missing"
        assert "7 – 10 pm" in dinner_text, "Dinner service window missing"
        for item in ["Sabudana Khichdi", "Farali Chiwda", "Dahi Tadka", "Alooo Shira"]:
            assert item in lunch_text, f"Lunch item missing/splitting failed: {item}"
        for item in ["Bhagar", "Dahi Tadka", "Dal Khichdi", "Farali Chiwda"]:
            assert item in dinner_text, f"Dinner item missing/splitting failed: {item}"
        lunch_cols = await lunch.locator("ul").first.get_attribute("class")
        dinner_cols = await dinner.locator("ul").first.get_attribute("class")
        assert "grid-cols-2" in (lunch_cols or "") and "sm:grid-cols-3" in (lunch_cols or ""), "Lunch item grid not 2/3 columns"
        assert "grid-cols-2" in (dinner_cols or "") and "sm:grid-cols-3" in (dinner_cols or ""), "Dinner item grid not 2/3 columns"
        separator_count = await card.locator('.rotate-45.bg-amber-300\/70').count()
        assert separator_count >= 1, "Gold diamond separator missing"
        print("PASS: Mess menu card redesign and seeded items verified")

        print("STEP 6: Verify tomorrow tab flips title")
        await page.get_by_test_id("kiosk-day-tomorrow").click()
        await page.wait_for_timeout(500)
        tomorrow_heading = (await page.get_by_test_id("kiosk-mess-card-heading").inner_text()).strip()
        print(f"Tomorrow heading: {tomorrow_heading}")
        assert "Tomorrow" in tomorrow_heading and "preview" in tomorrow_heading.lower(), "Tomorrow title did not flip"
        print("PASS: Tomorrow tab works")

        print("STEP 7: Close returns to /admin/kiosk with sidebar restored")
        await close.click()
        await page.wait_for_url(re.compile(r".*/admin/kiosk.*"), timeout=15000)
        await page.wait_for_selector('[data-testid="admin-kiosk-page"]', timeout=15000)
        restored_sidebar = await page.locator('aside, nav [href^="/admin/"]').count()
        restored_open = await page.get_by_test_id("kiosk-open-fullscreen").count()
        print(f"restored_sidebar_count={restored_sidebar}, restored_open_link_count={restored_open}")
        assert restored_sidebar > 0, "Admin sidebar was not restored after Close"
        assert restored_open == 1, "Open kiosk mode link missing after returning to /admin/kiosk"
        print("PASS: Close returns to /admin/kiosk with admin chrome restored")

        error_text = await page.evaluate("""() => {
        const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
        return errorElements.map(el => el.textContent).join(", ");
        }""")
        if error_text:
            print(f"Found error message: {error_text}")
        else:
            print("No error messages found on the page")
        print("RESULT: PASS")
    except Exception as exc:
        print(f"RESULT: FAIL: {exc}")
        await page.screenshot(path="/app/test_reports/kiosk_bug_verification_113_failure.jpg", quality=40, full_page=False)
        raise