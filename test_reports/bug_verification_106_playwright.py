"""
Focused browser checks for hamburger drawer/header/account hub bug verification.
Intended to be run in the preview environment with a 360x800 mobile viewport.
"""

async def run(page):
    await page.set_viewport_size({"width": 360, "height": 800})
    await page.goto("https://dining-pass-scan.preview.emergentagent.com", wait_until="networkidle")
    await page.get_by_test_id("menu-toggle-button").click()
    drawer = page.get_by_test_id("menu-drawer")
    await drawer.wait_for(state="visible")
    width = await drawer.evaluate("el => el.getBoundingClientRect().width")
    assert width <= 260, width
    await page.get_by_test_id("drawer-close").click()
    await drawer.wait_for(state="hidden")

    # Authentication: OTP dev mode echoes OTP in UI.
    await page.goto("https://dining-pass-scan.preview.emergentagent.com/login?next=/profile", wait_until="networkidle")
    await page.get_by_test_id("phone-input").fill("7777777777")
    await page.get_by_test_id("send-otp-button").click()
    await page.get_by_test_id("otp-input").wait_for(state="visible")
    await page.get_by_test_id("verify-otp-button").click()
    await page.wait_for_url("**/profile**")

    # Account hub/check edit routing.
    await page.get_by_test_id("hub-hero-card").wait_for(state="visible")
    await page.get_by_test_id("hub-edit-fab").click()
    await page.wait_for_url("**/profile?edit=1")