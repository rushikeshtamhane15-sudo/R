"""Iter-63 #1: Weekly menu poster generator.

Admin clicks one button → backend renders the next 7 days' lunch + dinner
as a printable A4 image (PNG) + a shareable WhatsApp JPG. Pure PIL — no
extra packages needed, since PIL is already used for icon generation.

Two output sizes:
  * A4 portrait (1240 × 1754 @ 150dpi) — printable, sticks on the kitchen wall
  * Square 1080 × 1080 — shareable to WhatsApp / Insta

Endpoint:
  GET /api/admin/mess-menu/poster?start=YYYY-MM-DD&format=a4|square&fmt=png|jpg
"""
from __future__ import annotations

import base64
import io
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from PIL import Image, ImageDraw, ImageFont

from shared import server

router = APIRouter()

_IST = timezone(timedelta(hours=5, minutes=30))


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    # DejaVu ships with Pillow's standard install on most distros; fall back
    # to default bitmap font if missing so the route still returns *something*.
    candidates = (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold
        else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    )
    for c in candidates:
        try:
            return ImageFont.truetype(c, size=size)
        except Exception:  # noqa: BLE001
            continue
    return ImageFont.load_default()


def _wrap(text: str, font: ImageFont.FreeTypeFont, max_width_px: int) -> list[str]:
    if not text:
        return [""]
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if font.getlength(trial) <= max_width_px:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def _render_poster(items, start_date_iso: str, size_key: str = "a4") -> bytes:
    """Render the 7-day menu as a PNG and return raw bytes."""
    if size_key == "square":
        W, H = 1080, 1080
        margin = 60
    else:
        # A4 portrait @ 150dpi
        W, H = 1240, 1754
        margin = 80

    # Brand colors
    RED = (160, 35, 35)
    CREAM = (252, 247, 240)
    INK = (24, 24, 27)
    MUTED = (113, 113, 122)
    GREEN = (5, 150, 105)

    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # Brand band (header)
    band_h = 200 if size_key == "a4" else 140
    d.rectangle([(0, 0), (W, band_h)], fill=RED)
    f_title = _font(54 if size_key == "a4" else 42, bold=True)
    f_subtitle = _font(22 if size_key == "a4" else 18, bold=False)
    d.text((margin, 38), "eFoodCare", font=f_title, fill="white")
    d.text((margin, 38 + (60 if size_key == "a4" else 50)),
           "Weekly mess menu · ghar se achha khana",
           font=f_subtitle, fill="white")

    # Date range subtitle
    start = datetime.fromisoformat(start_date_iso).date()
    end = start + timedelta(days=6)
    range_txt = f"{start.strftime('%a %d %b')}  →  {end.strftime('%a %d %b %Y')}"
    f_range = _font(20 if size_key == "a4" else 16, bold=True)
    d.text((margin, band_h - 40),
           range_txt, font=f_range, fill="white")

    # Day cards
    inner_top = band_h + 40
    inner_bottom = H - 80
    card_gap = 14
    avail_h = inner_bottom - inner_top - (6 * card_gap)
    card_h = avail_h // 7

    f_day = _font(28 if size_key == "a4" else 22, bold=True)
    f_label = _font(16 if size_key == "a4" else 13, bold=True)
    f_body = _font(20 if size_key == "a4" else 16, bold=False)
    f_note = _font(16 if size_key == "a4" else 13, bold=False)

    items_map = {it["date"]: it for it in items}

    for i in range(7):
        d_iso = (start + timedelta(days=i)).isoformat()
        y = inner_top + i * (card_h + card_gap)
        # Card box
        d.rounded_rectangle([(margin, y), (W - margin, y + card_h)], radius=14, fill="white", outline=(230, 230, 230), width=2)
        # Date stamp on left
        date_obj = start + timedelta(days=i)
        d.text((margin + 18, y + 18), date_obj.strftime("%a").upper(), font=f_label, fill=RED)
        f_d = _font(36 if size_key == "a4" else 28, bold=True)
        d.text((margin + 18, y + 36), date_obj.strftime("%d"), font=f_d, fill=INK)
        d.text((margin + 18, y + 36 + (40 if size_key == "a4" else 32)), date_obj.strftime("%b"), font=f_label, fill=MUTED)

        col_x = margin + 110
        col_w = W - margin - col_x - 20

        rec = items_map.get(d_iso)
        if not rec or (not rec.get("lunch") and not rec.get("dinner")):
            d.text((col_x, y + 30), "— menu not planned —", font=f_note, fill=MUTED)
            continue

        # Lunch
        d.text((col_x, y + 14), "LUNCH", font=f_label, fill=GREEN)
        lunch_lines = _wrap(rec.get("lunch") or "—", f_body, col_w)
        ly = y + 14 + 22
        for line in lunch_lines[:2]:  # cap at 2 lines per slot
            d.text((col_x, ly), line, font=f_body, fill=INK)
            ly += 26 if size_key == "a4" else 22
        # Dinner
        dinner_y = y + (card_h // 2) + 4
        d.text((col_x, dinner_y), "DINNER", font=f_label, fill=RED)
        dinner_lines = _wrap(rec.get("dinner") or "—", f_body, col_w)
        dy = dinner_y + 22
        for line in dinner_lines[:2]:
            d.text((col_x, dy), line, font=f_body, fill=INK)
            dy += 26 if size_key == "a4" else 22
        if rec.get("note"):
            d.text((col_x, y + card_h - 22), f"★ {rec['note'][:60]}", font=f_note, fill=MUTED)

    # Footer
    f_foot = _font(16 if size_key == "a4" else 13, bold=True)
    d.text((margin, H - 50), "Menu may change without notice · eFoodCare ©", font=f_foot, fill=MUTED)
    d.text((W - margin - 220, H - 50), "Generated " + datetime.now(_IST).strftime("%d %b %Y, %H:%M"), font=f_foot, fill=MUTED)

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


@router.get("/admin/mess-menu/poster")
async def render_poster(
    start: str = Query(..., description="ISO YYYY-MM-DD start date"),
    format: str = Query("a4", regex="^(a4|square)$"),
    fmt: str = Query("png", regex="^(png|jpg)$"),
    user: server.User = Depends(server.get_current_user),
):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    try:
        start_dt = datetime.fromisoformat(start).date()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="start must be YYYY-MM-DD")
    end_dt = start_dt + timedelta(days=7)
    items = []
    async for doc in server.db.mess_menu.find(
        {"date": {"$gte": start_dt.isoformat(), "$lt": end_dt.isoformat()}},
        {"_id": 0},
    ).sort("date", 1):
        items.append(doc)
    raw = _render_poster(items, start_dt.isoformat(), format)
    # Convert to JPG if requested
    if fmt == "jpg":
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        out = io.BytesIO()
        im.save(out, format="JPEG", quality=88, optimize=True)
        raw = out.getvalue()
        mime = "image/jpeg"
        filename = f"mess-menu-{start_dt.isoformat()}-{format}.jpg"
    else:
        mime = "image/png"
        filename = f"mess-menu-{start_dt.isoformat()}-{format}.png"
    return StreamingResponse(
        io.BytesIO(raw),
        media_type=mime,
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )
