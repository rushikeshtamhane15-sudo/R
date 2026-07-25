"""
Focused Playwright verification script for iter 110 /self-scan redesign.

This script is saved as a test artifact; it was executed through the MCP
browser automation runner against the preview URL at a 360x780 viewport.
"""

async def run(page):
    await page.set_viewport_size({"width": 360, "height": 780})
    await page.goto("https://dining-pass-scan.preview.emergentagent.com/self-scan", wait_until="domcontentloaded")

    if "/login" in page.url:
        await page.get_by_test_id("phone-input").fill("9333333333")
        await page.get_by_test_id("send-otp-button").click()
        await page.get_by_test_id("otp-verify-form").wait_for(state="visible", timeout=15000)
        await page.get_by_test_id("verify-otp-button").click()

    await page.wait_for_url("**/self-scan", timeout=20000)
    await page.get_by_test_id("self-scan-page").wait_for(state="visible", timeout=15000)

    required = {
        "scan-trust-badge": "efoodcare · ghar se achha khana\n101% pure veg · zero adulteration · fssai certified",
        "scan-heading": "Scan & eat",
        "scan-cta-card": "Ready to dine?\nShow the kitchen counter the camera so it can read the QR sticker.\nOpen scanner\nView my e-meal pass QR",
        "scan-hindi-tagline": "हमारा खाना आपको पसंद आये ना आये आपके स्वास्थ्य (Health) को जरूर पसंद आयेगा",
    }
    for testid, expected_fragment in required.items():
        locator = page.get_by_test_id(testid)
        await locator.wait_for(state="visible", timeout=10000)
        text = (await locator.inner_text()).strip()
        assert expected_fragment in text, f"{testid} text mismatch: {text!r}"

    nav_ids = ["home", "restaurant", "scan", "subscribe", "profile"]
    nav_labels = []
    for nav_id in nav_ids:
        item = page.get_by_test_id(f"bottom-nav-{nav_id}")
        await item.wait_for(state="visible", timeout=10000)
        nav_labels.append((await item.inner_text()).strip())
    assert nav_labels == ["Home", "Restaurant", "Scan", "Subscribe", "Profile"]

    scan_nav = page.get_by_test_id("bottom-nav-scan")
    scan_box = await scan_nav.bounding_box()
    scan_circle_count = await scan_nav.locator("span.absolute.-top-5.h-14.w-14.rounded-full.bg-primary").count()
    assert scan_circle_count == 1, "Scan nav floating red circle not found"

    await page.get_by_test_id("self-start-scanner").click()
    try:
        await page.get_by_test_id("self-scan-live").wait_for(state="visible", timeout=2000)
        await page.locator("#self-qr-region").wait_for(state="attached", timeout=2000)
        await page.get_by_test_id("self-stop-scanner").wait_for(state="visible", timeout=2000)
        scanner_live_seen = True
        await page.get_by_test_id("self-stop-scanner").click()
        await page.get_by_test_id("self-scan-page").wait_for(state="visible", timeout=5000)
    except Exception:
        scanner_live_seen = False

    await page.get_by_test_id("view-emeal-pass-link").click()
    await page.wait_for_url("**/dashboard", timeout=10000)

    return {"nav_labels": nav_labels, "scan_nav_box": scan_box, "scanner_live_seen": scanner_live_seen, "final_url": page.url}