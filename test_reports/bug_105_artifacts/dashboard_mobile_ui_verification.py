"""
Focused Playwright verification script for user-reported dashboard/header mobile UI bug.
Executed through mcp_browser_automation against https://dining-pass-scan.preview.emergentagent.com at 360x844.
Covered:
- OTP login as tiffin subscriber 8888888888 and dining subscriber 7777777777
- header computed font sizes, no overflow, wallet drawer opens
- redesigned tiffin tracking info card, compact delivery time, centered greeting
- compact dining cards and grid gap
- dual-subscription centered toggle and pending deliveries banner regression
"""
# See browser automation outputs:
# /root/.emergent/automation_output/20260719_193253/console_20260719_193253.log
# /root/.emergent/automation_output/20260719_193414/console_20260719_193414.log
