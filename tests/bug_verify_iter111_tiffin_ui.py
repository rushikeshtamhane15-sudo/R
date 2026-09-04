BASE = 'https://dining-atomics.preview.emergentagent.com'
PHONE_ACTIVE = '9333333333'

async def collect_errors(page):
    error_text = await page.evaluate("""() => {
    const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
    return errorElements.map(el => el.textContent).join(", ");
    }""")
    if error_text:
        print(f"Found error message: {error_text}")
    else:
        print("No error messages found on the page")

async def login_phone(page, phone, name='Bug Verify User'):
    await page.goto(BASE + '/login')
    await page.wait_for_selector('[data-testid="phone-input"]', timeout=15000)
    await page.fill('[data-testid="phone-input"]', phone)
    await page.fill('[data-testid="name-input"]', name)
    await page.click('[data-testid="send-otp-button"]')
    await page.wait_for_selector('[data-testid="otp-input"]', timeout=15000)
    otp = await page.locator('[data-testid="otp-echo-code"]').inner_text()
    await page.fill('[data-testid="otp-input"]', otp.strip())
    await page.click('[data-testid="verify-otp-button"]')
    await page.wait_for_load_state('networkidle')
    await page.wait_for_timeout(1500)

try:
    await page.set_viewport_size({'width': 360, 'height': 844})
    await login_phone(page, PHONE_ACTIVE, 'Tiffin Verify')
    await page.goto(BASE + '/dashboard')
    await page.wait_for_selector('[data-testid="subscriber-dashboard"]', timeout=20000)
    await page.wait_for_selector('[data-testid="tiffin-dashboard-grid"]', timeout=20000)
    await page.wait_for_selector('[data-testid="tiffin-tracker-wrapper"]', timeout=20000)
    await page.wait_for_selector('[data-testid="tiffin-tracking-info"]', timeout=20000)
    wrapper = await page.locator('[data-testid="tiffin-tracker-wrapper"]').bounding_box()
    info = await page.locator('[data-testid="tiffin-tracking-info"]').bounding_box()
    grid = await page.locator('[data-testid="tiffin-dashboard-grid"]').bounding_box()
    wrapper_class = await page.locator('[data-testid="tiffin-tracker-wrapper"]').get_attribute('class')
    grid_class = await page.locator('[data-testid="tiffin-dashboard-grid"]').get_attribute('class')
    ok = (wrapper and info and grid and abs(wrapper['width'] - grid['width']) <= 2 and abs(info['width'] - grid['width']) <= 2 and wrapper['width'] <= 282 and 'max-w-[280px]' in (wrapper_class or '') and 'mx-auto' in (wrapper_class or ''))
    print(f"tiffin tracking alignment: {'PASS' if ok else 'FAIL'}", {'wrapper': wrapper, 'info': info, 'grid': grid, 'wrapper_class': wrapper_class, 'grid_class': grid_class})
    await collect_errors(page)
    if not ok:
        await page.screenshot(path='/app/test_reports/bug_verify_iter111_tiffin_failure.jpg', quality=40, full_page=False)
        raise AssertionError('tiffin tracking alignment failed')
except Exception as e:
    print(f'Tiffin UI check failed: {e}')
    try:
        await collect_errors(page)
        await page.screenshot(path='/app/test_reports/bug_verify_iter111_tiffin_failure.jpg', quality=40, full_page=False)
    except Exception as se:
        print(f'Could not capture failure details: {se}')
    raise
