# Focused Playwright checks for iteration 111 bug verification.
# Intended to run in browser automation context with async `page` available.
import json
from pathlib import Path

API = 'https://dining-pass-scan.preview.emergentagent.com/api'
PHONE_ACTIVE = '9333333333'
PHONE_INACTIVE = '9333333334'

async def collect_errors(page):
    error_text = await page.evaluate("""() => {
    const errorElements = Array.from(document.querySelectorAll('.error, [class*="error"], [id*="error"]'));
    return errorElements.map(el => el.textContent).join(", ");
    }""")
    if error_text:
        print(f"Found error message: {error_text}")
    else:
        print("No error messages found on the page")
    return error_text

async def login_phone(page, phone, name='Bug Verify User'):
    await page.goto('/login')
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

async def measure_selector(page, selector):
    loc = page.locator(selector).first
    box = await loc.bounding_box()
    classes = await loc.get_attribute('class')
    text = await loc.inner_text()
    return {'box': box, 'class': classes, 'text': text}

async def run_checks(page):
    results = []
    async def add(name, ok, details=None):
        results.append({'name': name, 'ok': bool(ok), 'details': details or {}})
        print(f"{name}: {'PASS' if ok else 'FAIL'} {details or ''}")

    await page.set_viewport_size({'width': 360, 'height': 844})

    # Active dining subscriber: Dashboard slot and Scan floating center
    await login_phone(page, PHONE_ACTIVE, 'Active Verify')
    await page.goto('/self-scan')
    await page.wait_for_selector('[data-testid="bottom-nav"]', timeout=15000)
    await page.wait_for_selector('[data-testid="bottom-nav-dashboard"]', timeout=15000)
    nav_labels = await page.locator('[data-testid="bottom-nav"] span').all_inner_texts()
    dash_visible = await page.locator('[data-testid="bottom-nav-dashboard"]').is_visible()
    orders_count = await page.locator('[data-testid="bottom-nav-orders"]').count()
    scan_visible = await page.locator('[data-testid="bottom-nav-scan"]').is_visible()
    scan_box = await page.locator('[data-testid="bottom-nav-scan"] span').first.bounding_box()
    await add('active subscriber bottom nav uses Dashboard (not Orders) and Scan exists', dash_visible and orders_count == 0 and scan_visible, {'nav_text_fragments': nav_labels, 'scan_circle_box': scan_box})

    # Self-scan redesign at 360w
    await page.wait_for_selector('[data-testid="scan-cta-card"]', timeout=15000)
    card = await measure_selector(page, '[data-testid="scan-cta-card"]')
    heading = await measure_selector(page, '[data-testid="scan-heading"]')
    tagline = await measure_selector(page, '[data-testid="scan-hindi-tagline"]')
    heart_box = await page.locator('[data-testid="scan-hindi-tagline"] svg').first.bounding_box()
    tagline_p_box = await page.locator('[data-testid="scan-hindi-tagline"] p').first.bounding_box()
    qr_wrapper_box = await page.locator('[data-testid="scan-cta-card"] div[aria-hidden]').first.bounding_box()
    qr_svg_box = await page.locator('[data-testid="scan-cta-card"] svg').first.bounding_box()
    await add('self-scan compact card/classes at 360w', card['box']['width'] <= 282 and 'max-w-[280px]' in (card['class'] or '') and 'p-4' in (card['class'] or '') and qr_wrapper_box['width'] <= 82 and qr_svg_box['width'] <= 58, {'card': card, 'qr_wrapper_box': qr_wrapper_box, 'qr_svg_box': qr_svg_box})
    await add('self-scan heading moved upward with mt-4', 'mt-4' in (heading['class'] or ''), {'heading': heading})
    await add('Hindi tagline centered with heart above text', all(c in (tagline['class'] or '') for c in ['flex', 'flex-col', 'items-center', 'text-center']) and heart_box['y'] < tagline_p_box['y'], {'tagline': tagline, 'heart_box': heart_box, 'text_box': tagline_p_box})

    await page.goto('/profile')
    await page.wait_for_timeout(300)
    # logout via API to isolate next session; UI cookies are same-site across preview
    await page.evaluate("""async (api) => { await fetch(api + '/auth/logout', {method:'POST', credentials:'include'}); localStorage.clear(); sessionStorage.clear(); }""", API)
    await page.goto('/login')
    await page.wait_for_timeout(500)

    # Inactive subscriber/no active subscription: Orders slot and Scan center
    await login_phone(page, PHONE_INACTIVE, 'Inactive Verify')
    await page.goto('/restaurant')
    await page.wait_for_selector('[data-testid="bottom-nav"]', timeout=15000)
    await page.wait_for_selector('[data-testid="bottom-nav-orders"]', timeout=15000)
    orders_visible = await page.locator('[data-testid="bottom-nav-orders"]').is_visible()
    orders_href = await page.locator('[data-testid="bottom-nav-orders"]').get_attribute('href')
    dash_count = await page.locator('[data-testid="bottom-nav-dashboard"]').count()
    scan2_visible = await page.locator('[data-testid="bottom-nav-scan"]').is_visible()
    nav2_text = await page.locator('[data-testid="bottom-nav"]').inner_text()
    await add('inactive subscriber bottom nav swaps Dashboard to Orders and keeps Scan', orders_visible and dash_count == 0 and scan2_visible and (orders_href or '').endswith('/restaurant/orders'), {'nav_text': nav2_text, 'orders_href': orders_href})

    await collect_errors(page)
    Path('/app/test_reports/bug_verify_iter111_ui_result.json').write_text(json.dumps({'checks': results}, indent=2))
    if not all(r['ok'] for r in results):
        raise AssertionError('one or more UI checks failed')

try:
    await run_checks(page)
    print('UI checks completed successfully')
except Exception as e:
    print(f'UI checks failed: {e}')
    try:
        await collect_errors(page)
        await page.screenshot(path='/app/test_reports/bug_verify_iter111_ui_failure.jpg', quality=40, full_page=False)
    except Exception as se:
        print(f'Could not capture failure details: {se}')
    raise
