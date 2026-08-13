"""
Focused Playwright verification plan for iter-138 kiosk face-scan bug.

This file documents the exact browser scripts run by the testing agent via the
MCP browser automation runner. It is not imported by product code.

Coverage:
1. Mobile wall-kiosk face scan with camera permission granted, a fake live
   camera stream (headless environment has no physical camera), and aborted
   face-api model requests. Observe for >20s that the video srcObject stays
   active and the permission-denied overlay never appears. Capture heartbeat
   POST payloads and backend health state.
2. Mobile wall-kiosk face scan with getUserMedia rejecting NotAllowedError.
   Observe for >12s that the denied overlay remains stable and exposes the
   "Show me how" helper.
"""

# The executable snippets were run in the MCP browser automation tool because
# the base container does not have the Python Playwright package installed.